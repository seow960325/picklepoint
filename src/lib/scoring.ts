import type { EventCfg, Match } from './types'

/** Pure scoring rules. Mirrored by score_point() in SQL so the optimistic
 *  client update and the server agree. Unit-tested in tests/scoring.test.mjs. */

export interface Rules {
  target_score: number
  win_by: number
  cap: number
  switch_at: number
}

export const rulesOf = (e: EventCfg): Rules => ({
  target_score: e.target_score, win_by: e.win_by, cap: e.cap, switch_at: e.switch_at,
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
    status: isGameOver(score_a, score_b, r) ? 'awaiting_confirm' : 'live',
  }
}

/** Roll back to a known previous score (from the point-event log). */
export function applyUndo(m: Match, prevA: number, prevB: number, r: Rules): Match {
  const hi = Math.max(prevA, prevB)
  const unSwitch = r.switch_at > 0 && m.sides_switched && hi < r.switch_at
  return {
    ...m,
    score_a: prevA, score_b: prevB,
    a_on_left: unSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: m.sides_switched && r.switch_at > 0 && hi >= r.switch_at,
    status: 'live',
  }
}

/** "9 - 7", always from the left-hand team's point of view. */
export function displayScores(m: Match): { left: number; right: number } {
  return m.a_on_left
    ? { left: m.score_a, right: m.score_b }
    : { left: m.score_b, right: m.score_a }
}
