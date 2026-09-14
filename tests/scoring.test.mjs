import test from 'node:test'
import assert from 'node:assert/strict'

// Mirror of src/lib/scoring.ts (kept in JS so the test runs with no build step).
const R = { target_score: 15, win_by: 2, cap: 17, switch_at: 8 }

const isGameOver = (a, b, r) => {
  const hi = Math.max(a, b), lo = Math.min(a, b)
  return (hi >= r.target_score && hi - lo >= r.win_by) || hi >= r.cap
}
const teamForSide = (m, side) => ((side === 'left') === m.a_on_left ? 'a' : 'b')
const other = t => (t === 'a' ? 'b' : 'a')

const withSwitchAndStatus = (m, score_a, score_b, r) => {
  const hi = Math.max(score_a, score_b)
  const doSwitch = r.switch_at > 0 && !m.sides_switched && hi >= r.switch_at
  return {
    a_on_left: doSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: doSwitch || m.sides_switched,
    status: isGameOver(score_a, score_b, r) ? 'awaiting_confirm' : 'live',
  }
}

const applyRallyPoint = (m, who, r) => {
  const score_a = m.score_a + (who === 'a' ? 1 : 0)
  const score_b = m.score_b + (who === 'b' ? 1 : 0)
  return { ...m, score_a, score_b, last_scorer: who, ...withSwitchAndStatus(m, score_a, score_b, r) }
}

// Real doubles side-out scoring ('alternate'/"Serve" mode). `winner` is
// whichever side won the rally — only a point if that side was serving.
const applySideOutPoint = (m, winner, r) => {
  const serving = m.serving_team ?? m.initial_server ?? 'a'
  const serverNo = m.server_no ?? 2   // first-service-of-the-game exception
  if (winner === serving) {
    const score_a = m.score_a + (winner === 'a' ? 1 : 0)
    const score_b = m.score_b + (winner === 'b' ? 1 : 0)
    return {
      ...m, score_a, score_b, serving_team: serving, server_no: serverNo,
      ...withSwitchAndStatus(m, score_a, score_b, r),
    }
  }
  if (serverNo === 1) return { ...m, serving_team: serving, server_no: 2 }
  return { ...m, serving_team: other(serving), server_no: 1 }
}

const applyPoint = (m, side, r) => {
  const who = teamForSide(m, side)
  return r.serve_mode === 'alternate' ? applySideOutPoint(m, who, r) : applyRallyPoint(m, who, r)
}

const applyUndo = (m, prevA, prevB, r, prev = {}) => {
  const hi = Math.max(prevA, prevB)
  const unSwitch = r.switch_at > 0 && m.sides_switched && hi < r.switch_at
  return {
    ...m, score_a: prevA, score_b: prevB,
    a_on_left: unSwitch ? !m.a_on_left : m.a_on_left,
    sides_switched: m.sides_switched && r.switch_at > 0 && hi >= r.switch_at,
    last_scorer: prev.last_scorer ?? null,
    serving_team: prev.serving_team ?? null,
    server_no: prev.server_no ?? null,
    status: 'live',
  }
}

const setFirstServer = (m, team) => ({ ...m, initial_server: team })

const serverTeam = (m, mode) => {
  if (mode === 'alternate') return m.serving_team ?? m.initial_server ?? 'a'
  return m.last_scorer ?? m.initial_server ?? 'a'
}
const servingSide = (m, mode) => ((serverTeam(m, mode) === 'a') === m.a_on_left ? 'left' : 'right')

const serverCourt = (m, mode) => {
  if (mode !== 'alternate') return null
  const team = serverTeam(m, mode)
  const score = team === 'a' ? m.score_a : m.score_b
  return score % 2 === 0 ? 'right' : 'left'
}

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

// ---------------------------------------------------- serve mode: winner

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

test('undo restores the previous server in winner mode', () => {
  let m = tapLeft(fresh())              // A serves next
  m = tapRight(m)                       // B serves next
  assert.equal(servingSide(m, 'winner'), 'right')
  m = applyUndo(m, 1, 0, R, { last_scorer: 'a' })   // back to after the first point (A scored)
  assert.equal(servingSide(m, 'winner'), 'left', 'server rolled back to A')
})

// ----------------------------------------- serve mode: real side-out rules

test('side-out: the very first service of the game only gets ONE server', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = fresh()                       // team A serves first by default, server_no defaults to 2
  assert.equal(serverTeam(m, 'alternate'), 'a')
  m = applyPoint(m, 'right', ALT)        // team B wins the rally (a fault for A)
  assert.deepEqual([m.score_a, m.score_b], [0, 0], 'no point — the receiving side never scores')
  assert.equal(m.serving_team, 'b', 'a single fault on the opening serve is already a side-out')
  assert.equal(m.server_no, 1)
})

test('side-out: every other service turn gets TWO servers before side-out', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = { ...fresh(), serving_team: 'a', server_no: 1 }   // team A's turn, first server up
  m = applyPoint(m, 'right', ALT)        // team B wins — 1st fault, partner's turn, still team A
  assert.equal(m.serving_team, 'a')
  assert.equal(m.server_no, 2)
  assert.deepEqual([m.score_a, m.score_b], [0, 0])

  m = applyPoint(m, 'right', ALT)        // team B wins again — 2nd fault, side-out to B
  assert.equal(m.serving_team, 'b')
  assert.equal(m.server_no, 1)
  assert.deepEqual([m.score_a, m.score_b], [0, 0], 'still no score — side-out scores nothing')
})

test('side-out: the serving team scores every rally it wins and keeps serving', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = { ...fresh(), serving_team: 'a', server_no: 1 }
  m = applyPoint(m, 'left', ALT)         // team A (serving) wins
  m = applyPoint(m, 'left', ALT)
  m = applyPoint(m, 'left', ALT)
  assert.deepEqual([m.score_a, m.score_b], [3, 0])
  assert.equal(m.serving_team, 'a', 'still serving — winning while serving never passes the serve')
  assert.equal(m.server_no, 1)
})

test('side-out: the receiving team never scores, no matter who the referee taps', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = { ...fresh(), serving_team: 'b', server_no: 2 }   // B serving, on their 2nd server
  m = applyPoint(m, 'left', ALT)         // team A (receiving) wins the rally
  assert.deepEqual([m.score_a, m.score_b], [0, 0], 'A won the rally but was not serving — no point')
  assert.equal(m.serving_team, 'a', 'side-out: B had already used both servers')
  assert.equal(m.server_no, 1)
})

test('side-out: referee picks who serves first, seeding the opening exception', () => {
  let m = setFirstServer(fresh(), 'b')
  assert.equal(serverTeam(m, 'alternate'), 'b')
  assert.equal(serverTeam(m, 'winner'), 'b', 'also seeds the display in winner mode')
})

test('side-out: undo restores the exact prior server state', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = { ...fresh(), serving_team: 'a', server_no: 1 }
  const beforeFault = { last_scorer: null, serving_team: 'a', server_no: 1 }
  m = applyPoint(m, 'right', ALT)        // fault — team A now on server 2
  assert.equal(m.server_no, 2)
  m = applyUndo(m, 0, 0, R, beforeFault)
  assert.equal(m.serving_team, 'a')
  assert.equal(m.server_no, 1, 'server count rolled back too, not just the score')
})

test('serverCourt: even server score -> right court, odd -> left court', () => {
  const ALT = { ...R, serve_mode: 'alternate' }
  let m = { ...fresh(), serving_team: 'a', server_no: 1 }
  assert.equal(serverCourt(m, 'alternate'), 'right', '0 is even -> right court')
  m = applyPoint(m, 'left', ALT)   // team A wins, now serving on 1-0
  assert.equal(serverCourt(m, 'alternate'), 'left', '1 is odd -> left court')
  m = applyPoint(m, 'left', ALT)   // team A wins again, 2-0
  assert.equal(serverCourt(m, 'alternate'), 'right', '2 is even -> right court again')
})

test('serverCourt: null in Winner mode — no service-court concept there', () => {
  const m = { ...fresh(), last_scorer: 'a' }
  assert.equal(serverCourt(m, 'winner'), null)
})
