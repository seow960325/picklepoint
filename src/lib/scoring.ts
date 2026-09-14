import type { EventCfg, Match, ServeMode } from './types'

/** Pure scoring rules. Mirrored by score_point() in SQL so the optimistic
 *  client update and the server agree. Unit-tested in tests/scoring.test.mjs. */

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

/** Apply one point to a physical side. Returns the next match state. */
export function applyPoint(m: Match, side: 'left' | 'right', r: Rules): Match {
  const who = teamForSide(m, side)
  const score_a = m.score_a + (who === 'a' ? 1 : 0)
  const score_b = m.score_b + (who === 'b' ? 1 : 0)
  const hi = Math.max(score_a, score_b)

  // Ends are switched exactly once, the first time the leader reaches switch_at.
  // switch_at <= 0 means the organizer turned end-switching off entirely.
  const doSwitch = r.switch_at > 0 && !m.sides_switched && hi >= r.switch_at

  return {
    ...m,
    score_a, score_b,
    a_on_left: doSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: doSwitch || m.sides_switched,
    // the team that just won this point serves next under 'winner' mode
    last_scorer: who,
    status: isGameOver(score_a, score_b, r) ? 'awaiting_confirm' : 'live',
  }
}

/** Roll back to a known previous score (from the point-event log).
 *  prevScorer is the team that won the point BEFORE the one being undone
 *  (null if undoing the very first point) — pass it when known so the
 *  serve indicator rolls back accurately; omit it for a purely optimistic
 *  local update that a server round-trip will immediately correct. */
export function applyUndo(
  m: Match, prevA: number, prevB: number, r: Rules, prevScorer: 'a' | 'b' | null = null,
): Match {
  const hi = Math.max(prevA, prevB)
  const unSwitch = r.switch_at > 0 && m.sides_switched && hi < r.switch_at
  return {
    ...m,
    score_a: prevA, score_b: prevB,
    a_on_left: unSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: m.sides_switched && r.switch_at > 0 && hi >= r.switch_at,
    last_scorer: prevScorer,
    status: 'live',
  }
}

/** Which team serves next, given the configured serve mode. */
export function serverTeam(m: Match, mode: ServeMode): 'a' | 'b' {
  if (mode === 'alternate') {
    // service swaps sides every 2 total points, regardless of who scores
    const total = m.score_a + m.score_b
    return Math.floor(total / 2) % 2 === 0 ? 'a' : 'b'
  }
  return m.last_scorer ?? 'a'
}

/** Which physical side (left/right) serves next. */
export function servingSide(m: Match, mode: ServeMode): 'left' | 'right' {
  const team = serverTeam(m, mode)
  return (team === 'a') === m.a_on_left ? 'left' : 'right'
}

/** "9 - 7", always from the left-hand team's point of view. */
export function displayScores(m: Match): { left: number; right: number } {
  return m.a_on_left
    ? { left: m.score_a, right: m.score_b }
    : { left: m.score_b, right: m.score_a }
}
