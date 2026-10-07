// Admin shortcut: 2 single photos -> chibi team picture via Gemini.
// The key is typed once and kept in this browser only (localStorage); it is never in the code or the bundle.
export const GEMINI_KEY_STORE = 'picklepoint_gemini_key'
const MODEL = 'gemini-3.1-flash-image'

const PROMPT = `Combine the TWO uploaded photos (one person each) into ONE CUTE CHIBI DOUBLES-TEAM STICKER ILLUSTRATION of the two pickleball players standing side by side, shoulder to shoulder, same scale.

STYLE: Ultra-cute Korean/Japanese chibi sticker illustration. NOT anime. NOT manga. NOT Pixar. NOT Disney. NOT 3D. Same look as a premium custom team mascot sticker.

CHARACTER DESIGN:
- Exactly 2 characters, one for each photo, keep each person's gender as in their photo.
- Head size 55-60% of total character height. Tiny compact body. Upper-body composition. Happy smiling expression.
- Faces: solid black oval eyes (keep glasses if the person wears them), tiny nose, small smile, soft blush cheeks. No realistic skin texture.

LINEWORK: Thick clean black outlines, consistent weight, smooth vector appearance, readable at small sizes.
COLOR: Flat vector-style colouring, clean colour blocks.

PRESERVE from each photo: hairstyle, hair colour, skin tone, glasses, cap or visor, clothing colours.

BACKGROUND: Pure solid white #FFFFFF. No gradients, no scenery, no court, no ground shadow, no white sticker border.
NO text, letters, numbers, logos or watermark.

NEGATIVE: realistic face, photorealistic, anime, manga, Disney, Pixar, 3D render, background scenery, thin outlines, dramatic shadows, text, watermark.`

function photoToB64(file: File, max = 1024): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file), img = new Image()
    img.onload = () => {
      URL.revokeObjectURL(url)
      const k = Math.min(1, max / Math.max(img.width, img.height))
      const c = document.createElement('canvas')
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k)
      c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height)
      resolve(c.toDataURL('image/jpeg', 0.85).split(',')[1])
    }
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('BAD_IMAGE')) }
    img.src = url
  })
}

/** two photos in -> cartoon team picture as a PNG File (white background, ready for resizeLogoTight) */
export async function makeTeamCartoon(apiKey: string, photos: File[]): Promise<File> {
  const imgs = await Promise.all(photos.slice(0, 2).map(f => photoToB64(f)))
  const res = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
    body: JSON.stringify({
      contents: [{ role: 'user', parts: [
        { text: PROMPT },
        ...imgs.map(data => ({ inline_data: { mime_type: 'image/jpeg', data } })),
      ] }],
      generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1' } },
    }),
  })
  if (!res.ok) {
    const e = await res.json().catch(() => ({}))
    if (res.status === 400 || res.status === 403) localStorage.removeItem(GEMINI_KEY_STORE)
    throw new Error(e?.error?.message || `Gemini error ${res.status}`)
  }
  const data = await res.json()
  const part = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData || p.inline_data)
  if (!part) throw new Error('Gemini returned no image — try again or use clearer photos.')
  const d = part.inlineData || part.inline_data
  const bin = atob(d.data), u8 = new Uint8Array(bin.length)
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i)
  return new File([u8], 'team.png', { type: d.mimeType || d.mime_type || 'image/png' })
}
