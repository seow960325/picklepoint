/** Organiser messages pinned from Settings. Shown above "My team" on the front
 *  page; when the organiser un-pins one, it disappears on the next refresh. */
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { useState } from 'react'
import * as api from '../lib/api'
import { reportPdf, reportCsv, saveFile, DOWNLOAD_MARK, type Cat } from '../lib/report'

/** "[download]" in an announcement: buttons to save the full results (report + Excel CSV). */
function Downloads({ hub, bundleOf }: { hub: Hub; bundleOf: (code: string) => Bundle | null }) {
  const [busy, setBusy] = useState<'' | 'html' | 'csv'>('')
  const go = async (kind: 'html' | 'csv') => {
    setBusy(kind)
    try {
      const cats: Cat[] = []
      for (const c of hub.cats) {
        const b = bundleOf(c.code) ?? await api.refresh(c.code).catch(() => null)
        if (b) cats.push({ code: c.code, label: c.label, b })
      }
      const day = cats[0]?.b.competition.event_date ?? new Date().toISOString().slice(0, 10)
      if (kind === 'html') saveFile(`${hub.code}-full-results-${day}.pdf`, await reportPdf(hub, cats), 'application/pdf')
      else saveFile(`${hub.code}-all-games-${day}.csv`, reportCsv(hub, cats), 'text/csv;charset=utf-8')
    } finally { setBusy('') }
  }
  const btn = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-60'
  return (
    <div className="mt-2 flex flex-wrap gap-2">
      <button type="button" disabled={!!busy} onClick={() => go('html')} className={`${btn} bg-gold text-black`}>
        ⬇ {busy === 'html' ? 'Preparing…' : 'Full results & analysis (PDF)'}
      </button>
      <button type="button" disabled={!!busy} onClick={() => go('csv')} className={`${btn} border border-gold/60 text-fg`}>
        ⬇ {busy === 'csv' ? 'Preparing…' : 'All games (Excel)'}
      </button>
    </div>
  )
}

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
          <div className="min-w-0 flex-1">
            <span className="block whitespace-pre-line text-sm font-semibold leading-snug">{a.text.replace(DOWNLOAD_MARK, ' ').trim()}</span>
            {DOWNLOAD_MARK.test(a.text) && <Downloads hub={hub} bundleOf={bundleOf} />}
          </div>
        </div>
      ))}
    </section>
  )
}
