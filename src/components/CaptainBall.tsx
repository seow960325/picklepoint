/** Captain ball (multi-sport, migration 0031): the basketball-style
 *  scoreboard, the round-robin table, the games list and the admin rules
 *  panel. Only rendered for events whose sport is 'captainball'. */
import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { teamName, teamLogo, liveOnCourt } from '../lib/store'
import { Emblem, Pill } from './ui'
import { Field, Stepper, Warn } from './form'
import * as api from '../lib/api'
import { hornEnd } from '../lib/feedback'
import {
  cbStateOf, cbView, cbScore, cbRulesOf, cbStandings, cbRound, fmtClock, toLeft, toAllowed,
  type CbRules, type CbState, type Side,
} from '../lib/captainball'

/** Re-render every `ms` while `on` (the clocks tick locally). */
export function useNow(on: boolean, ms = 200): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) { setNow(Date.now()); return }
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return on ? now : Date.now()
}

const ticking = (st: CbState, now: number) => {
  const v = cbView(st, now)
  return v.running || v.toMs > 0 || v.brkMs > 0
}

/** Each team keeps one colour all game, also after the teams swap ends. */
export const CB_TEAM_COLOR: Record<Side, string> = { a: '#fbbf24', b: '#a5b4fc' }

const evOf = (b: Bundle, m: Match) => b.events.find(e => e.id === m.event_id)

/** Plays the horn once when the half ends or a time-out runs out (TV / board). */
export function useHorn(st: CbState, now: number, on: boolean) {
  const prev = useRef<{ running: boolean; to: number; brk: number } | null>(null)
  const v = cbView(st, now)
  useEffect(() => {
    const p = prev.current
    prev.current = { running: v.running, to: v.toMs, brk: v.brkMs }
    if (!on || !p) return
    if ((p.running && v.expired) || (p.to > 0 && v.toMs === 0 && st.to) || (p.brk > 0 && v.brkMs === 0)) hornEnd()
  })
}

const SIZES = {
  card: { name: 'text-sm', score: 'text-6xl', clock: 'text-5xl', small: 'text-[10px]', pad: 'p-3', dot: 'h-2 w-2', logo: 'h-5 w-5', status: 'text-xs' },
  split: { name: 'text-xl', score: 'text-8xl', clock: 'text-7xl', small: 'text-sm', pad: 'p-4', dot: 'h-3 w-3', logo: 'h-8 w-8', status: 'text-lg' },
  tv: { name: 'text-3xl', score: 'text-[9rem] leading-none', clock: 'text-[8rem] leading-none', small: 'text-lg', pad: 'p-6', dot: 'h-4 w-4', logo: 'h-12 w-12', status: 'text-2xl' },
} as const

/** The live scoreboard of one captain-ball game (always dark, like a hall scoreboard). */
export function CbScoreboard({ b, m, size = 'card', sound = false, courtLabel }: {
  b: Bundle; m: Match; size?: keyof typeof SIZES; sound?: boolean; courtLabel?: string
}) {
  const st = cbStateOf(m, evOf(b, m))
  const now = useNow(ticking(st, Date.now()))
  useHorn(st, now, sound)
  const v = cbView(st, now)
  const sc = cbScore(st)
  const z = SIZES[size]
  const left: Side = m.a_on_left ? 'a' : 'b'
  const right: Side = left === 'a' ? 'b' : 'a'
  const id = (s: Side) => (s === 'a' ? m.team_a_id : m.team_b_id)
  const low = v.clock < 60000 && st.phase === 'play'

  const side = (s: Side, alignRight: boolean) => {
    const allowed = toAllowed(st, s), left_ = toLeft(st, s)
    return (
      <div className={`flex min-w-0 flex-col ${alignRight ? 'items-end text-right' : 'items-start text-left'}`}>
        <div className={`flex w-full min-w-0 items-center gap-2 ${alignRight ? 'flex-row-reverse' : ''}`}>
          <span className="shrink-0 rounded-[3px]" style={{ background: CB_TEAM_COLOR[s], width: '0.6em', height: '1.6em' }} />
          <Emblem logo={teamLogo(b, id(s))} className={`${z.logo} shrink-0 rounded-[3px]`} />
          <span className={`min-w-0 font-display font-bold uppercase leading-tight tracking-wide text-white line-clamp-2 break-words ${z.name}`}>
            {teamName(b, id(s))}
          </span>
        </div>
        <div className={`tabular font-display font-bold ${z.score}`}
          style={{ color: CB_TEAM_COLOR[s], textShadow: `0 0 18px ${CB_TEAM_COLOR[s]}55` }}>
          {sc[s]}
        </div>
        <div className={`flex items-center gap-3 ${z.small} font-semibold uppercase tracking-widest text-white/60 ${alignRight ? 'flex-row-reverse' : ''}`}>
          <span>Foul <span className="tabular font-display text-[1.35em] font-bold text-[#facc15]">{st.f[s]}</span></span>
          <span className={`flex items-center gap-1 ${alignRight ? 'flex-row-reverse' : ''}`} title="Time-outs left">
            <span>TO</span>
            {Array.from({ length: Math.max(allowed, 0) }, (_, i) => (
              <span key={i} className={`${z.dot} rounded-full ${i < left_ ? 'bg-[#f87171]' : 'bg-white/15'}`} />
            ))}
          </span>
        </div>
      </div>
    )
  }

  const banner = v.toMs > 0
    ? { txt: `Time-out · ${teamName(b, id(v.toSide!))}`, t: fmtClock(v.toMs, false), c: '#f59e0b' }
    : v.brkMs > 0 || st.phase === 'break'
    ? { txt: 'Half-time · teams swap ends', t: fmtClock(v.brkMs, false), c: '#38bdf8' }
    : null

  return (
    <div className={`overflow-hidden rounded-2xl bg-[#07090d] ${z.pad} text-white ring-1 ring-white/10`}>
      <div className={`mb-1 flex items-center justify-between gap-2 ${z.small} font-semibold uppercase tracking-[0.18em] text-white/50`}>
        <span className="truncate">{[courtLabel, cbRound(m), `Game ${m.sequence}`].filter(Boolean).join(' · ')}</span>
        <span className={`shrink-0 rounded-full px-2 py-0.5 font-bold ${
          v.running ? 'bg-[#22c55e]/20 text-[#4ade80]' : st.phase === 'over' || v.expired ? 'bg-white/10 text-white' : 'bg-white/10 text-white/70'}`}>
          {v.running ? '● Live' : v.status}
        </span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
        {side(left, false)}
        <div className="flex flex-col items-center px-1">
          <div className={`tabular font-display font-bold ${z.clock}`}
            style={{ color: '#ff3b30', textShadow: '0 0 14px #ff3b3088, 0 0 34px #ff3b3044', opacity: v.running || low || st.phase !== 'play' ? 1 : 0.85 }}>
            {fmtClock(v.clock)}
          </div>
          <div className={`mt-1 font-display font-bold uppercase tracking-[0.2em] text-white/80 ${z.status}`}>{v.periodLabel}</div>
        </div>
        {side(right, true)}
      </div>
      {banner && (
        <div className="mt-2 flex items-center justify-center gap-3 rounded-xl px-3 py-1.5 font-display font-bold uppercase tracking-wider"
          style={{ background: `${banner.c}22`, color: banner.c, boxShadow: `inset 0 0 0 1px ${banner.c}66` }}>
          <span className={`truncate ${z.status}`}>{banner.txt}</span>
          <span className={`tabular ${z.status} text-white`}>{banner.t}</span>
        </div>
      )}
    </div>
  )
}

/** Live view of the captain-ball court(s): scoreboard, then the next games. */
export function CbLive({ b, code, tv = false, split = false, sound = false, n = 4 }: {
  b: Bundle; code: string; tv?: boolean; split?: boolean; sound?: boolean; n?: number
}) {
  const live = b.courts.map(ct => ({ ct, m: liveOnCourt(b, ct.id) }))
  const size = tv ? (split ? 'split' : 'tv') : 'card'
  return (
    <div className={tv ? 'space-y-4' : 'space-y-4 p-3 lg:p-5'}>
      <div className={`grid gap-3 ${live.length > 1 && !tv ? 'lg:grid-cols-2' : ''}`}>
        {live.map(({ ct, m }) => m ? (
          tv ? <CbScoreboard key={ct.id} b={b} m={m} size={size} sound={sound} courtLabel={ct.label ?? undefined} />
            : (
              <Link key={ct.id} to={`/c/${code}/court/${ct.number}`} className="block active:scale-[0.995]">
                <CbScoreboard b={b} m={m} size={size} courtLabel={ct.label ?? undefined} />
              </Link>
            )
        ) : (
          <div key={ct.id} className="rounded-2xl border border-line bg-surface p-6 text-center text-sm text-fg-subtle">
            {ct.label ?? `Court ${ct.number}`} · no game running
          </div>
        ))}
      </div>
      <CbUpNext b={b} n={n} big={tv} />
    </div>
  )
}

function CbUpNext({ b, n, big }: { b: Bundle; n: number; big?: boolean }) {
  const ups = b.matches.filter(m => m.status === 'scheduled' || m.status === 'on_deck')
    .sort((x, y) => x.sequence - y.sequence).slice(0, n)
  if (!ups.length) return null
  const fl = big ? 'h-7 w-7 shrink-0 rounded-[3px]' : 'h-4 w-4 shrink-0 rounded-[2px]'
  return (
    <div>
      <div className={`mb-2 px-1 font-display font-bold uppercase tracking-widest text-accent ${big ? 'text-xl' : 'text-sm'}`}>Up next</div>
      <div className="divide-y divide-line/60 rounded-2xl border border-line bg-surface">
        {ups.map(m => (
          <div key={m.id} className={`grid grid-cols-[3.5rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-center gap-1.5 px-3 ${big ? 'py-3 text-2xl' : 'py-2 text-sm'}`}>
            <span className={`font-display font-bold text-fg-subtle ${big ? 'text-lg' : 'text-xs'}`}>G{m.sequence}</span>
            <span className="flex min-w-0 items-center justify-end gap-1.5">
              <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
              <Emblem logo={teamLogo(b, m.team_a_id)} className={fl} />
            </span>
            <span className="text-center text-xs text-fg-subtle">vs</span>
            <span className="flex min-w-0 items-center gap-1.5">
              <Emblem logo={teamLogo(b, m.team_b_id)} className={fl} />
              <span className="truncate">{teamName(b, m.team_b_id)}</span>
            </span>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Round-robin table for one captain-ball event. */
export function CbStandings({ b, ev, big = false, heading = false }: {
  b: Bundle; ev: EventCfg; big?: boolean; heading?: boolean
}) {
  const rows = cbStandings(b, ev.id)
  const r = cbRulesOf(ev)
  const cell = big ? 'py-3 text-lg' : 'py-2'
  const tone = 'text-[#c2410c] dark:text-[#fdba74]'
  return (
    <section className="min-w-0">
      {heading && (
        <h2 className={`mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase tracking-widest ${tone}`}>
          <span>🏀</span><span>{ev.name || 'Captain Ball'}</span>
        </h2>
      )}
      <div className="overflow-hidden rounded-xl border border-line">
        <div className="flex items-center justify-between gap-2 bg-[#fb923c]/[0.08] px-3 py-1.5 text-xs font-bold uppercase tracking-widest">
          <span className={tone}>Round robin</span>
          <span className="truncate text-[10px] font-semibold normal-case tracking-normal text-fg-subtle">
            win {r.win} · draw {r.draw} · loss {r.loss}
          </span>
        </div>
        <table className={`w-full table-fixed ${big ? 'text-lg' : 'text-sm'}`}>
          <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
            <tr>
              <th className="w-7 px-2 py-1.5 text-center">#</th>
              <th className="px-1 py-1.5 text-left">Team</th>
              <th className="w-7 px-1 py-1.5 text-right">P</th>
              <th className="w-7 px-1 py-1.5 text-right">W</th>
              <th className="w-7 px-1 py-1.5 text-right">D</th>
              <th className="w-7 px-1 py-1.5 text-right">L</th>
              <th className="w-10 px-1 py-1.5 text-right">+/−</th>
              <th className="w-10 px-2 py-1.5 text-right">Pts</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-line">
            {rows.map((x, i) => (
              <tr key={x.team.id}>
                <td className={`tabular px-2 ${cell} text-center text-xs font-bold ${i < 1 && x.p ? tone : 'text-fg-subtle'}`}>{i + 1}</td>
                <td className={`px-1 ${cell}`}>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Emblem logo={teamLogo(b, x.team.id)} className="h-4 w-4 shrink-0 rounded-[2px]" />
                    <span className={`min-w-0 ${big ? 'line-clamp-2 break-words leading-tight' : 'truncate'}`}>{x.team.name}</span>
                  </span>
                </td>
                <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{x.p}</td>
                <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{x.w}</td>
                <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{x.d}</td>
                <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{x.l}</td>
                <td className={`tabular px-1 ${cell} text-right text-fg-muted`}>{x.diff > 0 ? `+${x.diff}` : x.diff}</td>
                <td className={`tabular px-2 ${cell} text-right font-bold ${tone}`}>{x.pts}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  )
}

/** Matches tab: every captain-ball game, upcoming first, then results. */
export function CbMatches({ b, banner }: { b: Bundle; banner?: React.ReactNode }) {
  const games = [...b.matches].sort((x, y) => x.sequence - y.sequence)
  const up = games.filter(m => m.status !== 'finished')
  const done = games.filter(m => m.status === 'finished').reverse()
  const card = (m: Match) => {
    const live = m.status === 'live' && !!m.started_at
    const fin = m.status === 'finished'
    const aW = fin && m.score_a > m.score_b, bW = fin && m.score_b > m.score_a
    const name = (id: string | null, win: boolean, right: boolean) => (
      <span className={`flex min-w-0 items-center gap-1.5 ${right ? 'justify-end' : ''} ${win ? 'font-bold text-fg' : fin ? 'text-fg-muted' : 'text-fg'}`}>
        {right && <span className="truncate text-right">{teamName(b, id)}</span>}
        <Emblem logo={teamLogo(b, id)} className="h-4 w-4 shrink-0 rounded-[2px]" />
        {!right && <span className="truncate">{teamName(b, id)}</span>}
      </span>
    )
    return (
      <div key={m.id} className={`overflow-hidden rounded-xl border bg-surface ${live ? 'border-[#f97316] dark:border-[#fb923c]' : 'border-line'}`}>
        <div className="flex items-center justify-between gap-2 px-3 pt-2 text-[10px] font-bold uppercase tracking-widest text-fg-subtle">
          <span className="truncate">Game {m.sequence} · {cbRound(m)}</span>
          {live ? <Pill tone="live">● live</Pill> : fin ? <Pill tone="done">{m.winner_id ? 'final' : 'draw'}</Pill> : null}
        </div>
        <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm">
          {name(m.team_a_id, aW, true)}
          <span className={`tabular font-display text-lg font-bold ${live || fin ? 'text-[#c2410c] dark:text-[#fdba74]' : 'text-fg-subtle'}`}>
            {live || fin ? `${m.score_a}–${m.score_b}` : 'vs'}
          </span>
          {name(m.team_b_id, bW, false)}
        </div>
      </div>
    )
  }
  const head = (t: string) => <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">{t}</div>
  return (
    <section className="min-w-0">
      {banner}
      {games.length === 0 ? <div className="rounded-xl border border-line p-4 text-sm text-fg-subtle">Schedule not drawn yet.</div> : (
        <div className="space-y-5">
          <div>{head('Up next')}{up.length ? <div className="grid gap-2 sm:grid-cols-2">{up.map(card)}</div>
            : <div className="rounded-xl border border-line p-4 text-sm text-fg-subtle">Every game has been played.</div>}</div>
          {done.length > 0 && <div>{head('Results')}<div className="grid gap-2 sm:grid-cols-2">{done.map(card)}</div></div>}
        </div>
      )}
    </section>
  )
}

// ------------------------------------------------------------------ admin
/** Settings → Scoring for a captain-ball event. A game that has already
 *  started keeps the rules it started with; new games use these. */
export function CbRulesPanel({ ev, token, run }: { ev: EventCfg; token: string; run: (fn: () => Promise<any>, ok: string) => void }) {
  const [r, setR] = useState<CbRules>(cbRulesOf(ev))
  const set = (k: keyof CbRules) => (v: number) => setR(x => ({ ...x, [k]: v }))
  const H = 'font-display text-lg font-bold tracking-wide'
  return (
    <div className="max-w-2xl space-y-5">
      <h1 className="font-display text-2xl font-bold tracking-wide">Captain Ball rules</h1>
      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className={H}>Clock</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          <Field label="Half length (min)"><Stepper value={r.half_min} min={1} max={30} onChange={set('half_min')} /></Field>
          <Field label="Halves"><Stepper value={r.halves} min={1} max={4} onChange={set('halves')} /></Field>
          <Field label="Half-time rest (min)"><Stepper value={r.rest_min} min={0} max={15} onChange={set('rest_min')} /></Field>
          <Field label="Extra time if level (min)"><Stepper value={r.extra_min} min={1} max={10} onChange={set('extra_min')} /></Field>
        </div>
      </div>
      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className={H}>Time-outs (per team)</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          <Field label="Length (sec)"><Stepper value={r.to_sec} min={10} max={180} onChange={v => set('to_sec')(Math.round(v / 5) * 5 || 10)} /></Field>
          <Field label="1st half"><Stepper value={r.to_h1} min={0} max={9} onChange={set('to_h1')} /></Field>
          <Field label="2nd half / extra"><Stepper value={r.to_h2} min={0} max={9} onChange={set('to_h2')} /></Field>
        </div>
        <p className="text-xs text-fg-subtle">The court scorer can also give one team an extra time-out during a game.</p>
      </div>
      <div className="space-y-4 rounded-xl border border-line bg-surface p-4">
        <div className={H}>Table points</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          <Field label="Win"><Stepper value={r.win} min={0} max={9} onChange={set('win')} /></Field>
          <Field label="Draw"><Stepper value={r.draw} min={0} max={9} onChange={set('draw')} /></Field>
          <Field label="Loss"><Stepper value={r.loss} min={0} max={9} onChange={set('loss')} /></Field>
        </div>
      </div>
      {r.win <= r.draw && <Warn>A win should be worth more than a draw.</Warn>}
      <p className="text-xs text-fg-subtle">Scoring buttons on court: +1 (boy) and +2 (girl). A game already running keeps its old rules.</p>
      <button onClick={() => run(() => api.adminSetCbRules(token, ev.id, r), 'Captain Ball rules saved')}
        className="rounded-xl bg-brand px-6 py-2.5 font-display font-bold text-brand-fg">
        SAVE RULES
      </button>
    </div>
  )
}
