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
  const court = (b: Bundle, id: string | null) => {
    const c = b.courts.find(x => x.id === id)
    if (!c) return ''
    return `Ct ${/(\d+)\s*$/.exec(c.label ?? '')?.[1] ?? c.number}`
  }
  const blocks = hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })).map(({ cat, b }) => {
    if (!b) return { cat, b, live: [], next: [] }
    const live = b.matches.filter(m => (m.status === 'live' || m.status === 'awaiting_confirm') && m.team_a_id && m.team_b_id && ours(b, m))
      .sort((x, y) => x.sequence - y.sequence)
    const next = b.matches.filter(m => (m.status === 'scheduled' || m.status === 'on_deck') && m.team_a_id && m.team_b_id && ours(b, m))
      .sort((x, y) => x.sequence - y.sequence).slice(0, mine ? 6 : 3)
    return { cat, b, live, next }
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
        {blocks.map(({ cat, b, live, next }) => {
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
              {(live.length > 0 || next.length > 0) && <div className="mt-2 border-t border-line/60 pt-1.5">
                {live.map(m => (
                  <div key={m.id} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] items-center gap-1.5 py-1 text-sm">
                    <span className="truncate text-[11px] font-bold uppercase text-red-400">● {court(b!, m.court_id)}</span>
                    <span className="truncate text-right font-semibold">{name(b!, m.team_a_id)}</span>
                    <span className="tabular text-center font-display font-bold">{m.score_a}–{m.score_b}</span>
                    <span className="truncate font-semibold">{name(b!, m.team_b_id)}</span>
                  </div>
                ))}
                {next.map((m, i) => (
                  <div key={m.id} className="grid grid-cols-[3rem_minmax(0,1fr)_3rem_minmax(0,1fr)] items-center gap-1.5 py-1 text-sm text-fg-muted">
                    <span className="truncate text-[11px] font-bold uppercase text-fg-subtle">{i === 0 ? 'Next' : `+${i}`}</span>
                    <span className="truncate text-right">{name(b!, m.team_a_id)}</span>
                    <span className="text-center text-xs text-fg-subtle">vs</span>
                    <span className="truncate">{name(b!, m.team_b_id)}</span>
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
