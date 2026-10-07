// Vercel serverless function: 2 player photos -> chibi team picture (Gemini).
// GEMINI_API_KEY lives only in the Vercel project env vars; the browser never sees it.
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

export const config = { maxDuration: 60 }

// best-effort per-IP limit (resets when the function instance recycles)
const hits = new Map<string, number[]>()
const limited = (ip: string) => {
  const now = Date.now(), recent = (hits.get(ip) ?? []).filter(t => now - t < 10 * 60_000)
  recent.push(now); hits.set(ip, recent)
  return recent.length > 8
}

export default async function handler(req: any, res: any) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'POST only' })
  try {
    const key = process.env.GEMINI_API_KEY
    if (!key) return res.status(500).json({ error: 'Server is missing GEMINI_API_KEY.' })
    const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'x'
    if (limited(ip)) return res.status(429).json({ error: 'Too many tries — wait a few minutes.' })

    const body = typeof req.body === 'string' ? JSON.parse(req.body) : req.body || {}
    const photos: string[] = Array.isArray(body.photos) ? body.photos : []
    if (photos.length !== 2 || photos.some(p => typeof p !== 'string' || p.length < 1000 || p.length > 1_800_000))
      return res.status(400).json({ error: 'Send exactly 2 photos.' })

    // only a real competition code may use the generator, and never more than
    // the daily cap (ai_gen_take, migration 0029) — protects the Gemini bill
    const url = process.env.VITE_SUPABASE_URL, anon = process.env.VITE_SUPABASE_ANON_KEY
    if (!url || !anon) return res.status(500).json({ error: 'Server is missing the Supabase settings.' })
    const v = await fetch(`${url}/rest/v1/rpc/ai_gen_take`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', apikey: anon, Authorization: `Bearer ${anon}` },
      body: JSON.stringify({ p_code: String(body.code || '') }),
    })
    if (!v.ok) {
      const t = await v.text()
      if (t.includes('DAILY_LIMIT')) return res.status(429).json({ error: "Today's picture limit is reached — please try again tomorrow or ask the organiser." })
      return res.status(403).json({ error: 'Registration is not open for this code.' })
    }

    const r = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/${MODEL}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
      body: JSON.stringify({
        contents: [{ role: 'user', parts: [
          { text: PROMPT },
          ...photos.map(data => ({ inline_data: { mime_type: 'image/jpeg', data } })),
        ] }],
        generationConfig: { responseModalities: ['IMAGE', 'TEXT'], imageConfig: { aspectRatio: '1:1' } },
      }),
    })
    const data: any = await r.json().catch(() => ({}))
    if (!r.ok) return res.status(502).json({ error: data?.error?.message || `Gemini error ${r.status}` })
    const part = (data?.candidates?.[0]?.content?.parts || []).find((p: any) => p.inlineData || p.inline_data)
    if (!part) return res.status(502).json({ error: 'No picture came back — try again with clearer photos.' })
    const d = part.inlineData || part.inline_data
    return res.status(200).json({ png: d.data, mime: d.mimeType || d.mime_type || 'image/png' })
  } catch (e: any) {
    return res.status(500).json({ error: String(e?.message || e) })
  }
}
