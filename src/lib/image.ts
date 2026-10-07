/** Load an image File and downscale it to a square PNG data URL for use as a
 *  team emblem. Contain-fit (whole logo kept, transparent padding) so wordmarks
 *  are never cropped. Keeps logos tiny so they live comfortably in the DB. */
export function resizeImage(file: File, max = 256): Promise<string> {
  if (file.size > 4 * 1024 * 1024) return Promise.reject(new Error('IMAGE_TOO_LARGE'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const canvas = document.createElement('canvas')
        canvas.width = max; canvas.height = max
        const ctx = canvas.getContext('2d')
        if (!ctx) return reject(new Error('BAD_IMAGE'))
        const scale = Math.min(max / img.width, max / img.height)
        const dw = img.width * scale, dh = img.height * scale
        ctx.drawImage(img, (max - dw) / 2, (max - dh) / 2, dw, dh)
        resolve(canvas.toDataURL('image/png'))
      } catch { reject(new Error('BAD_IMAGE')) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')) }
    img.src = url
  })
}

/** MCMD/MCXD character logos: strips any white sticker outline / white background
 *  connected to the edge, trims transparent margins, and scales the picture to fit
 *  max x max keeping its own aspect (not squared). Same result for every upload. */
export function resizeLogoTight(file: File, max = 400, dropSpecks = false): Promise<string> {
  if (file.size > 8 * 1024 * 1024) return Promise.reject(new Error('IMAGE_TOO_LARGE'))
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file)
    const img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      try {
        const k = Math.min(1, 640 / Math.max(img.width, img.height))
        const W = Math.max(1, Math.round(img.width * k)), H = Math.max(1, Math.round(img.height * k))
        const c = document.createElement('canvas'); c.width = W; c.height = H
        const x = c.getContext('2d'); if (!x) return reject(new Error('BAD_IMAGE'))
        x.drawImage(img, 0, 0, W, H)
        const id = x.getImageData(0, 0, W, H), d = id.data
        const A = (p: number) => d[p * 4 + 3]
        const light = (p: number) => d[p * 4] > 215 && d[p * 4 + 1] > 215 && d[p * 4 + 2] > 215
        const seen = new Uint8Array(W * H), q: number[] = []
        const wall = new Uint8Array(W * H)
        {
          // seal open bottoms: a character whose outline doesn't close under the shirt would let the
          // white background flood in and erase a white shirt. Join each outline's lowest-left and
          // lowest-right points with a thin wall the flood fill can't cross.
          const dark = (p: number) => A(p) > 40 && (d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3 < 110
          const lab = new Int32Array(W * H).fill(-1)
          for (let p0 = 0; p0 < W * H; p0++) {
            if (lab[p0] !== -1 || !dark(p0)) continue
            const st = [p0], pts: number[] = []; lab[p0] = p0
            while (st.length) {
              const p = st.pop()!; pts.push(p)
              const px = p % W, py = (p / W) | 0
              for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
                const nx = px + dx, ny = py + dy
                if (nx < 0 || ny < 0 || nx >= W || ny >= H) continue
                const n = ny * W + nx
                if (lab[n] === -1 && dark(n)) { lab[n] = p0; st.push(n) }
              }
            }
            if (pts.length < 300) continue
            let top = H, bot = -1
            for (const p of pts) { const py = (p / W) | 0; if (py < top) top = py; if (py > bot) bot = py }
            const band = bot - Math.max(4, Math.round((bot - top) * 0.06))
            let lx = -1, ly = 0, rx = -1, ry = 0
            for (const p of pts) {
              const px = p % W, py = (p / W) | 0
              if (py < band) continue
              if (lx < 0 || px < lx) { lx = px; ly = py }
              if (rx < 0 || px > rx) { rx = px; ry = py }
            }
            if (rx - lx < 20) continue
            for (let xx = lx; xx <= rx; xx++) {
              const yy = Math.round(ly + (ry - ly) * ((xx - lx) / (rx - lx)))
              for (let t = 0; t < 3; t++) if (yy + t < H) wall[(yy + t) * W + xx] = 1
            }
          }
          for (let i = 0; i < W; i++) q.push(i, (H - 1) * W + i)
          for (let j = 0; j < H; j++) q.push(j * W, j * W + W - 1)
        }
        while (q.length) {
          const p = q.pop()!
          if (seen[p] || wall[p]) continue
          if (!(A(p) < 40 || light(p))) continue
          seen[p] = 1; if (A(p) >= 40) d[p * 4 + 3] = 0
          const px = p % W, py = (p / W) | 0
          if (px > 0) q.push(p - 1); if (px < W - 1) q.push(p + 1)
          if (py > 0) q.push(p - W); if (py < H - 1) q.push(p + W)
        }
        for (let pass = 0; pass < 2; pass++) {
          const kill: number[] = []
          for (let p = 0; p < W * H; p++) {
            if (A(p) < 40) continue
            if ((d[p * 4] + d[p * 4 + 1] + d[p * 4 + 2]) / 3 < 190) continue
            const px = p % W, py = (p / W) | 0
            if (px === 0 || py === 0 || px === W - 1 || py === H - 1 ||
                A(p - 1) < 40 || A(p + 1) < 40 || A(p - W) < 40 || A(p + W) < 40) kill.push(p)
          }
          kill.forEach(p => { d[p * 4 + 3] = 0 })
        }
        if (dropSpecks) {
          // drop small separate blobs (e.g. an AI app's corner watermark): keep only
          // pieces at least 1% the size of the biggest one (both players survive)
          const lab = new Int32Array(W * H).fill(-1), sizes: number[] = []
          for (let p0 = 0; p0 < W * H; p0++) {
            if (lab[p0] !== -1 || A(p0) <= 30) continue
            const id0 = sizes.length, st = [p0]; let n = 0
            lab[p0] = id0
            while (st.length) {
              const p = st.pop()!; n++
              const px = p % W, py = (p / W) | 0
              const nb = [px > 0 ? p - 1 : -1, px < W - 1 ? p + 1 : -1, py > 0 ? p - W : -1, py < H - 1 ? p + W : -1]
              for (const q of nb) if (q >= 0 && lab[q] === -1 && A(q) > 30) { lab[q] = id0; st.push(q) }
            }
            sizes.push(n)
          }
          const big = sizes.reduce((m, v) => (v > m ? v : m), 0)
          for (let p = 0; p < W * H; p++) if (lab[p] >= 0 && sizes[lab[p]] < big * 0.01) d[p * 4 + 3] = 0
        }
        x.putImageData(id, 0, 0)
        let x0 = W, y0 = H, x1 = -1, y1 = -1
        for (let p = 0; p < W * H; p++) if (A(p) > 30) {
          const px = p % W, py = (p / W) | 0
          if (px < x0) x0 = px; if (px > x1) x1 = px; if (py < y0) y0 = py; if (py > y1) y1 = py
        }
        if (x1 < 0) return reject(new Error('BAD_IMAGE'))
        const bw = x1 - x0 + 1, bh = y1 - y0 + 1, s = Math.min(1, max / Math.max(bw, bh))
        const o = document.createElement('canvas'); o.width = Math.round(bw * s); o.height = Math.round(bh * s)
        const ox = o.getContext('2d'); if (!ox) return reject(new Error('BAD_IMAGE'))
        ox.imageSmoothingQuality = 'high'
        ox.drawImage(c, x0, y0, bw, bh, 0, 0, o.width, o.height)
        resolve(o.toDataURL('image/png'))
      } catch { reject(new Error('BAD_IMAGE')) }
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')) }
    img.src = url
  })
}
