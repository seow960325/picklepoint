/** Board pieces for groups_ko events that opted into migration 0026
 *  (MCMD / MCXD): group tables with point difference + coin-toss marker,
 *  the shared "up next" court queue, and the game clock. Nothing here is
 *  rendered for an event that didn't opt in. */
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, EventCfg, Match } from '../lib/types'
import type { Standing } from '../lib/store'
import { teamName, teamLogo, teamSideName } from '../lib/store'
import { upNext, fmtClock, poolQueue, teamsBusy } from '../lib/pool'
import { Emblem, Pill } from './ui'

// ------------------------------------------------------------------ clock
/** Running time since the first point of a live game, or the recorded game
 *  time (first point → last point) once it is finished. */
export function PlayClock({ m, className = '' }: { m: Match; className?: string }) {
  const live = (m.status === 'live' || m.status === 'awaiting_confirm') && m.started_at != null
    && (m.score_a > 0 || m.score_b > 0)
  const [, tick] = useState(0)
  useEffect(() => {
    if (!live || m.status !== 'live') return
    const id = setInterval(() => tick(t => t + 1), 1000)
    return () => clearInterval(id)
  }, [live, m.status])
  const sec = m.status === 'finished'
    ? m.duration_seconds
    : live ? (Date.now() - Date.parse(m.started_at!)) / 1000 : null
  if (sec == null) return null
  return (
    <span className={`tabular inline-flex shrink-0 items-center gap-1 whitespace-nowrap ${className}`}
      title={m.status === 'finished' ? 'Game time (first point to last point)' : 'Time since the first point'}>
      <svg viewBox="0 0 24 24" className="h-[1em] w-[1em]" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
        <circle cx="12" cy="13" r="8" /><path d="M12 9v4l2.5 2.5M9 2h6" />
      </svg>
      {fmtClock(sec)}
    </span>
  )
}

// ------------------------------------------------------------------ tables
/** One group: # | team | P | W | L | +/- . The qualifying place is marked;
 *  teams still level after head-to-head carry a "coin toss" tag. */
export function GroupTable({ b, g, rows, advance, big = false }: {
  b: Bundle; g: string; rows: Standing[]; advance: number; big?: boolean
}) {
  const cell = big ? 'py-2.5 text-base' : 'py-1.5'
  // a coin toss is only news once the group is over and the tie straddles
  // the qualifying line (mid-group, level teams simply haven't met yet)
  const ids = new Set(rows.map(r => r.team.id))
  const finished = b.matches
    .filter(m => m.bracket_key == null && ids.has(m.team_a_id!) && ids.has(m.team_b_id!))
    .every(m => m.status === 'finished')
  const tossAt = (i: number) => {
    const r = rows[i]
    if (!finished || r.tieGroup == null) return false
    const same = rows.map((x, k) => x.tieGroup === r.tieGroup ? k : -1).filter(k => k >= 0)
    return same.some(k => k < advance) && same.some(k => k >= advance)
  }
  return (
    <table className={`w-full table-fixed ${big ? 'text-base' : 'text-sm'}`}>
      <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
        <tr>
          <th className="w-7 px-1 py-1 text-center">#</th>
          <th className="px-1 py-1 text-left">Group {g}</th>
          <th className="w-7 px-1 py-1 text-right">P</th>
          <th className="w-7 px-1 py-1 text-right">W</th>
          <th className="w-7 px-1 py-1 text-right">L</th>
          <th className="w-11 px-2 py-1 text-right" title="Point difference: points won minus points lost">+/-</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => {
          const q = i < advance
          return (
            <tr key={r.team.id} className={i === advance - 1 && i < rows.length - 1 ? 'border-b-2 border-dashed !border-line-strong' : ''}>
              <td className={`tabular px-1 ${cell} text-center text-xs font-bold ${q ? 'text-brand-ink' : 'text-fg-subtle'}`}>{i + 1}</td>
              <td className={`px-1 ${cell}`}>
                <span className="flex min-w-0 items-start gap-1.5">
                  <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)}
                    className="mt-0.5 h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                  <span className="min-w-0 flex-1">
                    <span className={`block ${big ? 'line-clamp-2 break-words leading-tight' : 'truncate'} ${q ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                      {r.team.name}
                    </span>
                    {tossAt(i) && (
                      <span className="mt-0.5 inline-block whitespace-nowrap rounded bg-gold/20 px-1 text-[9px] font-bold uppercase leading-4 text-gold">level · coin toss</span>
                    )}
                  </span>
                </span>
              </td>
              <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{r.played}</td>
              <td className={`tabular px-1 ${cell} text-right font-bold ${q ? 'text-fg' : 'text-fg-muted'}`}>{r.won}</td>
              <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{r.lost}</td>
              <td className={`tabular px-2 ${cell} text-right ${r.diff > 0 ? 'text-brand-ink' : r.diff < 0 ? 'text-red-400' : 'text-fg-muted'}`}>
                {r.diff > 0 ? `+${r.diff}` : r.diff}
              </td>
            </tr>
          )
        })}
      </tbody>
    </table>
  )
}

/** Group card for the Matches tab: table + (tap to open) that group's games
 *  with score and game time. */
export function GroupCardPro({ b, code, g, rows, advance, matches }: {
  b: Bundle; code: string; g: string; rows: Standing[]; advance: number; matches: Match[]
}) {
  const [open, setOpen] = useState(false)
  const played = matches.filter(m => m.status === 'finished').length
  return (
    <div className="overflow-hidden rounded-xl border border-line bg-surface">
      <div className="px-2 pt-2">
        <GroupTable b={b} g={g} rows={rows} advance={advance} />
      </div>
      <button onClick={() => setOpen(o => !o)}
        className="flex min-h-[36px] w-full items-center justify-between gap-2 border-t border-line px-3 py-2 text-[11px] text-fg-subtle active:bg-surface-2">
        <span className="min-w-0 truncate whitespace-nowrap">{played}/{matches.length} games played</span>
        <span className="shrink-0 whitespace-nowrap font-semibold">{open ? 'hide games ▴' : 'show games ▾'}</span>
      </button>
      {open && (
        <div className="border-t border-line">
          {matches.map(m => <GameRow key={m.id} b={b} code={code} m={m} />)}
        </div>
      )}
    </div>
  )
}

/** name+logo | score | name+logo | game time — fixed tracks so every row
 *  lines up whatever the names or status. */
export function GameRow({ b, code, m, tag }: { b: Bundle; code: string; m: Match; tag?: string }) {
  const decided = m.status === 'finished'
  const live = m.status === 'live' || m.status === 'awaiting_confirm'
  const aWin = decided && m.winner_id === m.team_a_id
  const bWin = decided && m.winner_id === m.team_b_id
  const name = (win: boolean) => win ? 'font-bold text-gold' : 'text-fg-muted'
  return (
    <Link to={`/c/${code}/match/${m.id}`}
      className={`grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 border-b border-line/60 px-3 py-2 text-xs last:border-0 active:bg-surface-2 ${live ? 'bg-brand/[0.06]' : ''}`}>
      <span className={`flex min-w-0 items-center justify-end gap-1.5 ${name(aWin)}`}>
        <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
        <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
      </span>
      <span className="flex justify-center">
        {decided || live
          ? <span className={`tabular whitespace-nowrap font-display text-sm font-bold ${live ? 'text-brand-ink' : 'text-fg'}`}>{m.score_a}–{m.score_b}</span>
          : <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">{tag ?? 'vs'}</span>}
      </span>
      <span className={`flex min-w-0 items-center gap-1.5 ${name(bWin)}`}>
        <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
        <span className="truncate">{teamName(b, m.team_b_id)}</span>
      </span>
      <span className="flex justify-end text-[11px] text-fg-subtle">
        {live && m.status === 'live' && !(m.score_a || m.score_b) ? <Pill tone="live">live</Pill> : <PlayClock m={m} />}
      </span>
    </Link>
  )
}

// ------------------------------------------------------------------ queue
/** Shared court queue (court_dispatch = 'pool'): the next games in order. A
 *  game whose team is still on court is marked — a free court skips it and
 *  takes the next one. */
export function UpNextQueue({ b, ev, n = 6, big = false }: { b: Bundle; ev: EventCfg; n?: number; big?: boolean }) {
  const list = upNext(b, ev.id, n)
  const poolOf = (id: string | null) => b.teams.find(t => t.id === id)?.pool ?? '–'
  const courtNo = (id?: string | null) => b.courts.find(c => c.id === id)?.number
  return (
    <div className="rounded-2xl border border-line bg-surface p-3">
      <div className="mb-1.5 flex items-center justify-between gap-2">
        <span className={`min-w-0 truncate whitespace-nowrap font-display font-bold uppercase tracking-widest text-accent ${big ? 'text-base' : 'text-sm'}`}>Up next</span>
        <span className="shrink-0 whitespace-nowrap text-[10px] text-fg-subtle">each group plays on its home court</span>
      </div>
      {list.length === 0 ? (
        <div className="py-1.5 text-xs text-fg-subtle">No group games waiting.</div>
      ) : (
        <div className="divide-y divide-line/60">
          {list.map(({ m, waiting }, i) => (
            <div key={m.id}
              className={`grid grid-cols-[1.25rem_3.25rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-center gap-1.5 py-1.5 ${big ? 'text-base' : 'text-sm'} ${waiting ? 'opacity-60' : ''}`}>
              <span className="text-center font-display text-xs font-bold text-fg-subtle">{i + 1}</span>
              <span className="whitespace-nowrap text-center text-[10px] font-bold text-fg-subtle">
                {courtNo(m.home_court) ? `CT${courtNo(m.home_court)} · ` : ''}{poolOf(m.team_a_id)}
              </span>
              <span className="flex min-w-0 items-center justify-end gap-1.5 text-fg-muted">
                <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
                <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-3.5 w-3.5 shrink-0 rounded-[1px] object-contain" />
              </span>
              <span className="text-center text-xs text-fg-subtle">vs</span>
              <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-3.5 w-3.5 shrink-0 rounded-[1px] object-contain" />
                <span className="truncate">{teamName(b, m.team_b_id)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

/** One "up next" list under each court (same column rule as the court cards
 *  above, so list and court line up): that court's home-group games in queue
 *  order. A game whose team is still on court is dimmed. */
export function CourtQueues({ b, ev, cols, n = 6 }: { b: Bundle; ev: EventCfg; cols: string; n?: number }) {
  const queue = poolQueue(b, ev.id)
  const poolOf = (id: string | null) => b.teams.find(t => t.id === id)?.pool ?? '–'
  return (
    <div className={`grid gap-2 lg:gap-3 ${cols}`}>
      {b.courts.map(ct => {
        const mine = queue.filter(m => m.home_court === ct.id).slice(0, n)
        return (
          <div key={ct.id} className="min-w-0 rounded-2xl border border-line bg-surface p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className="min-w-0 truncate whitespace-nowrap font-display text-xs font-bold uppercase tracking-widest text-fg-muted">Court {ct.number} · up next</span>
              <span className="shrink-0 whitespace-nowrap text-[10px] text-fg-subtle">{queue.filter(m => m.home_court === ct.id).length} left</span>
            </div>
            {mine.length === 0 ? (
              <div className="py-1.5 text-xs text-fg-subtle">No group games waiting.</div>
            ) : (
              <div className="divide-y divide-line/60">
                {mine.map((m, i) => (
                  <div key={m.id}
                    className={`grid grid-cols-[1.1rem_1.1rem_minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-1.5 py-1.5 text-sm ${teamsBusy(b, m) ? 'opacity-60' : ''}`}>
                    <span className="text-center font-display text-xs font-bold text-fg-subtle">{i + 1}</span>
                    <span className="text-center text-[10px] font-bold text-fg-subtle">{poolOf(m.team_a_id)}</span>
                    <span className="flex min-w-0 items-center justify-end gap-1.5 text-fg-muted">
                      <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
                      <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-3.5 w-3.5 shrink-0 rounded-[1px] object-contain" />
                    </span>
                    <span className="text-center text-xs text-fg-subtle">vs</span>
                    <span className="flex min-w-0 items-center gap-1.5 text-fg-muted">
                      <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-3.5 w-3.5 shrink-0 rounded-[1px] object-contain" />
                      <span className="truncate">{teamName(b, m.team_b_id)}</span>
                    </span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </div>
  )
}
