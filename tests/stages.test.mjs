// Quarter-final own rules (0042) and Derek's third tiebreak: points scored.
import test from 'node:test'
import assert from 'node:assert/strict'
import { rankByDiff } from '../src/lib/pool.ts'
import { crossRank } from '../src/lib/koplan.ts'
import { rulesOf } from '../src/lib/scoring.ts'

const row = (id, won, pf, pa, pool = 'A') => ({ team: { id, pool }, won, pf, pa, diff: pf - pa })

test('diff_only: level on wins and diff -> more points scored first, only then a coin toss', () => {
  const r = rankByDiff([row('B', 2, 30, 20), row('A', 2, 40, 30)], [], false)
  assert.deepEqual(r.map(x => x.team.id), ['A', 'B'])
  assert.equal(r[0].tieGroup, null)
  const t = rankByDiff([row('B', 2, 40, 30), row('A', 2, 40, 30)], [], false)
  assert.ok(t[0].tieGroup != null && t[0].tieGroup === t[1].tieGroup)
})

test('cross-pool runners-up: wins, diff, then points scored', () => {
  const { ranked, level } = crossRank([row('x', 1, 30, 25, 'A'), row('y', 1, 35, 30, 'B'), row('z', 1, 31, 26, 'C')])
  assert.deepEqual(ranked.map(r => r.team.id), ['y', 'z', 'x'])
  assert.deepEqual(level, [false, false, false])
  assert.deepEqual(crossRank([row('p', 1, 35, 30, 'A'), row('q', 1, 35, 30, 'B')]).level, [true, false])
})

const ev = { target_score: 15, win_by: 1, cap: 15, switch_at: 0, ko_target_score: 21, ko_win_by: 1, ko_cap: 21, ko_switch_at: 0, ko_from_sf: true, qf_target_score: 15, qf_win_by: 1, qf_cap: 15 }
test('rulesOf: groups 15, QF own rules, SF / 3rd / Final 21', () => {
  assert.equal(rulesOf(ev, { bracket_key: null }).target_score, 15)
  assert.equal(rulesOf(ev, { bracket_key: 'KO-8-0' }).target_score, 15)
  assert.equal(rulesOf({ ...ev, qf_target_score: 11, qf_cap: 13, qf_win_by: 2 }, { bracket_key: 'KO-8-2' }).cap, 13)
  for (const k of ['KO-4-0', 'KO-4-1', 'KO-3P', 'KO-2-0']) assert.equal(rulesOf(ev, { bracket_key: k }).target_score, 21)
})
