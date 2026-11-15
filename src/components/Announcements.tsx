/** Organiser messages pinned from Settings. Shown above "My team" on the front
 *  page; when the organiser un-pins one, it disappears on the next refresh. */
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { useState } from 'react'
import * as api from '../lib/api'
import { reportPdf, teamsOf, saveFile, DOWNLOAD_MARK, type Cat } from '../lib/report'

/** "[download]" in an announcement: the full results PDF, and one team's own report (pick category, then team). */
function Downloads({ hub, bundleOf }: { hub: Hub; bundleOf: (code: string) => Bundle | null }) {
  const [busy, setBusy] = useState<'' | 'all' | 'team'>('')
  const [open, setOpen] = useState(false)
  const [cat, setCat] = useState('')
  const [team, setTeam] = useState('')
  const load = async () => {
    const cats: Cat[] = []
    for (const c of hub.cats) {
      const b = bundleOf(c.code) ?? await api.refresh(c.code).catch(() => null)
      if (b) cats.push({ code: c.code, label: c.label, b })
    }
    return cats
  }
  const day = (cats: Cat[]) => cats[0]?.b.competition.event_date ?? new Date().toISOString().slice(0, 10)
  const all = async () => {
    setBusy('all')
    try { const cats = await load(); saveFile(`${hub.code}-full-results-${day(cats)}.pdf`, await reportPdf(hub, cats), 'application/pdf') }
    finally { setBusy('') }
  }
  const one = async () => {
    if (!cat || !team) return
    setBusy('team')
    try {
      const cats = await load()
      const name = cats.find(c => c.code === cat)?.b.teams.find(t => t.id === team)?.name ?? 'team'
      const file = name.replace(/[^A-Za-z0-9]+/g, '-').replace(/^-|-$/g, '')
      saveFile(`${hub.code}-${file}-${day(cats)}.pdf`, await reportPdf(hub, cats, undefined, { code: cat, id: team }), 'application/pdf')
    } finally { setBusy('') }
  }
  const c = hub.cats.find(x => x.code === cat)
  const b = cat ? bundleOf(cat) : null
  const teams = c && b ? teamsOf({ code: c.code, label: c.label, b }, hub) : []
  const btn = 'inline-flex min-h-[40px] items-center gap-1.5 rounded-lg px-3 py-2 text-sm font-bold disabled:opacity-60'
  const sel = 'min-h-[40px] w-full rounded-lg border border-gold/50 bg-surface-2 px-2 text-sm font-semibold text-fg'
  return (
    <div className="mt-2 space-y-2">
      <div className="flex flex-wrap gap-2">
        <button type="button" disabled={!!busy} onClick={all} className={`${btn} bg-gold text-black`}>
          ⬇ {busy === 'all' ? 'Preparing…' : 'Full results & analysis (PDF)'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setOpen(o => !o)} className={`${btn} border border-gold/60 text-fg`}>
          ⬇ My team report (PDF)
        </button>
      </div>
      {open && (
        <div className="space-y-2 rounded-lg border border-gold/40 bg-black/20 p-2.5">
          <div className="text-xs font-bold uppercase tracking-wide text-fg-muted">1. Category</div>
          <div className="flex flex-wrap gap-1.5">
            {hub.cats.map(x => (
              <button key={x.code} type="button" onClick={() => { setCat(x.code); setTeam('') }}
                className={`min-h-[36px] rounded-full px-3 text-xs font-bold ${cat === x.code ? 'bg-gold text-black' : 'border border-gold/50 text-fg'}`}>
                {x.label}
              </button>
            ))}
          </div>
          {cat && (<>
            <div className="text-xs font-bold uppercase tracking-wide text-fg-muted">2. Team</div>
            <select className={sel} value={team} onChange={e => setTeam(e.target.value)}>
              <option value="">Choose a team…</option>
              {teams.map(t => <option key={t.id} value={t.id}>{t.name}{t.pool ? `  (Group ${t.pool})` : ''}</option>)}
            </select>
            <button type="button" disabled={!team || !!busy} onClick={one} className={`${btn} w-full justify-center bg-gold text-black`}>
              ⬇ {busy === 'team' ? 'Preparing…' : 'Download team report'}
            </button>
          </>)}
        </div>
      )}
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
