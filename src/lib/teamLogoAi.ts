// 2 player photos -> chibi team picture, through the server (api/cartoonize).
// The Gemini key lives only in Vercel; every call counts toward the daily cap.
export function photoB64(file: File, max = 768): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.8).split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')) }
    img.src = url
  })
}

/** returns the raw picture as a PNG File (white background, ready for resizeLogoTight) */
export async function makeTeamCartoon(code: string, photos: File[]): Promise<File> {
  const imgs = await Promise.all(photos.slice(0, 2).map(f => photoB64(f)))
  const r = await fetch('/api/cartoonize', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ code, photos: imgs }),
  })
  const j = await r.json().catch(() => ({}))
  if (!r.ok) throw new Error(j.error || `Server error ${r.status}`)
  const bin = atob(j.png), u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new File([u8], 'team.png', { type: j.mime || 'image/png' })
}
