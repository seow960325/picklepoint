import test from 'node:test'
import assert from 'node:assert/strict'
import { buildDuelDraw, validateDuelSquads } from '../src/lib/draw.ts'

// ---- buildDuelDraw / validateDuelSquads: real code, direct import ----

test('duel draw: 4 teams per side makes one pod of 4 cross-games', () => {
  const teams = [
    { name: 'A', side: 'A' }, { name: 'B', side: 'A' },
    { name: 'C', side: 'B' }, { name: 'D', side: 'B' },
  ]
  const draw = buildDuelDraw(teams, 1)
  assert.equal(draw.length, 4)
  // every Side-A team meets every Side-B team exactly once
  const pairs = draw.map(m => [m.aIdx, m.bIdx].sort().join('-')).sort()
  assert.deepEqual(pairs, ['0-2', '0-3', '1-2', '1-3'])
  // nobody plays a teammate from their own side
  for (const m of draw) {
    assert.notEqual(teams[m.aIdx].side, teams[m.bIdx].side)
  }
})

test('duel draw: 8 per side makes 2 pods, spread across courts, no cross-pod pairing', () => {
  const teams = [
    ...['A1', 'A2', 'A3', 'A4'].map(name => ({ name, side: 'A' })),
    ...['B1', 'B2', 'B3', 'B4'].map(name => ({ name, side: 'B' })),
  ]
  const draw = buildDuelDraw(teams, 2)
  assert.equal(draw.length, 8, '2 pods x 4 games')
  assert.deepEqual([...new Set(draw.map(m => m.courtIdx))].sort(), [0, 1])
  assert.deepEqual([...new Set(draw.map(m => m.label))].sort(), ['Pod 1', 'Pod 2'])
  // pod 1 only uses teams 0,1 (A1,A2) vs 4,5 (B1,B2); pod 2 uses 2,3 vs 6,7
  for (const m of draw.filter(x => x.label === 'Pod 1')) {
    assert.ok([0, 1].includes(m.aIdx) && [4, 5].includes(m.bIdx))
  }
  for (const m of draw.filter(x => x.label === 'Pod 2')) {
    assert.ok([2, 3].includes(m.aIdx) && [6, 7].includes(m.bIdx))
  }
})

test('duel draw: more pods than courts queues extra pods on the same court', () => {
  const teams = [
    ...['A1', 'A2', 'A3', 'A4'].map(name => ({ name, side: 'A' })),
    ...['B1', 'B2', 'B3', 'B4'].map(name => ({ name, side: 'B' })),
  ]
  const draw = buildDuelDraw(teams, 1)   // only 1 court for 2 pods
  assert.deepEqual([...new Set(draw.map(m => m.courtIdx))], [0])
  assert.equal(draw.length, 8)
})

test('validateDuelSquads catches uneven and odd squads', () => {
  assert.equal(validateDuelSquads(6, 6), null)
  assert.ok(validateDuelSquads(6, 5))   // uneven
  assert.ok(validateDuelSquads(5, 5))   // odd
  assert.ok(validateDuelSquads(1, 1))   // too few
})

// ---- duelTally: mirrors src/lib/store.ts (which has relative imports
// node's --experimental-strip-types can't resolve without extensions,
// same reason tests/scoring.test.mjs mirrors scoring.ts instead of
// importing it) ----

function duelTally(matches, teams) {
  const sideOf = id => teams.find(t => t.id === id)?.side ?? null
  const done = matches.filter(m => m.status === 'finished')
  let sideAWins = 0, sideBWins = 0, sideAPoints = 0, sideBPoints = 0
  for (const m of done) {
    const aSide = sideOf(m.team_a_id), bSide = sideOf(m.team_b_id)
    const aScore = aSide === 'A' ? m.score_a : m.score_b
    const bScore = aSide === 'A' ? m.score_b : m.score_a
    sideAPoints += aScore; sideBPoints += bScore
    const winnerSide = m.winner_id === m.team_a_id ? aSide : bSide
    if (winnerSide === 'A') sideAWins++
    else if (winnerSide === 'B') sideBWins++
  }
  const leader = sideAWins === sideBWins
    ? (sideAPoints === sideBPoints ? 'tie' : (sideAPoints > sideBPoints ? 'A' : 'B'))
    : (sideAWins > sideBWins ? 'A' : 'B')
  return { sideAWins, sideBWins, sideAPoints, sideBPoints, gamesPlayed: done.length, gamesTotal: matches.length, leader }
}

const team = (id, side) => ({ id, side })
const game = (a, b, sa, sb, winner) =>
  ({ team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, winner_id: winner, status: 'finished' })

test('duel tally: counts games won per side, not points', () => {
  const teams = [team('A', 'A'), team('B', 'A'), team('C', 'B'), team('D', 'B')]
  const matches = [
    game('A', 'C', 15, 10, 'A'),   // side A wins (blowout)
    game('B', 'D', 8, 15, 'D'),    // side B wins (close)
    game('A', 'D', 15, 5, 'A'),    // side A wins
    game('B', 'C', 15, 3, 'B'),    // side A wins
  ]
  const t = duelTally(matches, teams)
  assert.equal(t.sideAWins, 3)
  assert.equal(t.sideBWins, 1)
  assert.equal(t.leader, 'A')
  assert.equal(t.gamesPlayed, 4)
})

test('duel tally: unfinished games are not counted', () => {
  const teams = [team('A', 'A'), team('C', 'B')]
  const matches = [
    game('A', 'C', 15, 10, 'A'),
    { team_a_id: 'A', team_b_id: 'C', score_a: 5, score_b: 3, winner_id: null, status: 'live' },
  ]
  const t = duelTally(matches, teams)
  assert.equal(t.gamesPlayed, 1)
  assert.equal(t.gamesTotal, 2)
})

test('duel tally: a tie in game-wins breaks on total points', () => {
  const teams = [team('A', 'A'), team('B', 'A'), team('C', 'B'), team('D', 'B')]
  const matches = [
    game('A', 'C', 15, 5, 'A'),    // A: +15/-5
    game('B', 'D', 5, 15, 'D'),    // B: +5/-15 -> side A total 20, side B total 20; 1-1 on wins
  ]
  const t = duelTally(matches, teams)
  assert.equal(t.sideAWins, 1)
  assert.equal(t.sideBWins, 1)
  assert.equal(t.sideAPoints, 20)
  assert.equal(t.sideBPoints, 20)
  assert.equal(t.leader, 'tie')
})
