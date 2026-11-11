/** Hub front page: Total Champion medal table + one card per category with
 *  where it stands right now. Category codes are read once and every 30 s
 *  (no live channel each, so 200 phones don't open 5 connections apiece). */
import { SportIcon } from './SportIcon'
import { useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle } from '../lib/types'
import * as api from '../lib/api'
import { Emblem } from './ui'
import type { Hub } from '../lib/hub'
import { categoryResult, medalTable } from '../lib/medals'
import { finalSeries } from '../lib/finals'
import { cbKo } from '../lib/captainball'
import { churchOf } from '../lib/draw'

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
  const pick = (c: string) => { setMine(c); try { localStorage.setItem(MINE + hub.code, c) } catch { /* private mode */ } }
  const cats = hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })).filter((x): x is { cat: typeof x.cat; b: Bundle } => !!x.b)
  const churches = [...new Set(cats.flatMap(x => x.b.teams.map(t => churchOf(t.name))))].sort()
  const name = (b: Bundle, id: string | null) => b.teams.find(t => t.id === id)?.name ?? '—'
  const ours = (b: Bundle, m: Bundle['matches'][number]) => !mine || hub.noChurch
    || [m.team_a_id, m.team_b_id].some(id => churchOf(name(b, id)).toLowerCase() === mine.toLowerCase())
  type M = Bundle['matches'][number]
  const courtNo = (c: Bundle['courts'][number]) => Number(/(\d+)\s*$/.exec(c.label ?? '')?.[1] ?? c.number)
  const blocks = hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })).map(({ cat, b }) => {
    if (!b) return { cat, b, rows: [] as { id: string; label: string; live?: M; next?: M }[], spare: [] as M[] }
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
    return { cat, b, rows, spare }
  })

  return (
    <section>
      <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
        <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-fg-subtle">Categories · on court & up next</h2>
        {!hub.noChurch && <select value={mine} onChange={e => pick(e.target.value)}
          className="rounded-lg border border-line bg-surface px-2 py-1.5 text-sm text-fg">
          <option value="">All churches</option>
          {churches.map(c => <option key={c} value={c}>{c}</option>)}
        </select>}
      </div>
      <div className="grid items-start gap-3 lg:grid-cols-2">
        {blocks.map(({ cat, b, rows, spare }) => {
          const st = b ? statusOf(b) : null
          const head = (
            <div className="flex items-center gap-2">
              <span className="text-xl leading-none"><SportIcon sport={cat.sport} /></span>
              <span className="min-w-0 flex-1 font-display text-base font-bold uppercase leading-tight tracking-wide">{cat.label}</span>
              {st && st.live > 0 && <span className="shrink-0 animate-pulse rounded bg-red-500 px-1.5 py-0.5 text-[10px] font-bold text-white">{st.live} LIVE</span>}
              <span className="shrink-0 text-fg-subtle">›</span>
            </div>
          )
          const body = (
            <>
              {head}
              <div className="mt-0.5 text-xs text-fg-muted">
                {!b ? 'Loading…' : st!.champ ? <>🏆 Champion: <span className="font-bold text-fg">{st!.champ}</span></> : st!.text}
              </div>
              {(rows.length > 0 || spare.length > 0) && <div className="mt-2 space-y-1.5 border-t border-line/60 pt-2">
                {rows.map(r => (
                  <div key={r.id} className="rounded-lg bg-surface-2/50 px-2 py-1.5">
                    <div className="flex items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider">
                      <span className={r.live ? 'text-emerald-400' : 'text-fg-subtle'}>{r.live ? '● ' : ''}{r.label}</span>
                      {r.live && <span className="text-emerald-400/80">live</span>}
                    </div>
                    {r.live && (
                      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 py-0.5 text-sm">
                        <span className="line-clamp-2 break-words text-right font-semibold leading-tight">{name(b!, r.live.team_a_id)}</span>
                        <span className="tabular text-center font-display font-bold">{r.live.score_a}–{r.live.score_b}</span>
                        <span className="line-clamp-2 break-words font-semibold leading-tight">{name(b!, r.live.team_b_id)}</span>
                      </div>
                    )}
                    {r.next && (
                      <div className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 py-0.5 text-[13px] text-fg-muted">
                        <span className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Next</span>
                        <span className="line-clamp-2 break-words text-right leading-tight">{name(b!, r.next.team_a_id)}</span>
                        <span className="text-xs text-fg-subtle">vs</span>
                        <span className="line-clamp-2 break-words leading-tight">{name(b!, r.next.team_b_id)}</span>
                      </div>
                    )}
                  </div>
                ))}
                {spare.map(m => (
                  <div key={m.id} className="grid grid-cols-[2.5rem_minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-1.5 px-2 py-0.5 text-[13px] text-fg-muted">
                    <span className="text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Next</span>
                    <span className="line-clamp-2 break-words text-right leading-tight">{name(b!, m.team_a_id)}</span>
                    <span className="text-xs text-fg-subtle">vs</span>
                    <span className="line-clamp-2 break-words leading-tight">{name(b!, m.team_b_id)}</span>
                  </div>
                ))}
              </div>}
            </>
          )
          // flex column, top-aligned: a <button> centres its content vertically by default
          const cls = 'flex w-full flex-col justify-start rounded-xl border border-line bg-surface p-3 text-left active:bg-surface-2'
          return <button key={cat.code} onClick={() => onOpen(cat.code)} className={cls}>{body}</button>
        })}
      </div>
    </section>
  )
}

/** Total Champion: most gold, then silver, then bronze, across every category. */
export function MedalTable({ hub, bundleOf }: { hub: Hub; bundleOf: (code: string) => Bundle | null }) {
  const results = hub.cats.map(c => bundleOf(c.code)).filter((b): b is Bundle => !!b).map(categoryResult)
  const table = medalTable(results)
  return (
      <section>
        <div className="mb-2 flex items-baseline justify-between gap-2">
          <h2 className="text-[11px] font-bold uppercase tracking-[0.25em] text-fg-subtle">Total Champion</h2>
          <span className="text-[11px] text-fg-subtle">most 🥇, then 🥈, then 🥉 · {results.filter(r => r.done).length}/{hub.cats.length} decided</span>
        </div>
        <div className="overflow-hidden rounded-xl border border-line bg-surface">
          <div className="grid grid-cols-[2rem_1fr_2.75rem_2.75rem_2.75rem] items-center gap-2 border-b border-line px-3 py-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            <div>#</div><div>Church</div><div className="text-center">🥇</div><div className="text-center">🥈</div><div className="text-center">🥉</div>
          </div>
          {table.length === 0 && <div className="p-5 text-center text-sm text-fg-muted">Medals appear as each category finishes.</div>}
          {table.map((r, i) => (
            <div key={r.key} className={`grid grid-cols-[2rem_1fr_2.75rem_2.75rem_2.75rem] items-center gap-2 border-b border-line/60 px-3 py-2 last:border-0 ${i === 0 ? 'bg-gold/10' : ''}`}>
              <div className="font-display text-lg font-black text-fg-muted">{i + 1}</div>
              <div className="flex min-w-0 items-center gap-2">
                <Emblem logo={r.logo} flagName={r.name} className="h-6 w-6 shrink-0 rounded-[3px]" />
                <span className="truncate font-bold">{r.name}</span>
              </div>
              <div className="text-center font-display text-xl font-black">{r.gold}</div>
              <div className="text-center font-display text-xl font-bold text-fg-muted">{r.silver}</div>
              <div className="text-center font-display text-xl font-bold text-fg-muted">{r.bronze}</div>
            </div>
          ))}
        </div>
      </section>
  )
}
