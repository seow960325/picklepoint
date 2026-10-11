/** Captain ball (multi-sport, migration 0031). A basketball-style game:
 *  timed halves on a countdown clock, +1 / +2 points, team fouls, per-team
 *  60-second time-outs, half-time rest then the teams swap ends.
 *
 *  The whole game state lives in matches.cb (jsonb) and is written by the
 *  court scorer with one RPC (cb_save). Every action below is a pure
 *  function: (state) -> new state with rev + 1. The clock is stored as
 *  "ms remaining at the moment `at`" so every screen ticks it locally and
 *  nothing has to be sent every second. Nothing here touches the other
 *  sports' scoring. */
import type { Bundle, EventCfg, Match, Team } from './types'
import { buildDraw, type DraftMatch } from './draw.ts'

export interface CbRules {
  half_min: number      // length of one half, minutes
  halves: number        // halves per game (2)
  rest_min: number      // half-time rest, minutes
  to_sec: number        // one time-out, seconds
  to_h1: number         // time-outs per team, 1st half
  to_h2: number         // time-outs per team, 2nd half (and extra time)
  extra_min: number     // extra time when a game is level at full time
  win: number; draw: number; loss: number   // table points
}

export const CB_DEFAULT: CbRules = {
  half_min: 10, halves: 2, rest_min: 2, to_sec: 60, to_h1: 2, to_h2: 2,
  extra_min: 3, win: 3, draw: 1, loss: 0,
}

export const cbRulesOf = (ev?: Pick<EventCfg, 'cb_rules'> | null): CbRules =>
  ({ ...CB_DEFAULT, ...(ev?.cb_rules ?? {}) })

export type Side = 'a' | 'b'
export type CbPhase = 'ready' | 'play' | 'break' | 'over'
export interface CbScore { s: Side; n: number; h: number; c: number }
export interface CbState {
  rev: number
  r: CbRules              // rules snapshot taken when the game was opened
  half: number            // 1..halves
  et: boolean             // extra time
  phase: CbPhase          // ready = clock set, not started yet
  ms: number              // clock remaining at `at` (or now, when stopped)
  at: number | null       // epoch ms the clock last started; null = stopped
  to: { s: Side; until: number } | null    // running time-out
  brk: number | null      // half-time rest ends at (epoch ms)
  tou: { a: number[]; b: number[] }        // time-outs used, per half index
  tox: { a: number; b: number }            // extra time-outs granted by the referee
  f: { a: number; b: number }              // team fouls
  log: CbScore[]          // every score change, newest last (undo pops it)
  adj: number            // net ms the referee added to (or took from) the clock
}

export interface CbSnap { st: CbState; aOnLeft: boolean }

export const halfMs = (r: CbRules) => Math.round(r.half_min * 60000)

export function cbFresh(r: CbRules, rev = 0): CbState {
  return {
    rev, r, half: 1, et: false, phase: 'ready', ms: halfMs(r), at: null,
    to: null, brk: null, tou: { a: [], b: [] }, tox: { a: 0, b: 0 }, f: { a: 0, b: 0 }, log: [], adj: 0,
  }
}

/** The game state of a match. A match that was never started — or was reset
 *  by the admin (started_at back to null) — is a fresh game. */
export function cbStateOf(m: Match, ev?: EventCfg | null): CbState {
  const raw = m.cb as CbState | null | undefined
  if (!raw || !m.started_at) return cbFresh(cbRulesOf(ev))
  return { ...cbFresh(cbRulesOf(ev)), ...raw, r: { ...CB_DEFAULT, ...(raw.r ?? cbRulesOf(ev)) } }
}

export const cbScore = (st: CbState): { a: number; b: number } => {
  let a = 0, b = 0
  for (const e of st.log) if (e.s === 'a') a += e.n; else b += e.n
  return { a: Math.max(0, a), b: Math.max(0, b) }
}

export const clockAt = (st: CbState, now: number): number =>
  st.at == null ? st.ms : Math.max(0, st.ms - (now - st.at))

const halfIdx = (st: CbState) => (st.et ? st.r.halves : st.half - 1)

/** Time-outs a team still has in the current half. */
export function toLeft(st: CbState, s: Side): number {
  const i = halfIdx(st)
  const base = i === 0 ? st.r.to_h1 : st.r.to_h2
  return Math.max(0, base + st.tox[s] - (st.tou[s][i] ?? 0))
}
export const toAllowed = (st: CbState, s: Side): number =>
  (halfIdx(st) === 0 ? st.r.to_h1 : st.r.to_h2) + st.tox[s]

export interface CbView {
  clock: number            // ms left on the game clock
  running: boolean
  expired: boolean         // clock ran out but the half is not closed yet
  toMs: number             // time-out left (0 = none)
  toSide: Side | null
  brkMs: number            // half-time rest left
  periodLabel: string      // "HALF 1" / "EXTRA TIME"
  status: string           // short status line for the board
}

export function cbView(st: CbState, now: number): CbView {
  const clock = clockAt(st, now)
  const running = st.at != null && clock > 0 && st.phase === 'play'
  const expired = st.phase === 'play' && clock <= 0
  const toMs = st.to && st.to.until > now ? st.to.until - now : 0
  const brkMs = st.phase === 'break' && st.brk ? Math.max(0, st.brk - now) : 0
  const lastHalf = st.half >= st.r.halves
  const periodLabel = st.et ? 'EXTRA TIME' : `HALF ${st.half}`
  const status = st.phase === 'over' ? 'FULL TIME'
    : st.phase === 'break' ? 'HALF-TIME'
    : expired ? (lastHalf || st.et ? 'FULL TIME' : 'END OF HALF')
    : toMs > 0 ? 'TIME-OUT'
    : st.phase === 'ready' ? (st.half === 1 && !st.et ? 'READY' : 'READY')
    : running ? 'LIVE' : 'CLOCK STOPPED'
  return { clock, running, expired, toMs, toSide: toMs > 0 ? st.to!.s : null, brkMs, periodLabel, status }
}

/** "9:58", or "42.7" under a minute (like a basketball clock). */
export function fmtClock(ms: number, tenths = true): string {
  const t = Math.max(0, ms)
  if (tenths && t < 60000) {
    const d = Math.floor(t / 100)
    return `${Math.floor(d / 10)}.${d % 10}`
  }
  const s = Math.ceil(t / 1000)
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`
}

// -------------------------------------------------------------- actions
export type Act = (p: CbSnap, now: number) => CbSnap
const bump = (p: CbSnap, st: Partial<CbState>, aOnLeft = p.aOnLeft): CbSnap =>
  ({ st: { ...p.st, ...st, rev: p.st.rev + 1 }, aOnLeft })
const stopAt = (st: CbState, now: number) => ({ ms: clockAt(st, now), at: null })

/** Start / resume the clock (also ends a running time-out early). */
export const cbRun: Act = (p, now) => {
  const st = p.st
  if (st.phase === 'ready') return bump(p, { phase: 'play', at: now, to: null })
  if (st.phase !== 'play' || st.at != null || st.ms <= 0) return p
  return bump(p, { at: now, to: null })
}

export const cbStop: Act = (p, now) =>
  p.st.at == null ? p : bump(p, stopAt(p.st, now))

export const cbPoint = (s: Side, n: number): Act => (p, now) => {
  const st = p.st
  if (n < 0 && cbScore(st)[s] + n < 0) return p
  return bump(p, { log: [...st.log, { s, n, h: st.et ? st.r.halves + 1 : st.half, c: clockAt(st, now) }] })
}

export const cbUndo: Act = p => (p.st.log.length ? bump(p, { log: p.st.log.slice(0, -1) }) : p)

export const cbFoul = (s: Side, d: number): Act => p => {
  const v = Math.max(0, p.st.f[s] + d)
  return v === p.st.f[s] ? p : bump(p, { f: { ...p.st.f, [s]: v } })
}

/** Team time-out: the clock stops and a time-out countdown starts. */
export const cbTimeout = (s: Side): Act => (p, now) => {
  const st = p.st
  if (st.phase === 'over' || st.phase === 'break' || toLeft(st, s) < 1) return p
  const i = halfIdx(st)
  const used = [...st.tou[s]]
  while (used.length <= i) used.push(0)
  used[i]++
  return bump(p, { ...stopAt(st, now), to: { s, until: now + st.r.to_sec * 1000 }, tou: { ...st.tou, [s]: used } })
}

export const cbEndTimeout: Act = p => (p.st.to ? bump(p, { to: null }) : p)

/** Give back the last time-out a team took (called by mistake). */
export const cbTimeoutBack = (s: Side): Act => p => {
  const st = p.st, i = halfIdx(st)
  if (!(st.tou[s][i] > 0)) return p
  const used = [...st.tou[s]]; used[i]--
  return bump(p, { tou: { ...st.tou, [s]: used }, to: st.to?.s === s ? null : st.to })
}

export const cbGrantTimeout = (s: Side, d: number): Act => p => {
  const v = p.st.tox[s] + d
  if (v < -10 || v > 10) return p
  return bump(p, { tox: { ...p.st.tox, [s]: v } })
}

/** Add (or take) time on the game clock — e.g. time lost to an argument. */
export const cbAdjust = (delta: number): Act => (p, now) => {
  const st = p.st
  if (st.phase !== 'play' && st.phase !== 'ready') return p
  const was = clockAt(st, now)
  const ms = Math.max(0, Math.min(99 * 60000, was + delta))
  if (ms === was) return p
  // a clock that had already run out stays stopped after time is added back
  return bump(p, { ms, at: st.at == null || was <= 0 ? null : now, adj: st.adj + (ms - was) })
}

/** Swap which team is shown on the left (e.g. the teams were put on the wrong side). */
export const cbFlip: Act = p => ({ st: { ...p.st, rev: p.st.rev + 1 }, aOnLeft: !p.aOnLeft })

/** Close the half: half-time rest, or full time after the last half. */
export const cbEndHalf: Act = (p, now) => {
  const st = p.st
  if (st.phase !== 'play' && st.phase !== 'ready') return p
  const last = st.et || st.half >= st.r.halves
  return bump(p, last
    ? { ms: 0, at: null, to: null, phase: 'over' }
    : { ms: 0, at: null, to: null, phase: 'break', brk: now + Math.round(st.r.rest_min * 60000) })
}

/** After the rest: next half, full clock, teams swap ends. */
export const cbNextHalf: Act = p => {
  const st = p.st
  if (st.phase !== 'break') return p
  return bump(p, { phase: 'ready', half: st.half + 1, ms: halfMs(st.r), at: null, brk: null, to: null }, !p.aOnLeft)
}

/** Level at full time: play extra time. */
export const cbExtraTime: Act = p => {
  const st = p.st
  if (st.phase !== 'over') return p
  return bump(p, { phase: 'ready', et: true, ms: Math.round(st.r.extra_min * 60000), at: null, to: null })
}

/** Undo "full time" (pressed too early): back to the stopped clock. */
export const cbReopen: Act = p => (p.st.phase === 'over' ? bump(p, { phase: 'play', at: null }) : p)

/** Start the whole game again from 0-0 (keeps the rev counting up). */
export const cbRestart = (r: CbRules): Act => p => ({ st: cbFresh(r, p.st.rev + 1), aOnLeft: true })

// ------------------------------------------------------------ standings
export interface CbRow {
  team: Team; p: number; w: number; d: number; l: number
  pf: number; pa: number; diff: number; pts: number
}

/** Round-robin table: points, then point difference, then points for,
 *  then head-to-head result. Draws count (win 3 / draw 1 by default). */
export function cbStandings(b: Bundle, eventId: string): CbRow[] {
  const ev = b.events.find(e => e.id === eventId)
  const r = cbRulesOf(ev)
  const rows = new Map<string, CbRow>()
  b.teams.filter(t => t.event_id === eventId).forEach(team =>
    rows.set(team.id, { team, p: 0, w: 0, d: 0, l: 0, pf: 0, pa: 0, diff: 0, pts: 0 }))
  const games = b.matches.filter(m => m.event_id === eventId && m.status === 'finished' && !m.tie_stage)
  for (const m of games) {
    const A = rows.get(m.team_a_id ?? ''), B = rows.get(m.team_b_id ?? '')
    if (!A || !B) continue
    A.p++; B.p++
    A.pf += m.score_a; A.pa += m.score_b; B.pf += m.score_b; B.pa += m.score_a
    if (m.score_a > m.score_b) { A.w++; B.l++; A.pts += r.win; B.pts += r.loss }
    else if (m.score_b > m.score_a) { B.w++; A.l++; B.pts += r.win; A.pts += r.loss }
    else { A.d++; B.d++; A.pts += r.draw; B.pts += r.draw }
  }
  rows.forEach(x => { x.diff = x.pf - x.pa })
  const h2h = (x: CbRow, y: CbRow) => {
    let s = 0
    for (const m of games) {
      if (m.team_a_id === x.team.id && m.team_b_id === y.team.id) s += Math.sign(m.score_a - m.score_b)
      if (m.team_b_id === x.team.id && m.team_a_id === y.team.id) s += Math.sign(m.score_b - m.score_a)
    }
    return s
  }
  return [...rows.values()].sort((x, y) =>
    y.pts - x.pts || y.diff - x.diff || y.pf - x.pf || h2h(y, x) || x.team.name.localeCompare(y.team.name))
}

// ----------------------------------------------------------------- draw
export interface CbDraftMatch extends DraftMatch { tie: string; game: string }

/** Round robin, one game per fixture (no MD/XD split). */
export function buildCbDraw(teams: Array<{ name: string; pool: string }>, courts: number): CbDraftMatch[] {
  if (courts < 1) return []
  return buildDraw(teams, courts).map((f, i) => ({
    ...f, tie: String(i + 1), game: 'CB', label: `${f.pool} · R${f.round}`,
  }))
}

/** "A · R3" -> "Round 3" */
export const cbRound = (m: Match): string => {
  const r = (m.round ?? '').split(' · ')[1]
  return r && /^R\d+$/.test(r) ? `Round ${r.slice(1)}` : (m.round ?? '')
}
