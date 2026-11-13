/** Board pieces for groups_ko events that opted into migration 0026
 *  (MCMD / MCXD): group tables with point difference + coin-toss marker,
 *  the shared "up next" court queue, and the game clock. Nothing here is
 *  rendered for an event that didn't opt in. */
import { useEffect, useMemo, useState } from 'react'
import { usePinned } from '../lib/pin'
import { Link } from 'react-router-dom'
import FillGrid from './FillGrid'
import type { Bundle, EventCfg, Match } from '../lib/types'
import type { Standing } from '../lib/store'
import { teamName, teamLogo, teamSideName, groupStandings } from '../lib/store'
import { koPlanOf, planDraw } from '../lib/koplan'
import { upNext, fmtClock, poolQueue, teamsBusy, stageName } from '../lib/pool'
import { plannedTime, plannedCourt } from '../lib/timetable'
import { Emblem, Pill, PairName, StackName, ScoreWL, Clock } from './ui'

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
  // a game left open for hours (paused, forgotten) would show a nonsense time on the TV
  if (sec == null || sec < 0 || sec > 3 * 3600) return null
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
export function GroupTable({ b, g, rows, advance, big = false, huge = false }: {
  b: Bundle; g: string; rows: Standing[]; advance: number; big?: boolean; huge?: boolean
}) {
  // huge = one category on the whole TV: much larger type, rows stretch to the card's height
  // TV (big / huge): photo logo large, one-line names in a lighter weight, no P column
  const tv = big || huge
  // wins, then +/-, then points scored (printed-plan events): show the third number too
  const showPf = !tv && b.events.find(e => e.id === rows[0]?.team.event_id)?.tiebreak === 'diff_only'
  const pins = usePinned()
  // printed-plan events (MCMD / MCXD): mark only the teams the plan sends to the quarter-finals
  // (group winners + the best runners-up), not every runner-up
  const evId = rows[0]?.team.event_id
  const qual = useMemo(() => {
    const plan = koPlanOf(b.competition?.code)
    if (!plan || !evId) return null
    const pd = planDraw(plan, groupStandings(b, evId) as any)
    return new Set(pd.pairs.flat().filter((x): x is string => !!x))
  }, [b, evId])
  const [open, setOpen] = useState<string | null>(null)
  // every team gets the same fixed row (logo height + a little air), never stretched
  const cell = huge ? 'py-0 align-middle text-lg' : big ? 'py-0 align-middle text-base' : 'py-1.5'
  const rowH = huge ? 'h-16' : big ? 'h-14' : ''
  const wN = tv ? 'w-9' : 'w-7'
  const logo = huge ? 'h-12 w-[3.75rem]' : big ? 'h-11 w-14' : 'h-7 w-9'
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
    <>
    <table className={`w-full table-fixed ${huge ? 'text-lg' : big ? 'text-base' : 'text-sm'}`}>
      <thead className={`${tv ? 'text-xs' : 'text-[10px]'} uppercase tracking-wider text-fg-subtle`}>
        <tr>
          <th className="w-7 px-1 py-1 text-center">#</th>
          <th className="px-1 py-1 text-left">Group {g}</th>
          {!tv && <th className={`${wN} px-1 py-1 text-right`}>P</th>}
          <th className={`${wN} px-1 py-1 text-right`}>W</th>
          <th className={`${wN} px-1 py-1 text-right`}>L</th>
          <th className={`${tv ? 'w-14' : 'w-11'} px-2 py-1 text-right`} title="Point difference: points won minus points lost">+/-</th>
          {showPf && <th className="w-9 px-1 py-1 text-right" title="Points scored">Pts</th>}
        </tr>
      </thead>
      <tbody className="divide-y divide-line">
        {rows.map((r, i) => {
          const q = qual ? qual.has(r.team.id) : i < advance
          return (
            <tr key={r.team.id} onClick={tv ? undefined : () => setOpen(r.team.id)} className={`${tv ? '' : 'cursor-pointer active:bg-surface-2'} ${rowH} ${q ? 'bg-brand/[0.08]' : ''} ${pins.has(r.team.id) ? 'outline outline-2 -outline-offset-2 outline-gold/70' : ''} ${!qual && i === advance - 1 && i < rows.length - 1 ? 'border-b-2 border-dashed !border-line-strong' : ''}`}>
              <td className={`tabular px-1 ${cell} text-center ${tv ? 'text-sm' : 'text-xs'} ${tv ? 'font-medium' : 'font-bold'} ${q ? 'text-brand-ink' : 'text-fg-subtle'}`}>{i + 1}</td>
              <td className={`px-1 ${cell}`}>
                <span className={`flex min-w-0 gap-2 ${tv ? 'items-center' : 'items-start gap-1.5'}`}>
                  <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)}
                    className={`shrink-0 rounded-[2px] object-contain ${tv ? '' : 'mt-0.5'} ${logo}`} />
                  <span className="min-w-0 flex-1">
                    <span className={`block ${tv ? 'whitespace-nowrap leading-none' : 'truncate underline decoration-line-strong decoration-dotted underline-offset-4'} ${tv ? 'font-normal' : q ? 'font-semibold' : ''} ${q ? 'text-fg' : 'text-fg-muted'}`}>
                      {r.team.name}
                    </span>
                    {tossAt(i) && (
                      <span className="mt-0.5 inline-block whitespace-nowrap rounded bg-gold/20 px-1 text-[10px] font-bold uppercase leading-4 text-gold">level · coin toss</span>
                    )}
                  </span>
                </span>
              </td>
              {!tv && <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{r.played}</td>}
              <td className={`tabular px-1 ${cell} text-right ${tv ? 'font-medium' : 'font-bold'} ${q ? 'text-fg' : 'text-fg-muted'}`}>{r.won}</td>
              <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{r.lost}</td>
              <td className={`tabular px-2 ${cell} text-right ${r.diff > 0 ? 'text-brand-ink' : r.diff < 0 ? 'text-red-400' : 'text-fg-muted'}`}>
                {r.diff > 0 ? `+${r.diff}` : r.diff}
              </td>
              {showPf && <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{r.pf}</td>}
            </tr>
          )
        })}
      </tbody>
    </table>
    {open && <TeamGames b={b} id={open} onClose={() => setOpen(null)} />}
    </>
  )
}

/** Tap a team in a group table: every group game it played, the score, and how its +/- adds up. */
export function TeamGames({ b, id, onClose }: { b: Bundle; id: string; onClose: () => void }) {
  const mine = b.matches.filter(m => !m.tie_stage && (m.team_a_id === id || m.team_b_id === id)).sort((x, y) => x.sequence - y.sequence)
  const side = (m: Match) => {
    const a = m.team_a_id === id
    return { opp: a ? m.team_b_id : m.team_a_id, us: a ? m.score_a : m.score_b, them: a ? m.score_b : m.score_a }
  }
  const played = mine.filter(m => m.status === 'finished').map(m => ({ m, ...side(m), won: m.winner_id === id }))
  const coming = mine.filter(m => m.status !== 'finished')
  const grp = played.filter(g => g.m.bracket_key == null)
  const pf = grp.reduce((t, g) => t + g.us, 0), pa = grp.reduce((t, g) => t + g.them, 0)
  const sign = (n: number) => n > 0 ? `+${n}` : String(n)
  const diffOnly = b.events.find(e => e.id === b.teams.find(t => t.id === id)?.event_id)?.tiebreak === 'diff_only'
  const tone = (n: number) => n > 0 ? 'text-brand-ink' : n < 0 ? 'text-red-400' : 'text-fg-muted'
  const head = 'px-1 pb-1 pt-3 text-[10px] font-bold uppercase tracking-wider text-fg-subtle'
  const cols = 'grid grid-cols-[minmax(0,1fr)_6.5rem_2.75rem] items-center gap-2 px-1'
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={e => { e.preventDefault(); e.stopPropagation(); onClose() }}>
      <div onClick={e => { e.preventDefault(); e.stopPropagation() }} className="w-full max-w-md rounded-t-2xl border border-line bg-canvas sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-xl font-bold leading-tight"><PairName name={teamName(b, id)} /></div>
            <div className="text-xs text-fg-muted">Played {played.length} · won {played.filter(g => g.won).length}{coming.length > 0 ? ` · ${coming.length} to come` : ''}</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-fg">Done</button>
        </div>
        <div className="max-h-[65vh] overflow-y-auto px-3 pb-3">
          <div className={head}>Games played</div>
          {played.length === 0 && <div className="py-3 text-center text-sm text-fg-muted">No game played yet.</div>}
          {played.length > 0 && (
            <div className="divide-y divide-line">
              {played.map(g => (
                <div key={g.m.id} className={`${cols} py-2`}>
                  <div className="min-w-0">
                    <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
                      <span className="inline-block w-3 shrink-0 text-center text-xs font-bold text-fg-subtle">vs</span>
                      <span className="min-w-0 truncate"><PairName name={teamName(b, g.opp)} /></span>
                    </div>
                    <div className="pl-[1.125rem] text-[10px] text-fg-subtle">{stageName(b, g.m)}</div>
                  </div>
                  <div className="text-center font-display font-bold"><ScoreWL us={g.us} them={g.them} wl={g.won ? 'W' : 'L'} /></div>
                  <div className={`tabular text-right text-sm font-bold ${tone(g.us - g.them)}`}>{sign(g.us - g.them)}</div>
                </div>
              ))}
              {grp.length > 0 && (
                <div className={`${cols} border-t-2 border-line-strong py-2`}>
                  <div className="text-xs font-bold uppercase tracking-wider text-fg-muted">Group total</div>
                  <div className="text-center font-display font-bold"><ScoreWL us={pf} them={pa} wl={null} digits={3} /></div>
                  <div className={`tabular text-right font-display text-base font-bold ${tone(pf - pa)}`}>{sign(pf - pa)}</div>
                </div>
              )}
              {grp.length > 0 && (
                <div className="px-1 py-2 text-[11px] leading-snug text-fg-subtle">
                  +/- = points won minus points lost in the group games: {pf} − {pa} = {sign(pf - pa)}.{diffOnly ? ` Ranking: wins, then +/-, then points scored (${pf}).` : ''}
                </div>
              )}
            </div>
          )}
          {coming.length > 0 && (
            <>
              <div className={head}>Coming up</div>
              <div className="divide-y divide-line">
                {coming.map(m => {
                  const o = side(m).opp, t = plannedTime(b, m), c = plannedCourt(b, m)
                  const live = m.status === 'live' || m.status === 'awaiting_confirm'
                  return (
                    <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-2 px-1 py-2">
                      <div className="min-w-0">
                        <div className="flex min-w-0 items-baseline gap-1.5 text-sm">
                          <span className="inline-block w-3 shrink-0 text-center text-xs font-bold text-fg-subtle">vs</span>
                          <span className="min-w-0 truncate">{o ? <PairName name={teamName(b, o)} /> : <span className="text-fg-subtle">to be decided</span>}</span>
                        </div>
                        <div className="pl-[1.125rem] text-[10px] text-fg-subtle">{stageName(b, m)}</div>
                      </div>
                      <div className="tabular whitespace-nowrap text-right text-xs font-bold text-fg-muted">
                        {live ? <span className="text-emerald-400">LIVE {m.score_a}–{m.score_b}</span> : <>{t || ''}{t && c != null ? ' · ' : ''}{c != null ? `Court ${c}` : ''}{!t && c == null ? '—' : ''}</>}
                      </div>
                    </div>
                  )
                })}
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

/** A team name you can tap: opens that team's played + coming games. */
export function TeamLink({ b, id, children, className = '' }: { b: Bundle; id: string | null | undefined; children: React.ReactNode; className?: string }) {
  const [open, setOpen] = useState(false)
  if (!id) return <>{children}</>
  return (
    <>
      <span role="button" tabIndex={0} onClick={e => { e.preventDefault(); e.stopPropagation(); setOpen(true) }}
        onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); e.stopPropagation(); setOpen(true) } }}
        className={`cursor-pointer underline decoration-line-strong decoration-dotted underline-offset-4 ${className}`}>{children}</span>
      {open && <TeamGames b={b} id={id} onClose={() => setOpen(false)} />}
    </>
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
      className={`grid grid-cols-[minmax(0,1fr)_1.5rem_3.5rem_1.5rem_minmax(0,1fr)_3.25rem] items-center gap-2 border-b border-line/60 px-3 py-2 text-xs last:border-0 active:bg-surface-2 ${live ? 'bg-brand/[0.06]' : ''}`}>
      <span className={`truncate text-right ${name(aWin)}`}><TeamLink b={b} id={m.team_a_id}><PairName name={teamName(b, m.team_a_id)} /></TeamLink></span>
      <span className="flex h-6 w-6 items-center justify-center">{m.team_a_id && <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
      <span className="flex justify-center">
        {decided || live
          ? <span className={`tabular whitespace-nowrap font-display text-sm font-bold ${live ? 'text-brand-ink' : 'text-fg'}`}>{m.score_a}–{m.score_b}</span>
          : <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">{tag ?? 'vs'}</span>}
      </span>
      <span className="flex h-6 w-6 items-center justify-center">{m.team_b_id && <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
      <span className={`truncate text-left ${name(bWin)}`}><TeamLink b={b} id={m.team_b_id}><PairName name={teamName(b, m.team_b_id)} /></TeamLink></span>
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
  const mc = !!b.competition.multi_sport
  const poolOf = (id: string | null) => b.teams.find(t => t.id === id)?.pool ?? '–'
  const courtNo = (id?: string | null) => {
    const c = b.courts.find(c => c.id === id)
    return c ? (b.competition.multi_sport && c.label ? c.label.toUpperCase() : `Court ${c.number}`) : undefined
  }
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
              className={`grid grid-cols-[1.25rem_3.25rem_minmax(0,1fr)_1.25rem_1.75rem_1.25rem_minmax(0,1fr)] items-center gap-1.5 py-1.5 ${big ? 'text-base' : 'text-sm'} ${waiting ? 'opacity-60' : ''}`}>
              <span className="text-center font-display text-xs font-bold text-fg-subtle">{i + 1}</span>
              <span className="whitespace-nowrap text-center text-[10px] font-bold text-fg-subtle">
                {courtNo(m.home_court) ? `${courtNo(m.home_court)} · ` : ''}{poolOf(m.team_a_id)}
              </span>
              <span className="truncate text-right text-fg-muted"><TeamLink b={b} id={m.team_a_id}><PairName name={teamName(b, m.team_a_id)} /></TeamLink></span>
              <span className="flex h-5 w-5 items-center justify-center">{m.team_a_id && <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-5 w-5 shrink-0 rounded-[3px]" />}</span>
              <span className="text-center text-xs text-fg-subtle">vs</span>
              <span className="flex h-5 w-5 items-center justify-center">{m.team_b_id && <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-5 w-5 shrink-0 rounded-[3px]" />}</span>
              <span className="truncate text-left text-fg-muted"><TeamLink b={b} id={m.team_b_id}><PairName name={teamName(b, m.team_b_id)} /></TeamLink></span>
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
export function CourtQueues({ b, ev, max = 4, n = 6, big = false, courts }: { b: Bundle; ev: EventCfg; max?: number; n?: number; big?: boolean; courts?: Bundle['courts'] }) {
  const queue = poolQueue(b, ev.id)
  if (queue.length === 0) return null   // knockout rounds: nothing queued per court
  const mc = !!b.competition.multi_sport
  const poolOf = (id: string | null) => b.teams.find(t => t.id === id)?.pool ?? '–'
  const timed = !big && queue.some(m => plannedTime(b, m))   // printed timetable: show each game's planned time
  return (
    <FillGrid max={max} className="gap-2 lg:gap-3">
      {(courts ?? b.courts).map(ct => {
        const mine = queue.filter(m => m.home_court === ct.id).slice(0, n)
        // church logos take room (YC26): names a size smaller there so they still show in full
        const logos = mine.some(m => teamLogo(b, m.team_a_id) || teamLogo(b, m.team_b_id))
        return (
          <div key={ct.id} className="min-w-0 rounded-2xl border border-line bg-surface p-3">
            <div className="mb-1.5 flex items-center justify-between gap-2">
              <span className={`min-w-0 truncate whitespace-nowrap font-display font-bold uppercase tracking-widest text-fg-muted ${big ? 'text-xl' : mc ? 'text-sm lg:text-lg' : 'text-xs'}`}>{b.competition.multi_sport && ct.label ? ct.label : `Court ${ct.number}`} · up next</span>
              <span className={`shrink-0 whitespace-nowrap text-fg-subtle ${big ? 'text-base' : 'text-[10px]'}`}>{queue.filter(m => m.home_court === ct.id).length} left</span>
            </div>
            {mine.length === 0 ? (
              <div className="py-1.5 text-xs text-fg-subtle">No group games waiting.</div>
            ) : (
              // phone / board: one grid for the whole court, so "vs" sits in one column with the same
              // space on both sides on every row; spare width is shared evenly around the names and the vs
              <div className={big ? 'divide-y divide-line/60' : 'grid divide-y divide-line/60 gap-x-1.5'}
                style={big ? undefined : { gridTemplateColumns: `${timed ? 'max-content ' : ''}max-content max-content minmax(0,1fr) minmax(0,max-content) minmax(0,1fr) auto minmax(0,1fr) minmax(0,max-content) minmax(0,1fr)` }}>
                {!big && (
                  <div className="grid items-end pb-1 text-[9px] font-bold uppercase tracking-wider text-fg-subtle lg:text-[11px]" style={{ gridColumn: '1 / -1', gridTemplateColumns: 'subgrid' }}>
                    {timed && <span>Time</span>}
                    <span className="text-center">No.</span>
                    <span className="text-center">Grp</span>
                    <span /><span /><span /><span /><span /><span /><span />
                  </div>
                )}
                {mine.map((m, i) => (
                  <div key={m.id}
                    style={big ? undefined : { gridColumn: '1 / -1', gridTemplateColumns: 'subgrid' }}
                    className={`grid ${big ? 'grid-cols-[1.6rem_1.6rem_minmax(0,1fr)_2.2rem_minmax(0,1fr)] gap-2 py-2.5 text-2xl' : logos ? 'py-1.5 text-[13px]' : 'py-1.5 text-sm'} ${mc && !big ? 'lg:!text-xl lg:!py-2' : ''} grid items-center ${teamsBusy(b, m) ? 'opacity-60' : ''}`}>
                    {timed && <span className="tabular whitespace-nowrap font-display text-xs font-bold text-fg-muted lg:text-base"><Clock t={plannedTime(b, m)} /></span>}
                    <span className={`text-center font-display font-bold text-fg-subtle ${big ? 'text-lg' : 'text-xs'}`}>{i + 1}</span>
                    <span className={`text-center font-bold text-fg-subtle ${big ? 'text-base' : 'text-[10px]'}`}>{poolOf(m.team_a_id)}</span>
                    {!big && <span aria-hidden="true" />}
                    <span className={`flex min-w-0 items-center justify-start ${big ? 'gap-1.5' : 'gap-1'} text-fg-muted`}>
                      <span className={`min-w-0 flex-1 text-left ${big ? 'truncate' : ''}`}><TeamLink b={b} id={m.team_a_id}>{big ? <PairName name={teamName(b, m.team_a_id)} /> : <StackName name={teamName(b, m.team_a_id)} align="left" />}</TeamLink></span>
                      <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={`shrink-0 rounded-[2px] object-contain ${big ? 'h-6 w-6' : 'h-3.5 w-3.5'}`} />
                    </span>
                    {!big && <span aria-hidden="true" />}
                    <span className={`text-center text-fg-subtle ${big ? 'text-lg' : 'px-1.5 text-xs'}`}>vs</span>
                    {!big && <span aria-hidden="true" />}
                    <span className={`flex min-w-0 items-center justify-start ${big ? 'gap-1.5' : 'gap-1'} text-fg-muted`}>
                      <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={`shrink-0 rounded-[2px] object-contain ${big ? 'h-6 w-6' : 'h-3.5 w-3.5'}`} />
                      <span className={`min-w-0 text-left ${big ? 'truncate' : ''}`}><TeamLink b={b} id={m.team_b_id}>{big ? <PairName name={teamName(b, m.team_b_id)} /> : <StackName name={teamName(b, m.team_b_id)} align="left" />}</TeamLink></span>
                    </span>
                    {!big && <span aria-hidden="true" />}
                  </div>
                ))}
              </div>
            )}
          </div>
        )
      })}
    </FillGrid>
  )
}
