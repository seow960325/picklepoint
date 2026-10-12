/** Captain ball (multi-sport, migration 0031): the basketball-style
 *  scoreboard, the round-robin table, the games list and the admin rules
 *  panel. Only rendered for events whose sport is 'captainball'. */
import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { teamName, teamLogo, liveOnCourt } from '../lib/store'
import { Emblem, Pill } from './ui'
import { Field, Stepper, Warn } from './form'
import * as api from '../lib/api'
import { hornEnd } from '../lib/feedback'
import { SevenSeg, segClock, segScore } from './SevenSeg'
import {
  cbStateOf, cbView, cbScore, cbRulesOf, cbStandings, cbRound, fmtClock, toLeft, toAllowed, ordinal,
  type CbRules, type CbState, type Side,
} from '../lib/captainball'

/** Re-render every `ms` while `on` (the clocks tick locally). */
export function useNow(on: boolean, ms = 200): number {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!on) { setNow(Date.now()); return }
    if (ms <= 50) {   // tenths of a second: follow the screen refresh, so every tenth shows evenly
      let raf = 0
      const loop = () => { setNow(Date.now()); raf = requestAnimationFrame(loop) }
      raf = requestAnimationFrame(loop)
      return () => cancelAnimationFrame(raf)
    }
    const id = setInterval(() => setNow(Date.now()), ms)
    return () => clearInterval(id)
  }, [on, ms])
  return on ? now : Date.now()
}

/** Tick rate: smooth (every frame) only while the tenths show, i.e. the clock runs under a minute. */
export const tickMs = (st: CbState, now: number) => {
  const v = cbView(st, now)
  return v.running && v.clock < 61000 ? 16 : 100
}

const ticking = (st: CbState, now: number) => {
  const v = cbView(st, now)
  return v.running || v.toMs > 0 || v.brkMs > 0
}

/** Each team keeps one LED colour all game, also after the teams swap ends. */
export const CB_TEAM_COLOR: Record<Side, string> = { a: '#ffb020', b: '#3fd0ff' }
export const CB_CLOCK_COLOR = '#ff3b30'
export const CB_FOUL_COLOR = '#ffd60a'
export const CB_CALL_COLOR = '#ff9f0a'

const evOf = (b: Bundle, m: Match) => b.events.find(e => e.id === m.event_id)

/** Plays the horn once when the half ends or a team call runs out (TV / board). */
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

/** Points scored per half, e.g. [{label:'1ST HALF', a:12, b:9}, ...]. */
export function cbHalfScores(st: CbState): Array<{ label: string; a: number; b: number }> {
  const out: Array<{ label: string; a: number; b: number }> = []
  const upto = st.et ? st.r.halves + 1 : st.half
  for (let h = 1; h <= upto; h++) {
    let a = 0, b = 0
    for (const e of st.log) if (e.h === h) { if (e.s === 'a') a += e.n; else b += e.n }
    out.push({ label: h > st.r.halves ? 'EXTRA' : `${ordinal(h)} HALF`, a, b })
  }
  return out
}

/** Board text size follows the width it is given (capped by screen height on a TV),
 *  so the whole scoreboard keeps one shape on a phone, half a TV or a full TV. */
function useBoardFont(cap: string | null) {
  const ref = useRef<HTMLDivElement>(null)
  const [w, setW] = useState(0)
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const f = () => setW(el.clientWidth)
    f()
    const ro = new ResizeObserver(f)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])
  const px = w ? w / 54 : 8
  return { ref, px, fontSize: cap ? `min(${px}px, ${cap})` : `${px}px` }
}

const CAP = { card: null, split: '2.1vh', tv: '3vh' } as const

/** The live scoreboard of one captain-ball game: an official-style LED board
 *  (team names, scores, game clock, period, fouls, team calls). Every number
 *  sits in a fixed-width cell, so nothing moves when digits change. */
export function CbScoreboard({ b, m, size = 'card', sound = false, courtLabel }: {
  b: Bundle; m: Match; size?: keyof typeof CAP; sound?: boolean; courtLabel?: string
}) {
  const st = cbStateOf(m, evOf(b, m))
  const now = useNow(ticking(st, Date.now()), tickMs(st, Date.now()))
  useHorn(st, now, sound)
  const v = cbView(st, now)
  const sc = cbScore(st)
  const { ref, px, fontSize } = useBoardFont(CAP[size])
  const narrow = px < 12   // phone-size board: shorter labels
  const left: Side = m.a_on_left ? 'a' : 'b'
  const right: Side = left === 'a' ? 'b' : 'a'
  const id = (s: Side) => (s === 'a' ? m.team_a_id : m.team_b_id)
  const box = 'rounded-[0.5em] border-[0.1em] border-[#23272e] bg-[#0b0c0f]'
  const lbl = 'font-display font-bold uppercase tracking-[0.18em] text-[#8b93a1]'
  const lblSize = narrow ? { fontSize: 'max(0.85em, 7px)', letterSpacing: '0.06em' } : { fontSize: '0.85em' }

  const bh = narrow ? '5.2em' : '4.8em'
  const tileH = '9.2em'
  // every column shares the same grid rows, so names, tiles and bottom boxes line up exactly
  const nameCell = (s: Side) => (
    <div className="flex min-w-0 items-center justify-center text-center">
      <span className="line-clamp-2 break-words font-display font-bold uppercase text-white"
        style={{ fontSize: '1.6em', lineHeight: 1.1, letterSpacing: '0.04em' }}>{teamName(b, id(s))}</span>
    </div>
  )
  const barCell = (col: string, w = '70%', glow = true) => (
    <div className="mx-auto self-center rounded-full" style={{ height: '0.28em', width: w, background: col, boxShadow: glow ? `0 0 0.6em ${col}88` : undefined }} />
  )
  const scoreCell = (s: Side) => (
    <div className={`${box} flex items-center justify-center`} style={{ height: tileH }}>
      <SevenSeg text={segScore(sc[s], sc.a >= 100 || sc.b >= 100 ? 3 : 2)} color={CB_TEAM_COLOR[s]} size="7.5em" label={`${teamName(b, id(s))} ${sc[s]}`} />
    </div>
  )
  const lowCell = (s: Side) => {
    const allowed = Math.max(0, toAllowed(st, s)), have = toLeft(st, s)
    return (
      <div className="grid grid-cols-2 gap-[0.6em]">
        <div className={`${box} flex flex-col items-center justify-between`} style={{ height: bh, padding: '0.4em' }}>
          <span className={lbl} style={lblSize}>Fouls</span>
          <span className="flex flex-1 items-center justify-center"><SevenSeg text={segScore(st.f[s])} color={CB_FOUL_COLOR} size="2.4em" glow={false} /></span>
        </div>
        <div className={`${box} flex flex-col items-center justify-between`} style={{ height: bh, padding: '0.4em' }}>
          <span className={lbl} style={lblSize}>Calls</span>
          <span className="flex flex-1 flex-wrap items-center justify-center" style={{ gap: '0.35em' }}>
            {allowed === 0
              ? <span className={lbl} style={lblSize}>—</span>
              : Array.from({ length: allowed }, (_, i) => (
                <span key={i} className="rounded-full" style={{
                  width: '1em', height: '1em',
                  background: i < have ? CB_CALL_COLOR : '#2a2e35',
                  boxShadow: i < have ? `0 0 0.5em ${CB_CALL_COLOR}aa` : undefined,
                }} />
              ))}
          </span>
        </div>
      </div>
    )
  }

  const statusTone = v.running ? '#30d158' : v.toMs > 0 ? CB_CALL_COLOR : st.phase === 'over' || v.expired ? '#ffffff' : '#ffd60a'
  const halves = cbHalfScores(st)
  // half-time: the game clock counts the rest down (as on a basketball board)
  const shownClock = st.phase === 'break' ? v.brkMs : v.clock
  const band = v.toMs > 0
    ? { c: CB_CALL_COLOR, txt: `Team call · ${teamName(b, id(v.toSide!))}`, t: v.toMs }
    : st.phase === 'break'
    ? { c: '#64d2ff', txt: 'Half-time rest', t: -1 }
    : null

  return (
    <div ref={ref} className="mx-auto w-full" style={{ maxWidth: size === 'card' ? 'none' : `calc(54 * ${CAP[size]})` }}>
      <div className="overflow-hidden rounded-[1em] border-[0.15em] border-[#1c1f25] bg-[#050607] text-white"
        style={{ fontSize, padding: '1em 1.3em 1.1em', boxShadow: 'inset 0 0 3em #000' }}>
        {/* header */}
        <div className="flex items-center justify-between" style={{ height: '1.6em' }}>
          <span className={`truncate ${lbl}`} style={{ fontSize: 'max(1em, 10px)' }}>
            {[courtLabel, cbRound(m), `Game ${m.sequence}`].filter(Boolean).join(' · ')}
          </span>
          <span className="flex shrink-0 items-center justify-end font-display font-bold uppercase tracking-[0.18em]"
            style={{ fontSize: 'max(1em, 10px)', gap: '0.5em', color: statusTone, minWidth: '9em' }}>
            <span className={`rounded-full ${v.running ? 'animate-pulse' : ''}`} style={{ width: '0.7em', height: '0.7em', background: statusTone }} />
            <span className="whitespace-nowrap">{v.status}</span>
          </span>
        </div>

        <div className="mt-[0.6em] grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)]"
          style={{ columnGap: '1.3em', rowGap: '0.6em', gridTemplateRows: '3.6em 0.28em auto auto' }}>
          {nameCell(left)}
          <div className="flex items-center justify-center">
            <span className="font-display font-bold uppercase text-white" style={{ fontSize: '1.9em', letterSpacing: '0.16em' }}>{v.periodLabel}</span>
          </div>
          {nameCell(right)}

          {barCell(CB_TEAM_COLOR[left])}
          {barCell('#2a2e35', '40%', false)}
          {barCell(CB_TEAM_COLOR[right])}

          {scoreCell(left)}
          <div className={`${box} flex items-center justify-center`} style={{ height: tileH, padding: '0 0.9em' }}>
            <SevenSeg text={segClock(shownClock)} color={CB_CLOCK_COLOR} size="7.5em" label={fmtClock(shownClock)} />
          </div>
          {scoreCell(right)}

          {lowCell(left)}
          <div className="grid grid-cols-2 gap-[0.6em]">
            {(halves.length >= 2 ? halves.slice(-2) : [...halves, { label: `${ordinal(2)} HALF`, a: -1, b: -1 }]).map(h => (
              <div key={h.label} className={`${box} flex flex-col items-center justify-between`} style={{ height: bh, padding: '0.4em' }}>
                <span className={lbl} style={lblSize}>{h.label}</span>
                <span className="tabular flex flex-1 items-center font-display font-bold text-white" style={{ fontSize: '1.7em', lineHeight: 1 }}>
                  {h.a < 0 ? <span className="text-[#3a3f48]">– –</span> : <>
                    <span style={{ color: CB_TEAM_COLOR[left] }}>{h[left]}</span>
                    <span className="text-[#5b6270]">&nbsp;–&nbsp;</span>
                    <span style={{ color: CB_TEAM_COLOR[right] }}>{h[right]}</span>
                  </>}
                </span>
              </div>
            ))}
          </div>
          {lowCell(right)}
        </div>

        {/* team call / half-time countdown — the slot is always there, so nothing jumps */}
        <div className="mt-[0.9em] flex items-center justify-center overflow-hidden rounded-[0.5em] border-[0.1em]"
          style={{
            height: '4em', gap: '0.9em', padding: '0 0.8em',
            borderColor: band ? `${band.c}88` : '#16191e',
            background: band ? `${band.c}1f` : 'transparent',
          }}>
          {band && <>
            <span className="min-w-0 truncate text-center font-display font-bold uppercase tracking-[0.1em]" style={{ fontSize: '1.5em', color: band.c }}>{band.txt}</span>
            {band.t >= 0 && <span className="shrink-0"><SevenSeg text={segClock(band.t, false).trimStart()} color={band.c} size="2.3em" /></span>}
          </>}
        </div>
      </div>
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
    <div className={tv ? 'space-y-4' : `mx-auto space-y-4 p-3 lg:p-5 ${live.length > 1 ? 'max-w-[96rem]' : 'max-w-[50rem]'}`}>
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
      {!tv && <CbUpNext b={b} n={n} big={false} />}
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
          <span>🏐</span><span>{ev.name || 'Captain Ball'}</span>
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
        <div className={H}>Team calls (per team)</div>
        <div className="grid grid-cols-[repeat(auto-fill,minmax(10rem,1fr))] gap-4">
          <Field label="Call length (sec)"><Stepper value={r.to_sec} min={10} max={180} onChange={v => set('to_sec')(Math.round(v / 5) * 5 || 10)} /></Field>
          <Field label="1st half"><Stepper value={r.to_h1} min={0} max={9} onChange={set('to_h1')} /></Field>
          <Field label="2nd half / extra"><Stepper value={r.to_h2} min={0} max={9} onChange={set('to_h2')} /></Field>
        </div>
        <p className="text-xs text-fg-subtle">Each team call stops the game clock and runs its own countdown. The court scorer can also give a team one extra call during a game.</p>
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
