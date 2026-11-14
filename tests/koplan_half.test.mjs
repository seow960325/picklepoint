import test from 'node:test'
import assert from 'node:assert/strict'
import { planDraw, KO_PLANS } from '../src/lib/koplan.ts'

// MC26 Men's Doubles final group tables (pool, winner first, runner-up second)
const T = (id, pool, won, diff, pf) => ({ team: { id, pool }, won, diff, pf })
const tables = {
  A: [T('A1', 'A', 4, 35, 60), T('A2', 'A', 2, -4, 44)],
  B: [T('B1', 'B', 4, 36, 60), T('B2', 'B', 2, 17, 51)],
  C: [T('C1', 'C', 4, 30, 60), T('C2', 'C', 2, 6, 49)],
  D: [T('D1', 'D', 4, 19, 60), T('D2', 'D', 2, 7, 54)],
  E: [T('E1', 'E', 3, 4, 57), T('E2', 'E', 2, -3, 52)],
}
const poolOf = id => id[0]

test('MCMD (already played) is unchanged: same-pool swap only, QF2 B v Derek, QF3 C v David L', () => {
  const pd = planDraw(KO_PLANS.MCMD, tables)
  assert.deepEqual(pd.pairs, [['A1', 'E1'], ['B1', 'D2'], ['C1', 'B2'], ['D1', 'C2']])
  assert.equal(pd.clean, undefined)
})

test('avoidSameHalf: no group twice in a half, titles still follow their own teams', () => {
  const pd = planDraw({ ...KO_PLANS.MCMD, avoidSameHalf: true }, tables)
  assert.equal(pd.clean, true)
  const halves = [pd.pairs.slice(0, 2).flat(), pd.pairs.slice(2).flat()]
  for (const h of halves) assert.equal(new Set(h.map(poolOf)).size, 4)
  // every team once; runner-up titles unchanged (B2 is Best runner-up 1, D2 is 2, C2 is 3)
  assert.equal(new Set(pd.pairs.flat()).size, 8)
  assert.deepEqual(pd.runners.ranked.slice(0, 3).map(r => r.team.id), ['B2', 'D2', 'C2'])
})
