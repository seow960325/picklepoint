/** Organiser messages pinned from Settings. Shown above "My team" on the front
 *  page; when the organiser un-pins one, it disappears on the next refresh. */
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { useEffect, useState } from 'react'
import * as api from '../lib/api'
import { reportPdf, teamsOf, saveFile, DOWNLOAD_MARK, DOWNLOAD_UNTIL, type Cat } from '../lib/report'

/** Time left to download: a bar that fills as the closing time comes closer (same look as the "My team" countdown). */
function DownIcon() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M12 4v11M7 11l5 5 5-5M5 20h14" />
    </svg>
  )
}

function CloseBar({ code }: { code: string }) {
  const until = DOWNLOAD_UNTIL[code] ? new Date(DOWNLOAD_UNTIL[code]).getTime() : 0
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => { const t = window.setInterval(() => setNow(Date.now()), 1000); return () => window.clearInterval(t) }, [])
  if (!until) return null
  const secs = Math.round((until - now) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  const left = secs <= 0 ? 'Downloads closed'
    : secs >= 86400 ? `${Math.floor(secs / 86400)}d ${two(Math.floor((secs % 86400) / 3600))}:${two(Math.floor((secs % 3600) / 60))}`
    : `${two(Math.floor(secs / 3600))}:${two(Math.floor((secs % 3600) / 60))}:${two(secs % 60)}`
  const pct = Math.max(6, Math.min(100, 100 - (secs / (7 * 86400)) * 100))
  // green until 2 days left, orange for the last 2 days, red for the last 8 hours
  const colour = secs <= 8 * 3600 ? 'hsl(0 78% 50%)' : secs <= 2 * 86400 ? 'hsl(30 92% 50%)' : 'hsl(152 72% 40%)'
  return (
    <span className="relative block h-11 w-full overflow-hidden rounded-lg bg-black/50 ring-1 ring-white/15" title="Time left to download your results">
      <span className="absolute inset-y-0 left-0 transition-[width,background-color] duration-1000 ease-linear" style={{ width: `${secs <= 0 ? 100 : pct}%`, backgroundColor: colour }} />
      <span className="tabular absolute inset-0 flex items-center justify-center font-display text-sm font-bold uppercase leading-none tracking-wide text-white [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">
        {secs <= 0 ? left : `Closes in ${left}`}
      </span>
    </span>
  )
}

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
    try { const cats = await load(); saveFile(`${hub.code}-full-results-${day(cats)}.pdf`, await reportPdf(hub, cats), 'application/pdf'); api.logReportDownload(hub.code, 'full') }
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
      api.logReportDownload(hub.code, 'team', cat, name)
    } finally { setBusy('') }
  }
  const c = hub.cats.find(x => x.code === cat)
  const b = cat ? bundleOf(cat) : null
  const teams = c && b ? teamsOf({ code: c.code, label: c.label, b }, hub) : []
  const btn = 'flex h-11 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-bold disabled:opacity-60'
  const sel = 'min-h-[40px] w-full rounded-lg border border-gold/50 bg-surface-2 px-2 text-sm font-semibold text-fg'
  return (
    <div className="mt-2 space-y-2">
      <CloseBar code={hub.code} />
      <div className="flex flex-col gap-2">
        <button type="button" disabled={!!busy} onClick={all} className={`${btn} bg-gold text-black`}>
          <DownIcon /> {busy === 'all' ? 'Preparing…' : 'Full results & analysis (PDF)'}
        </button>
        <button type="button" disabled={!!busy} onClick={() => setOpen(o => !o)} className={`${btn} border border-gold/60 text-fg`}>
          <DownIcon /> My team report (PDF)
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
            <button type="button" disabled={!team || !!busy} onClick={one} className={`${btn} bg-gold text-black`}>
              <DownIcon /> {busy === 'team' ? 'Preparing…' : 'Download team report'}
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
            <span className="block whitespace-pre-line text-justify text-sm font-semibold leading-snug [text-align-last:left] [hyphens:auto]" lang="en">{a.text.replace(DOWNLOAD_MARK, ' ').trim()}</span>
            {DOWNLOAD_MARK.test(a.text) && <Downloads hub={hub} bundleOf={bundleOf} />}
          </div>
        </div>
      ))}
    </section>
  )
}
