import test from 'node:test'
import assert from 'node:assert/strict'

// Mirror of src/lib/scoring.ts (kept in JS so the test runs with no build step).
const R = { target_score: 15, win_by: 2, cap: 17, switch_at: 8 }

const isGameOver = (a, b, r) => {
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return (hi >= r.target_score && hi - lo >= r.win_by) || hi >= r.cap
}
const teamForSide = (m, side) => ((side === 'left') === m.a_on_left ? 'a' : 'b')
const applyPoint = (m, side, r) => {
  const who = teamForSide(m, side)
  const score_a = m.score_a + (who === 'a' ? 1 : 0)
  const score_b = m.score_b + (who === 'b' ? 1 : 0)
  const hi = Math.max(score_a, score_b)
  // switch_at <= 0 means end-switching is turned off entirely.
  const doSwitch = r.switch_at > 0 && !m.sides_switched && hi >= r.switch_at
  return {
    ...m, score_a, score_b,
    a_on_left: doSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: doSwitch || m.sides_switched,
    last_scorer: who,
    status: isGameOver(score_a, score_b, r) ? 'awaiting_confirm' : 'live',
  }
}
const applyUndo = (m, prevA, prevB, r, prevScorer = null) => {
  const hi = Math.max(prevA, prevB)
  const unSwitch = r.switch_at > 0 && m.sides_switched && hi < r.switch_at
  return {
    ...m, score_a: prevA, score_b: prevB,
    a_on_left: unSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: m.sides_switched && r.switch_at > 0 && hi >= r.switch_at,
    last_scorer: prevScorer,
    status: 'live',
  }
}
const serverTeam = (m, mode) => {
  if (mode === 'alternate') {
    const total = m.score_a + m.score_b
    return Math.floor(total / 2) % 2 === 0 ? 'a' : 'b'
  }
  return m.last_scorer ?? 'a'
}
const servingSide = (m, mode) => ((serverTeam(m, mode) === 'a') === m.a_on_left ? 'left' : 'right')

const fresh = () => ({
  score_a: 0, score_b: 0, a_on_left: true, sides_switched: false, status: 'live',
})
const tapLeft = (m, n = 1) => { for (let i = 0; i < n; i++) m = applyPoint(m, 'left', R); return m }
const tapRight = (m, n = 1) => { for (let i = 0; i < n; i++) m = applyPoint(m, 'right', R); return m }

test('a tap on the left scores the team currently on the left', () => {
  const m = tapLeft(fresh())
  assert.equal(m.score_a, 1)
  assert.equal(m.score_b, 0)
})

test('ends switch exactly once, when the leader first reaches 8', () => {
  let m = tapLeft(fresh(), 7)
  assert.equal(m.sides_switched, false, 'no switch at 7')
  assert.equal(m.a_on_left, true)

  m = tapLeft(m)                       // 8th point for team A
  assert.equal(m.sides_switched, true)
  assert.equal(m.a_on_left, false, 'team A moved to the right half')
  assert.equal(m.score_a, 8)

  // Team A is now on the RIGHT, so its next point comes from a right tap.
  m = tapRight(m)
  assert.equal(m.score_a, 9, 'right tap now scores team A')
  assert.equal(m.score_b, 0)
  assert.equal(m.a_on_left, false, 'no second switch')
})

test('the losing team scoring 8 first also triggers the switch', () => {
  let m = tapRight(fresh(), 8)
  assert.equal(m.score_b, 8)
  assert.equal(m.sides_switched, true)
  assert.equal(m.a_on_left, false)
})

test('game ends at 15 with a 2-point margin', () => {
  let m = fresh()
  m = tapLeft(m, 14); m = tapRight(m, 13)   // 14-13, A on left until 8 → careful
  // recompute cleanly: drive to 14-13 respecting the switch
  m = fresh()
  for (let i = 0; i < 14; i++) m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)
  for (let i = 0; i < 13; i++) m = applyPoint(m, m.a_on_left ? 'right' : 'left', R)
  assert.deepEqual([m.score_a, m.score_b], [14, 13])

  m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)   // 15-13
  assert.equal(m.status, 'awaiting_confirm')
})

test('15-14 does not end the game (win by 2)', () => {
  let m = fresh()
  for (let i = 0; i < 14; i++) m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)
  for (let i = 0; i < 14; i++) m = applyPoint(m, m.a_on_left ? 'right' : 'left', R)
  m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)
  assert.deepEqual([m.score_a, m.score_b], [15, 14])
  assert.equal(m.status, 'live')
})

test('the 17 cap ends a runaway deuce', () => {
  let m = fresh()
  for (let i = 0; i < 16; i++) m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)
  for (let i = 0; i < 16; i++) m = applyPoint(m, m.a_on_left ? 'right' : 'left', R)
  assert.equal(m.status, 'live', '16-16 keeps going')
  m = applyPoint(m, m.a_on_left ? 'left' : 'right', R)
  assert.deepEqual([m.score_a, m.score_b], [17, 16])
  assert.equal(m.status, 'awaiting_confirm', 'cap reached')
})

test('undo below 8 puts the ends back', () => {
  let m = tapLeft(fresh(), 8)
  assert.equal(m.a_on_left, false)
  m = applyUndo(m, 7, 0, R)
  assert.equal(m.a_on_left, true, 'ends restored')
  assert.equal(m.sides_switched, false)
  assert.equal(m.score_a, 7)
})

test('undo above 8 leaves the ends alone', () => {
  let m = tapLeft(fresh(), 8)
  m = tapRight(m, 2)               // team A on right: these go to team B... check
  const before = { ...m }
  m = applyUndo(m, before.score_a, before.score_b - 1, R)
  assert.equal(m.a_on_left, before.a_on_left, 'still switched')
  assert.equal(m.sides_switched, true)
})

test('undoing back to 0-0 fully resets orientation', () => {
  let m = tapLeft(fresh(), 8)
  m = applyUndo(m, 0, 0, R)
  assert.equal(m.a_on_left, true)
  assert.equal(m.sides_switched, false)
  assert.equal(m.status, 'live')
})

test('switch_at = 0 means end-switching is off — sides never flip', () => {
  const OFF = { ...R, switch_at: 0 }
  let m = fresh()
  for (let i = 0; i < 14; i++) m = applyPoint(m, m.a_on_left ? 'left' : 'right', OFF)
  for (let i = 0; i < 13; i++) m = applyPoint(m, m.a_on_left ? 'right' : 'left', OFF)
  assert.deepEqual([m.score_a, m.score_b], [14, 13])
  assert.equal(m.sides_switched, false, 'would normally have switched at 8')
  assert.equal(m.a_on_left, true)

  m = applyPoint(m, m.a_on_left ? 'left' : 'right', OFF)   // 15-13
  assert.equal(m.status, 'awaiting_confirm', 'the game still ends normally')
  assert.equal(m.sides_switched, false)

  // undo shouldn't misbehave with switching off either
  m = applyUndo(m, 14, 13, OFF)
  assert.equal(m.a_on_left, true)
  assert.equal(m.sides_switched, false)
})

// -------------------------------------------------------- serve mode

test('winner mode: whoever wins the point serves next', () => {
  let m = fresh()
  m.last_scorer = null
  assert.equal(servingSide(m, 'winner'), 'left', 'no points yet — defaults to team A / left')
  m = tapLeft(m)
  assert.equal(servingSide(m, 'winner'), 'left', 'team A won, still on the left')
  m = tapRight(m)
  assert.equal(servingSide(m, 'winner'), 'right', 'team B just won the point')
})

test('winner mode follows the team across a switched end', () => {
  let m = tapLeft(fresh(), 8)          // team A: 8 points, triggers the switch
  assert.equal(m.a_on_left, false, 'team A now on the right')
  assert.equal(servingSide(m, 'winner'), 'right', 'server (team A) followed to the right')
})

test('alternate mode swaps serve every 2 total points, ignoring the winner', () => {
  let m = fresh()
  assert.equal(serverTeam(m, 'alternate'), 'a', '0 total points — team A serves')
  m = tapRight(m)                       // team B scores, total = 1
  assert.equal(serverTeam(m, 'alternate'), 'a', 'still team A until 2 total points')
  m = tapRight(m)                       // total = 2
  assert.equal(serverTeam(m, 'alternate'), 'b', 'swapped to team B at 2 total points')
  m = tapLeft(m)                        // team A scores, total = 3 — irrelevant to alternate mode
  assert.equal(serverTeam(m, 'alternate'), 'b', 'winner of the point does not matter in alternate mode')
  m = tapLeft(m)                        // total = 4
  assert.equal(serverTeam(m, 'alternate'), 'a', 'swapped back at 4 total points')
})

test('undo restores the previous server in winner mode', () => {
  let m = tapLeft(fresh())              // A serves next
  m = tapRight(m)                       // B serves next
  assert.equal(servingSide(m, 'winner'), 'right')
  m = applyUndo(m, 1, 0, R, 'a')        // back to after the first point (A scored)
  assert.equal(servingSide(m, 'winner'), 'left', 'server rolled back to A')
})
