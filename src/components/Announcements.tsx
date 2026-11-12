/** Organiser messages pinned from Settings. Shown above "My team" on the front
 *  page; when the organiser un-pins one, it disappears on the next refresh. */
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'

export default function Announcements({ hub, bundleOf }: { hub: Hub; bundleOf: (code: string) => Bundle | null }) {
  const seen = new Set<string>()
  const list: Array<{ key: string; text: string; at: string }> = []
  for (const c of hub.cats) {
    for (const e of bundleOf(c.code)?.events ?? []) {
      const all = [...(e.announcements ?? []).map(a => ({ key: a.id, text: a.text, at: a.at })),
        ...(e.announcement?.trim() ? [{ key: 'old-' + e.id, text: e.announcement.trim(), at: e.announce_at ?? '' }] : [])]
      for (const a of all) {
        const t = a.text?.trim()
        if (t && !seen.has(t)) { seen.add(t); list.push({ key: a.key, text: t, at: a.at ?? '' }) }
      }
    }
  }
  if (!list.length) return null
  list.sort((a, b) => b.at.localeCompare(a.at))
  return (
    <section className="space-y-2 px-4 pt-3 lg:px-6">
      {list.map(a => (
        <div key={a.key} className="pp-flash flex items-start gap-2.5 rounded-xl border-2 border-gold/60 bg-gold/10 px-3 py-2.5">
          <span className="mt-0.5 text-lg leading-none">📢</span>
          <span className="min-w-0 flex-1 whitespace-pre-line text-sm font-semibold leading-snug">{a.text}</span>
        </div>
      ))}
    </section>
  )
}
