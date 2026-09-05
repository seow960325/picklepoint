import test from 'node:test'
import assert from 'node:assert/strict'
import { roundRobinPairs, buildDraw, defaultSwitchAt, validateRules } from '../src/lib/draw.ts'

test('round robin: everyone plays everyone exactly once', () => {
  for (const n of [2, 3, 4, 5, 6, 7, 8, 12]) {
    const rounds = roundRobinPairs(n)
    const seen = new Set()
    let count = 0
    for (const r of rounds) {
      const inRound = new Set()
      for (const [a, b] of r) {
        const key = [a, b].sort((x, y) => x - y).join('-')
        assert.ok(!seen.has(key), `${n} teams: ${key} played twice`)
        seen.add(key); count++
        assert.ok(!inRound.has(a) && !inRound.has(b), `${n} teams: double-booked in a round`)
        inRound.add(a); inRound.add(b)
      }
    }
    assert.equal(count, (n * (n - 1)) / 2, `${n} teams: wrong fixture count`)
  }
})

test('a round never puts the same team on two courts', () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, pool: i < 6 ? 'A' : 'B' }))
  const draw = buildDraw(teams, 6)
  const byRound = new Map()
  for (const m of draw) {
    const set = byRound.get(m.round) ?? new Set()
    assert.ok(!set.has(m.aIdx) && !set.has(m.bIdx), `round ${m.round} double-books a team`)
    set.add(m.aIdx); set.add(m.bIdx)
    byRound.set(m.round, set)
  }
})

test('two pools of six produce 30 matches spread over 6 courts', () => {
  const teams = Array.from({ length: 12 }, (_, i) => ({ name: `T${i}`, pool: i < 6 ? 'A' : 'B' }))
  const draw = buildDraw(teams, 6)
  assert.equal(draw.length, 30)
  assert.deepEqual([...new Set(draw.map(m => m.courtIdx))].sort(), [0, 1, 2, 3, 4, 5])
  assert.deepEqual([...new Set(draw.map(m => m.sequence))].length, 30)
})

test('pool members never meet teams from another pool', () => {
  const teams = Array.from({ length: 10 }, (_, i) => ({ name: `T${i}`, pool: i < 5 ? 'A' : 'B' }))
  for (const m of buildDraw(teams, 4)) {
    assert.equal(teams[m.aIdx].pool, teams[m.bIdx].pool)
  }
})

test('odd pools drop the bye rather than scheduling it', () => {
  const teams = Array.from({ length: 5 }, (_, i) => ({ name: `T${i}`, pool: 'A' }))
  const draw = buildDraw(teams, 2)
  assert.equal(draw.length, 10)
  for (const m of draw) {
    assert.ok(m.aIdx >= 0 && m.bIdx >= 0, 'bye leaked into the schedule')
  }
})

test('switch-ends defaults follow the halfway rule', () => {
  assert.equal(defaultSwitchAt(11), 6)
  assert.equal(defaultSwitchAt(15), 8)
  assert.equal(defaultSwitchAt(21), 11)
})

test('rule validation catches an unreachable cap', () => {
  assert.equal(validateRules({ target_score: 15, win_by: 2, cap: 17, switch_at: 8 }), null)
  assert.ok(validateRules({ target_score: 15, win_by: 2, cap: 15, switch_at: 8 }))
  assert.ok(validateRules({ target_score: 15, win_by: 2, cap: 21, switch_at: 20 }))
  assert.ok(validateRules({ target_score: 0, win_by: 2, cap: 21, switch_at: 5 }))
})
