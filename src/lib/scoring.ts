import type { EventCfg, Match, ServeMode } from './types'

/** Pure scoring rules. Mirrored by score_point() in SQL so the optimistic
 *  client update and the server agree. Unit-tested in tests/scoring.test.mjs.
 *
 *  Two serve modes:
 *   - 'winner' (default): rally scoring — whoever wins the rally scores a
 *     point, every time. The "server" is purely a display indicator: the
 *     team that won the last point is shown serving next.
 *   - 'alternate' ("Serve"): real side-out doubles scoring, per USA
 *     Pickleball's official rule — only the serving team can score. Losing
 *     a rally while serving is a "fault": the first fault passes serve to
 *     your partner (server #2, same team, no side change); the second
 *     fault is a side-out and the OTHER team starts serving. The very
 *     first service of the game is a documented exception — that side only
 *     gets one server, not two (officially scored "0-0-2") — so a fresh
 *     match starts at server_no = 2 unless the referee has picked a first
 *     server, in which case that pick seeds the same exception. */

export interface Rules {
  target_score: number
  win_by: number
  cap: number
  switch_at: number
  serve_mode: ServeMode
}

export const rulesOf = (e: EventCfg): Rules => ({
  target_score: e.target_score, win_by: e.win_by, cap: e.cap, switch_at: e.switch_at,
  serve_mode: e.serve_mode ?? 'winner',
})

export function isGameOver(a: number, b: number, r: Rules): boolean {
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return (hi >= r.target_score && hi - lo >= r.win_by) || hi >= r.cap
}

/** Which team a physical side belongs to right now. */
export function teamForSide(m: Match, side: 'left' | 'right'): 'a' | 'b' {
  return (side === 'left') === m.a_on_left ? 'a' : 'b'
}

const other = (t: 'a' | 'b'): 'a' | 'b' => (t === 'a' ? 'b' : 'a')

function withSwitchAndStatus(m: Match, score_a: number, score_b: number, r: Rules) {
  const hi = Math.max(score_a, score_b)
  const doSwitch = r.switch_at > 0 && !m.sides_switched && hi >= r.switch_at
  return {
    a_on_left: doSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: doSwitch || m.sides_switched,
    status: (isGameOver(score_a, score_b, r) ? 'awaiting_confirm' : 'live') as Match['status'],
  }
}

/** Rally scoring ('winner' mode) — every rally scores, winner serves next. */
function applyRallyPoint(m: Match, who: 'a' | 'b', r: Rules): Match {
  const score_a = m.score_a + (who === 'a' ? 1 : 0)
  const score_b = m.score_b + (who === 'b' ? 1 : 0)
  return {
    ...m, score_a, score_b,
    last_scorer: who,
    ...withSwitchAndStatus(m, score_a, score_b, r),
  }
}

/** Real doubles side-out scoring ('alternate'/"Serve" mode). `winner` is
 *  whichever side won the rally — the referee always taps the winning side,
 *  same gesture as rally scoring, but a point only lands if that side was
 *  serving. */
function applySideOutPoint(m: Match, winner: 'a' | 'b', r: Rules): Match {
  const serving = m.serving_team ?? m.initial_server ?? 'a'
  // official first-service-of-the-game exception: only one server, not two
  const serverNo = activeServerNo(m)

  if (winner === serving) {
    const score_a = m.score_a + (winner === 'a' ? 1 : 0)
    const score_b = m.score_b + (winner === 'b' ? 1 : 0)
    return {
      ...m, score_a, score_b,
      serving_team: serving, server_no: serverNo,
      ...withSwitchAndStatus(m, score_a, score_b, r),
    }
  }

  // serving side lost the rally — no point scored (side-out scoring).
  if (serverNo === 1) {
    // first fault: serve passes to the partner, same team, second server up
    return { ...m, serving_team: serving, server_no: 2 }
  }
  // second fault: side-out — the other team takes serve, starting at server 1
  return { ...m, serving_team: other(serving), server_no: 1 }
}

/** Apply one point/rally to a physical side. Returns the next match state. */
export function applyPoint(m: Match, side: 'left' | 'right', r: Rules): Match {
  const who = teamForSide(m, side)
  return r.serve_mode === 'alternate' ? applySideOutPoint(m, who, r) : applyRallyPoint(m, who, r)
}

export interface UndoState {
  last_scorer?: 'a' | 'b' | null
  serving_team?: 'a' | 'b' | null
  server_no?: 1 | 2 | null
}

/** Roll back to a known previous score (from the point-event log). `prev`
 *  carries whichever serve-tracking fields applied under the active mode,
 *  read from the point-events row before the one being undone (or omitted
 *  entirely when undoing the very first rally, or for a purely optimistic
 *  local update that a server round-trip will immediately correct). */
export function applyUndo(
  m: Match, prevA: number, prevB: number, r: Rules, prev: UndoState = {},
): Match {
  const hi = Math.max(prevA, prevB)
  const unSwitch = r.switch_at > 0 && m.sides_switched && hi < r.switch_at
  return {
    ...m,
    score_a: prevA, score_b: prevB,
    a_on_left: unSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: m.sides_switched && r.switch_at > 0 && hi >= r.switch_at,
    last_scorer: prev.last_scorer ?? null,
    serving_team: prev.serving_team ?? null,
    server_no: prev.server_no ?? null,
    status: 'live',
  }
}

/** Referee's pick of who serves first — only meaningful before any point
 *  has been played. Feeds both modes: seeds the display in 'winner' mode,
 *  and seeds the real first-service-of-the-game exception in 'alternate'. */
export function setFirstServer(m: Match, team: 'a' | 'b'): Match {
  return { ...m, initial_server: team }
}

/** Which team serves next, given the configured serve mode. */
export function serverTeam(m: Match, mode: ServeMode): 'a' | 'b' {
  if (mode === 'alternate') return m.serving_team ?? m.initial_server ?? 'a'
  return m.last_scorer ?? m.initial_server ?? 'a'
}

/** Which physical side (left/right) serves next. */
export function servingSide(m: Match, mode: ServeMode): 'left' | 'right' {
  const team = serverTeam(m, mode)
  return (team === 'a') === m.a_on_left ? 'left' : 'right'
}

/** Which service court the server stands in, per the international rule:
 *  even score (server's own team score) → right court, odd → left court.
 *  Applied in both modes now — in 'winner' mode the "server" is just
 *  whoever won the last rally, but the same even/odd positioning still
 *  gives the ball a real court reference instead of a fixed spot. */
export function serverCourt(m: Match, mode: ServeMode): 'right' | 'left' {
  const team = serverTeam(m, mode)
  const score = team === 'a' ? m.score_a : m.score_b
  return score % 2 === 0 ? 'right' : 'left'
}

/** The server number (1 or 2) currently up, accounting for the
 *  game-opening exception — a fresh match (or one just reset) has no
 *  server_no recorded yet, and that means the opening server, who only
 *  gets one fault before a side-out. Single source of truth so the score
 *  call text and the on-court server badge never disagree. */
export function activeServerNo(m: Match): 1 | 2 {
  return m.server_no ?? 2
}

/** Official score call — "serving score - receiving score - server #",
 *  the exact three numbers the server states aloud before each serve under
 *  USA Pickleball's doubles rule. Only meaningful in 'alternate' (Serve)
 *  mode; null in 'winner' mode where there's no side-out server to call. */
export function scoreCall(m: Match, mode: ServeMode): string | null {
  if (mode !== 'alternate') return null
  const serving = m.serving_team ?? m.initial_server ?? 'a'
  const servingScore = serving === 'a' ? m.score_a : m.score_b
  const receivingScore = serving === 'a' ? m.score_b : m.score_a
  return `${servingScore}-${receivingScore}-${activeServerNo(m)}`
}

/** "9 - 7", always from the left-hand team's point of view. */
export function displayScores(m: Match): { left: number; right: number } {
  return m.a_on_left
    ? { left: m.score_a, right: m.score_b }
    : { left: m.score_b, right: m.score_a }
}
