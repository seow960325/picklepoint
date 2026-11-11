/** /medals/CODE1+CODE2+... — overall medal table across category codes
 *  (church vs church). Read-only; each code keeps its own scoring. */
import { Link, useParams } from 'react-router-dom'
import { useCompetition } from '../lib/store'
import type { Bundle } from '../lib/types'
import { Emblem, FullscreenButton, Screen, Spinner } from '../components/ui'
import { categoryResult, medalTable, needsFourth } from '../lib/medals'
import { TotalPodium } from '../components/HubOverview'

const MAX = 6

export default function Medals() {
  const { codes = '' } = useParams()
  const list = codes.split(/[+,\s]+/).filter(Boolean).slice(0, MAX)
  // fixed number of hook calls (MAX), unused slots get undefined
  const s = [
    useCompetition(list[0], { viewer: true }), useCompetition(list[1], { viewer: true }),
    useCompetition(list[2], { viewer: true }), useCompetition(list[3], { viewer: true }),
    useCompetition(list[4], { viewer: true }), useCompetition(list[5], { viewer: true }),
  ]
  if (list.some((_, i) => s[i].loading && !s[i].bundle)) return <Screen><Spinner /></Screen>
  const bundles = s.map((x, i) => (list[i] ? x.bundle : null)).filter((b): b is Bundle => !!b)
  const results = bundles.map(categoryResult)
  const table = medalTable(results, bundles)
  const decided = results.filter(r => r.done).length
  const four = needsFourth(table)
  const cols = four ? 'grid-cols-[2.5rem_1fr_3rem_3rem_3rem_3rem]' : 'grid-cols-[2.5rem_1fr_3.5rem_3.5rem_3.5rem]'

  return (
    <div className="fixed inset-0 overflow-auto bg-canvas p-4 text-fg" style={{ paddingTop: 'max(var(--pp-top), 1rem)' }}>
      <div className="mx-auto max-w-4xl">
        <div className="mb-4 flex items-center justify-between gap-2">
          <div>
            <div className="font-display text-xs font-semibold uppercase tracking-[0.3em] text-fg-subtle">Total Champion</div>
            <h1 className="font-display text-3xl font-black tracking-wide">Medal table</h1>
            <div className="text-xs text-fg-muted">{decided} of {results.length} categories decided · most gold, then silver, then bronze</div>
          </div>
          <div className="flex items-center gap-2">
            <Link to="/" className="rounded-lg border border-line px-3 py-2 text-sm text-fg-muted">Lobby</Link>
            <FullscreenButton className="grid h-10 w-10 place-items-center rounded-lg border border-line p-2 text-fg-muted" />
          </div>
        </div>

        {results.length > 0 && results.every(r => r.done) && <TotalPodium table={table} />}
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className={`grid ${cols} items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle`}>
            <div>#</div><div>Church</div><div className="text-center">🥇</div><div className="text-center">🥈</div><div className="text-center">🥉</div>{four && <div className="text-center">4th</div>}
          </div>
          {table.length === 0 && <div className="p-6 text-center text-sm text-fg-muted">No medals yet — they appear as each category's Final finishes.</div>}
          {table.map((r, i) => (
            <div key={r.key} className={`grid ${cols} items-center gap-2 border-b border-line/60 px-3 py-2.5 last:border-0 ${i === 0 ? 'bg-gold/10' : ''}`}>
              <div className="font-display text-xl font-black text-fg-muted">{i + 1}</div>
              <div className="flex min-w-0 items-center gap-2">
                <Emblem logo={r.logo} flagName={r.name} className="h-8 w-8 shrink-0 rounded-[3px]" />
                <span className="truncate text-lg font-bold">{r.name}</span>
              </div>
              <div className="text-center font-display text-2xl font-black">{r.gold}</div>
              <div className="text-center font-display text-2xl font-bold text-fg-muted">{r.silver}</div>
              <div className="text-center font-display text-2xl font-bold text-fg-muted">{r.bronze}</div>
              {four && <div className="text-center font-display text-xl font-bold text-fg-subtle">{r.fourth}</div>}
            </div>
          ))}
        </div>

        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {results.map(r => (
            <Link key={r.code} to={`/c/${r.code}`} className="rounded-xl border border-line bg-surface p-3">
              <div className="flex items-center justify-between">
                <div className="font-display text-sm font-bold uppercase tracking-wider">{r.name}</div>
                <div className="text-[11px] text-fg-subtle">{r.code}{r.done ? '' : ' · in progress'}</div>
              </div>
              <div className="mt-2 space-y-0.5 text-sm">
                <div>🥇 {r.podium.first ?? '—'}</div>
                <div>🥈 {r.podium.second ?? '—'}</div>
                <div>🥉 {r.podium.third ?? '—'}</div>
              </div>
            </Link>
          ))}
        </div>
      </div>
    </div>
  )
}
