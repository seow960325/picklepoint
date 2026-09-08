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
