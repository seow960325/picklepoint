/** Hub front page: Total Champion medal table + one card per category with
 *  where it stands right now. Category codes are read once and every 30 s
 *  (no live channel each, so 200 phones don't open 5 connections apiece). */
import { TeamLink } from './GroupsKo'
import { SportIcon } from './SportIcon'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle } from '../lib/types'
import * as api from '../lib/api'
import { Emblem, Clock } from './ui'
import { teamLogo, teamSideName, groupStandings } from '../lib/store'
import type { Hub } from '../lib/hub'
import { categoryResult, medalTable, needsFourth, type MedalRow } from '../lib/medals'
import { finalSeries } from '../lib/finals'
import { cbKo } from '../lib/captainball'
import { teamChurch } from '../lib/churches'
import { slotRows, slotTime, clockOfCode, type SlotRow } from '../lib/timetable'
import MapButton, { CourtTag } from './CourtMap'
import { gameTitle, koSlotLabel, provisionalTeam, slotStage, stageName } from '../lib/pool'

export function useOthers(codes: string[], everyMs = 30000) {
  const [got, setGot] = useState<Record<string, Bundle | null>>({})
  useEffect(() => {
    let alive = true
    const load = () => Promise.all(codes.map(c => api.refresh(c, { light: true }).then(b => [c, b] as const, () => [c, null] as const)))
      .then(rows => { if (alive) setGot(Object.fromEntries(rows)) })
    load()
    const id = setInterval(load, everyMs)
    return () => { alive = false; clearInterval(id) }
  }, [codes.join(',')])
  return got
}

/** One line: where this category is. */
function statusOf(b: Bundle): { text: string; live: number; champ: string | null } {
  const live = b.matches.filter(m => m.status === 'live' && !!m.started_at).length
  const name = (id: string | null) => b.teams.find(t => t.id === id)?.name ?? null
  const ko = b.events.find(e => e.format === 'groups_ko')
  const cb = b.events.find(e => e.sport === 'captainball')
  if (ko) {
    const fs = finalSeries(b, ko.id)
    if (fs?.winner) return { text: 'Finished', live, champ: name(fs.winner) }
    const grp = b.matches.filter(m => m.event_id === ko.id && !m.bracket_key)
    const done = grp.filter(m => m.status === 'finished').length
    if (done < grp.length) return { text: `Groups · ${done}/${grp.length} games played`, live, champ: null }
    const kos = b.matches.filter(m => m.event_id === ko.id && m.bracket_key && m.team_a_id && m.team_b_id && m.status !== 'finished')
    const round = kos.sort((x, y) => x.sequence - y.sequence)[0]?.round
    return { text: round ? (round === 'Third place' ? '3rd place / Final' : round) : 'Groups done · knockout next', live, champ: null }
  }
  if (cb) {
    const k = cbKo(b, cb)
    if (k.podium) return { text: 'Finished', live, champ: k.podium.first.name }
    const grp = b.matches.filter(m => m.event_id === cb.id && !m.tie_stage)
    const done = grp.filter(m => m.status === 'finished').length
    if (done < grp.length) return { text: `Groups · ${done}/${grp.length} games played`, live, champ: null }
    return { text: k.next?.label ?? 'Knockout', live, champ: null }
  }
  return { text: '', live, champ: null }
}

export default function HubOverview({ hub, self, onOpenSelf }: { hub: Hub; self: Bundle; onOpenSelf: () => void }) {
  const others = useOthers(hub.cats.map(c => c.code).filter(c => c !== hub.code), 15000)
  const bundleOf = (code: string) => (code === hub.code ? self : others[code] ?? null)
  const results = hub.cats.map(c => bundleOf(c.code)).filter((b): b is Bundle => !!b).map(categoryResult)
  const table = medalTable(results)

  return (
    <div className="mx-auto max-w-5xl space-y-6 px-4 py-5 lg:px-6">
      <LiveNext hub={hub} bundleOf={bundleOf} onOpen={c => (c === hub.code ? onOpenSelf() : undefined)} />

      <MedalTable hub={hub} bundleOf={bundleOf} />
    </div>
  )
}

// ------------------------------------------------------------ live & up next
const MINE = 'pp.hub.church'

/** Every category's games on court and coming up, in one list. A player picks
 *  their church once (kept on this phone) to see only their games. */
export function LiveNext({ hub, bundleOf, onOpen }: { hub: Hub; bundleOf: (code: string) => Bundle | null; onOpen: (code: string) => void }) {
  const [mine, setMine] = useState<string>(() => { try { return localStorage.getItem(MINE + hub.code) ?? '' } catch { return '' } })
  const [full, setFull] = useState<Record<string, boolean>>({})
  const pick = (c: string) => { setMine(c); try { localStorage.setItem(MINE + hub.code, c) } catch { /* private mode */ } }
  const cats = hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })).filter((x): x is { cat: typeof x.cat; b: Bundle } => !!x.b)
  const churches = [...new Set(cats.flatMap(x => x.b.teams.map(t => teamChurch(t))))].sort()
  const name = (b: Bundle, id: string | null) => b.teams.find(t => t.id === id)?.name ?? '—'
  const ours = (b: Bundle, m: Bundle['matches'][number]) => !mine || hub.noChurch
    || [m.team_a_id, m.team_b_id].some(id => { const t = b.teams.find(x => x.id === id); return !!t && teamChurch(t).toLowerCase() === mine.toLowerCase() })
  type M = Bundle['matches'][number]
  /** name | score (or vs) | name: score keeps its place, each name is centred in its half */
  const Pair = ({ b, m, score }: { b: Bundle; m: M; score?: boolean }) => {
    const ev = b.events.find(e => e.id === m.event_id)
    const side = (s: 'a' | 'b') => {
      const id = s === 'a' ? m.team_a_id : m.team_b_id
      const pid = id ?? (ev ? provisionalTeam(b, ev, m, s, groupStandings) : null)
      return pid ? name(b, pid) : ev && (ev.bracket_preview || ev.format === 'groups_ko') ? koSlotLabel(b, ev, m, s) : 'To be decided'
    }
    const done = m.status === 'finished'
    const cls = (s: 'a' | 'b') => {
      const id = s === 'a' ? m.team_a_id : m.team_b_id
      return `line-clamp-2 break-words text-center leading-tight ${!id ? 'italic text-fg-subtle' : done ? (m.winner_id === id ? 'font-bold text-fg' : 'text-fg-subtle') : score ? 'font-semibold' : ''}`
    }
    return (
      <div className={`grid grid-cols-[minmax(0,1fr)_1.5rem_3.5rem_1.5rem_minmax(0,1fr)] items-center gap-1 py-0.5 text-sm ${score ? '' : 'text-[13px]'}`}>
        <span className={cls('a') + ' !text-right'}><TeamLink b={b} id={m.team_a_id}>{side('a')}</TeamLink></span>
        <span className="flex h-6 w-6 items-center justify-center">{m.team_a_id && <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
        {score ? <span className="tabular text-center font-display font-bold">{m.score_a}–{m.score_b}</span> : <span className="text-center text-xs text-fg-subtle">vs</span>}
        <span className="flex h-6 w-6 items-center justify-center">{m.team_b_id && <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
        <span className={cls('b') + ' !text-left'}><TeamLink b={b} id={m.team_b_id}>{side('b')}</TeamLink></span>
      </div>
    )
  }
  /** One time slot: what every court has at that planned time (or "no game"). */
  const SlotBox = ({ b, r }: { b: Bundle; r: SlotRow }) => (
    <div className={`overflow-hidden rounded-lg border ${r.state === 'now' ? 'border-emerald-500/50' : 'border-line/70'}`}>
      <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${r.state === 'now' ? 'bg-emerald-500/10' : 'bg-surface-2/60'}`}>
        <span className="flex min-w-0 items-baseline gap-2">
          <span className="font-display text-base font-bold leading-none tracking-wide"><Clock t={r.time} /></span>
          {r.cells.some(c => c.m) && <span className="truncate text-xs font-bold uppercase tracking-wider text-fg-muted">{slotStage(b, r.cells.filter(c => c.m).map(c => c.m!))}</span>}
        </span>
        <span className={`text-[10px] font-bold uppercase tracking-wider ${r.state === 'now' ? 'text-emerald-400' : 'text-fg-subtle'}`}>
          {r.state === 'now' ? 'Now' : r.state === 'done' ? 'Finished' : 'Coming up'}
        </span>
      </div>
      {r.cells.map(c => {
        const live = !!c.m && (c.m.status === 'live' || c.m.status === 'awaiting_confirm')
        return (
          <div key={c.court} className="border-t border-line/50 px-2.5 py-1.5">
            <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
              <span className={live ? 'text-emerald-400' : 'text-fg-subtle'}>{live ? '● ' : ''}<CourtTag code={b.competition.code} n={c.court}>Court {c.court}</CourtTag></span>
              {c.m && <span className="font-semibold normal-case tracking-normal text-fg-subtle">· {c.m.bracket_key ? stageName(b, c.m) : gameTitle(b, c.m).replace(/ · Slot \d+$/, '').replace(/^Round robin · /, '')}</span>}
              {live && <span className="ml-auto text-emerald-400">live</span>}
              {!c.m && <span className="font-semibold normal-case tracking-normal text-fg-subtle">· no game</span>}
            </div>
            {c.m && <div className={c.m.status === 'finished' ? '' : live ? '' : 'text-fg-muted'}><Pair b={b} m={c.m} score={live || c.m.status === 'finished'} /></div>}
          </div>
        )
      })}
    </div>
  )
  const courtNo = (c: Bundle['courts'][number]) => Number(/(\d+)\s*$/.exec(c.label ?? '')?.[1] ?? c.number)
  const blocks = hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })).map(({ cat, b }) => {
    if (!b) return { cat, b, rows: [] as { id: string; label: string; live?: M; next?: M }[], spare: [] as M[], slots: null as SlotRow[] | null }
    const ok = (m: M) => m.team_a_id && m.team_b_id && ours(b, m)
    const live = b.matches.filter(m => (m.status === 'live' || m.status === 'awaiting_confirm') && ok(m)).sort((x, y) => x.sequence - y.sequence)
    const queued = b.matches.filter(m => (m.status === 'scheduled' || m.status === 'on_deck') && ok(m)).sort((x, y) => x.sequence - y.sequence)
    const used = new Set<string>()
    const rows = [...b.courts].sort((x, y) => courtNo(x) - courtNo(y)).map(c => {
      const l = live.find(m => m.court_id === c.id)
      const n = queued.find(m => (m.court_id ?? m.home_court) === c.id)
      if (n) used.add(n.id)
      return { id: c.id, label: `Court ${courtNo(c)}`, live: l, next: n }
    }).filter(r => r.live || r.next)
    // games whose court is not decided yet (knockouts) - shown once, as the next in line
    const spare = queued.filter(m => !used.has(m.id) && !(m.court_id ?? m.home_court)).slice(0, mine ? 4 : 2)
    return { cat, b, rows, spare, slots: clockOfCode(cat.code) ? slotRows(b, clockOfCode(cat.code)!) : null }
  })

  const hm = (t: string) => slotTime({ start: t, every: 0 }, 1)
  return (
    <section>
      {hub.program && hub.program.length > 0 && !blocks.some(x => x.b?.matches.some(m => m.status === 'live' || m.status === 'awaiting_confirm' || m.status === 'finished')) && (
        <div className="mb-4 overflow-hidden rounded-xl border border-gold/40 bg-surface">
          <div className="border-b border-line/60 bg-gold/10 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.25em] text-gold">Programme · before the games</div>
          {hub.program.map(p => (
            <div key={p.from} className="grid grid-cols-[minmax(0,1fr)_auto] items-center gap-3 border-b border-line/50 px-3 py-2.5 last:border-0">
              <div className="min-w-0">
                <div className="font-display text-lg font-bold leading-tight">{p.label}</div>
                {p.zh && <div className="text-sm text-fg-muted">{p.zh}</div>}
              </div>
              <div className="flex items-baseline gap-1.5 font-display text-base font-bold">
                <Clock t={hm(p.from)} /><span className="text-fg-subtle">–</span><Clock t={hm(p.to)} />
              </div>
            </div>
          ))}
        </div>
      )}
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-fg-subtle">{hub.clock || hub.clocks ? 'Categories · what time, which court' : 'Categories · on court & up next'}</h2>
        {hub.clock?.breakAt && (() => {
          const [bh, bm] = hub.clock.breakAt.split(':').map(Number), e = bh * 60 + bm + (hub.clock.breakMins ?? 0)
          const f = (t: number) => slotTime({ start: `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, every: 0 }, 1)
          return <span className="rounded-full border border-gold/50 px-2.5 py-0.5 text-[11px] font-bold text-gold">Lunch break {f(bh * 60 + bm)} – {f(e)}</span>
        })()}
        {!hub.noChurch && <select value={mine} onChange={e => pick(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg">
          <option value="">All churches</option>
          {churches.map(c => <option key={c} value={c}>{c}</option>)}
        </select>}
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {blocks.map(({ cat, b, rows, spare, slots }) => {
          const st = b ? statusOf(b) : null
          const head = (
            <div className="flex items-center gap-2">
              <span className="text-xl leading-none"><SportIcon sport={cat.sport} /></span>
              <span className="min-w-0 flex-1 font-display text-base font-bold uppercase leading-tight tracking-wide">{cat.label}</span>
              {st && st.live > 0 && <span className="shrink-0 animate-pulse rounded bg-emerald-500 px-1.5 py-0.5 text-[10px] font-bold text-emerald-950">{st.live} LIVE</span>}
              <span className="shrink-0 text-fg-subtle">›</span>
            </div>
          )
          const body = (
            <>
              <button onClick={() => onOpen(cat.code)} className="block w-full text-left active:opacity-70">
              {head}
              <div className="mt-0.5 text-xs text-fg-muted">
                {!b ? 'Loading…' : st!.champ ? <>🏆 Champion: <span className="font-bold text-fg">{st!.champ}</span></> : st!.text}
              </div>
              </button>
              {(() => {
                const ck = clockOfCode(cat.code)
                const mc = hub.mapCourts?.[cat.code]
                const sport = ck?.sport ?? mc?.sport, courts = ck?.courts ?? mc?.courts
                return ck && (ck.lunch || (hub.map && sport)) ? (
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    {hub.map && sport && <MapButton src={hub.map} sport={sport} courts={courts} label={`Map · Court ${courts?.join(', ')}`} />}
                    {ck.lunch && <span className="rounded-full border border-gold/50 px-2 py-0.5 text-[11px] font-bold text-gold">Lunch {ck.lunch}</span>}
                  </div>
                ) : null
              })()}
              {slots && (() => {
                const cur = Math.max(0, slots.findIndex(r => r.state !== 'done'))
                const allDone = slots.every(r => r.state === 'done')
                const open = !!full[cat.code]
                const shown = open ? slots : allDone ? [] : slots.slice(cur, cur + 2)
                return (
                  <div className="mt-2 space-y-2 border-t border-line/60 pt-2">
                    {shown.map(r => <SlotBox key={r.slot} b={b!} r={r} />)}
                    <button onClick={() => setFull(f => ({ ...f, [cat.code]: !open }))}
                      className="min-h-[40px] w-full rounded-lg border border-line px-3 py-2 text-xs font-semibold text-fg-muted active:bg-surface-2">
                      {open ? 'Show less ▴' : `Full timetable · ${slots[0].time} – ${slots[slots.length - 1].time} ▾`}
                    </button>
                  </div>
                )
              })()}
              {!slots && (rows.length > 0 || spare.length > 0) && <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
                {rows.map(r => (
                  <div key={r.id}>
                    <div className="rounded-lg bg-surface-2/50 px-2 py-1.5">
                      <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                        <span className={r.live ? 'text-emerald-400' : 'text-fg-subtle'}>{r.live ? '● ' : ''}{r.label}</span>
                        {r.live && <span className="text-emerald-400/80">live</span>}
                      </div>
                      {r.live
                        ? <Pair b={b!} m={r.live} score />
                        : <div className="py-1 text-center text-xs text-fg-subtle">Free</div>}
                    </div>
                    {r.next && (
                      <div className="px-2 pt-1 text-fg-muted">
                        <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Next on {r.label}</div>
                        <Pair b={b!} m={r.next} />
                      </div>
                    )}
                  </div>
                ))}
                {spare.length > 0 && (
                  <div className="px-2 text-fg-muted">
                    <div className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Next · court to be decided</div>
                    {spare.map(m => <Pair key={m.id} b={b!} m={m} />)}
                  </div>
                )}
              </div>}
            </>
          )
          // flex column, top-aligned: a <button> centres its content vertically by default
          const cls = 'flex w-full flex-col justify-start rounded-xl border border-line bg-surface p-3 text-left'
          return <div key={cat.code} className={cls}>{body}</div>
        })}
      </div>
    </section>
  )
}

/** Total Champion podium: shown once every category has its medals. 2nd - 1st - 3rd. */
export function TotalPodium({ table }: { table: MedalRow[] }) {
  const [a, b, c] = table
  if (!a) return null
  const col = (r: MedalRow | undefined, rank: 1 | 2 | 3) => r && (
    <div className="flex min-w-0 flex-1 flex-col items-center">
      <Emblem logo={r.logo} flagName={r.name} className={`${rank === 1 ? 'h-16 w-16' : 'h-12 w-12'} rounded-full`} />
      <div className="mt-1 max-w-full truncate text-center text-sm font-bold">{r.name}</div>
      <div className="text-[11px] text-fg-subtle">{r.gold}🥇 {r.silver}🥈 {r.bronze}🥉</div>
      <div className={`mt-1 grid w-full place-items-center rounded-t-lg font-display text-2xl font-black ${rank === 1 ? 'h-20 bg-gold/30 text-gold' : rank === 2 ? 'h-14 bg-fg-muted/20 text-fg-muted' : 'h-10 bg-amber-700/25 text-amber-600'}`}>{rank}</div>
    </div>
  )
  return (
    <div className="mb-3 rounded-xl border border-gold/40 bg-gold/5 p-3">
      <div className="mb-2 text-center text-[11px] font-bold uppercase tracking-[0.25em] text-gold">🏆 Total Champion</div>
      <div className="flex items-end gap-2">{col(b, 2)}{col(a, 1)}{col(c, 3)}</div>
    </div>
  )
}

/** Total Champion: most gold, then silver, then bronze, across every category. */
export function MedalTable({ hub, bundleOf }: { hub: Hub; bundleOf: (code: string) => Bundle | null }) {
  const bundles = hub.cats.map(c => bundleOf(c.code)).filter((b): b is Bundle => !!b)
  const results = bundles.map(categoryResult)
  const table = medalTable(results, bundles)
  const four = needsFourth(table)
  const cols = four ? 'grid-cols-[2rem_1fr_2.5rem_2.5rem_2.5rem_2.5rem]' : 'grid-cols-[2rem_1fr_2.75rem_2.75rem_2.75rem]'
  const allDone = results.length === hub.cats.length && results.every(r => r.done)
  return (
      <section>
        {allDone && <TotalPodium table={table} />}
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-fg-subtle">Total Champion</h2>
          <span className="text-[11px] text-fg-subtle">most 🥇, then 🥈, then 🥉{four ? ', then 4th places' : ''} · {results.filter(r => r.done).length}/{hub.cats.length} decided</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className={`grid ${cols} items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle`}>
            <div>#</div><div>Church</div><div className="text-center">🥇</div><div className="text-center">🥈</div><div className="text-center">🥉</div>{four && <div className="text-center">4th</div>}
          </div>
          {table.length === 0 && <div className="p-5 text-center text-sm text-fg-muted">Medals appear as each category finishes.</div>}
          {table.map((r, i) => (
            <div key={r.key} className={`grid ${cols} items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0 ${i === 0 ? 'bg-gold/10' : ''}`}>
              <div className="font-display text-lg font-black text-fg-muted">{i + 1}</div>
              <div className="flex min-w-0 items-center gap-2">
                <Emblem logo={r.logo} flagName={r.name} className="h-6 w-6 shrink-0 rounded-[3px]" />
                <span className="truncate font-bold">{r.name}</span>
              </div>
              <div className="text-center font-display text-xl font-black">{r.gold}</div>
              <div className="text-center font-display text-xl font-bold text-fg-muted">{r.silver}</div>
              <div className="text-center font-display text-xl font-bold text-fg-muted">{r.bronze}</div>
              {four && <div className="text-center font-display text-lg font-bold text-fg-subtle">{r.fourth}</div>}
            </div>
          ))}
        </div>
      </section>
  )
}
