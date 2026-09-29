import test from 'node:test'
import assert from 'node:assert/strict'
import { buildTieDraw, tieGames, tiesOf, tieStandings } from '../src/lib/multisport.ts'

const T = (id, name, pool, roster = 6) => ({ id, event_id: 'e', name, pool, roster })
const M = (id, tie, seq, a, b, sa, sb, status = 'finished', game = 'MD1') => ({
  id, event_id: 'e', tie_id: tie, sequence: seq, team_a_id: a, team_b_id: b,
  score_a: sa, score_b: sb, status, game_label: game,
})
const bundle = (teams, matches) => ({
  competition: { multi_sport: true }, events: [{ id: 'e' }], courts: [], teams, matches,
})

test('tie games: 6v6 = MD1 MD2 XD, any 4-player team = MD XD', () => {
  assert.deepEqual(tieGames({ roster: 6 }, { roster: 6 }), ['MD1', 'MD2', 'XD'])
  assert.deepEqual(tieGames({ roster: 6 }, { roster: 4 }), ['MD', 'XD'])
  assert.deepEqual(tieGames(null, null), ['MD1', 'MD2', 'XD'])
})

test('tie draw: 3 teams in one group = 3 ties, games share a tie key, courts stay in range', () => {
  const teams = [
    { name: 'A', pool: 'A', roster: 6 }, { name: 'B', pool: 'A', roster: 6 },
    { name: 'C', pool: 'A', roster: 4 },
  ]
  const d = buildTieDraw(teams, 2)
  assert.equal(new Set(d.map(x => x.tie)).size, 3)
  assert.equal(d.length, 3 + 2 + 2)                 // A-B: 3 games, A-C and B-C: 2 each
  assert.ok(d.every(x => x.courtIdx >= 0 && x.courtIdx < 2))
  assert.deepEqual(d.map(x => x.sequence), d.map((_, i) => i + 1))
  for (const tie of new Set(d.map(x => x.tie))) {
    const g = d.filter(x => x.tie === tie)
    assert.ok(g.every(x => x.aIdx === g[0].aIdx && x.bIdx === g[0].bIdx))
  }
})

test('tie draw: two groups never mix teams', () => {
  const teams = [
    { name: 'A1', pool: 'A', roster: 6 }, { name: 'A2', pool: 'A', roster: 6 },
    { name: 'B1', pool: 'B', roster: 6 }, { name: 'B2', pool: 'B', roster: 6 },
  ]
  for (const m of buildTieDraw(teams, 3))
    assert.equal(teams[m.aIdx].pool, teams[m.bIdx].pool)
})

test('points: +1 per game won, +1 sweep bonus once the tie is complete', () => {
  const teams = [T('x', 'X', 'A'), T('y', 'Y', 'A')]
  const ms = [
    M('1', 't', 1, 'x', 'y', 21, 10, 'finished', 'MD1'),
    M('2', 't', 2, 'x', 'y', 21, 15, 'finished', 'MD2'),
    M('3', 't', 3, 'x', 'y', 21, 5, 'finished', 'XD'),
  ]
  const rows = tieStandings(bundle(teams, ms), 'e').A
  assert.equal(rows[0].team.id, 'x')
  assert.equal(rows[0].pts, 4)                       // 3 games + sweep bonus
  assert.equal(rows[0].tieW, 1); assert.equal(rows[1].tieL, 1); assert.equal(rows[1].pts, 0)
})

test('points: split tie has no bonus; unfinished tie awards games but no tie result', () => {
  const teams = [T('x', 'X', 'A'), T('y', 'Y', 'A')]
  const split = [
    M('1', 't', 1, 'x', 'y', 21, 10), M('2', 't', 2, 'x', 'y', 12, 21), M('3', 't', 3, 'x', 'y', 21, 19),
  ]
  let r = tieStandings(bundle(teams, split), 'e').A
  assert.equal(r[0].pts, 2); assert.equal(r[1].pts, 1); assert.equal(r[0].bonus, 0)

  const open = [M('1', 't', 1, 'x', 'y', 21, 10), M('2', 't', 2, 'x', 'y', 3, 2, 'live')]
  r = tieStandings(bundle(teams, open), 'e').A
  assert.equal(r[0].pts, 1); assert.equal(r[0].ties, 0)
  assert.equal(tiesOf(bundle(teams, open), 'e')[0].done, false)
})

test('table order: points, then tie wins, then game diff', () => {
  const teams = [T('a', 'A', 'A'), T('b', 'B', 'A'), T('c', 'C', 'A')]
  const ms = [
    M('1', 't1', 1, 'a', 'b', 21, 5), M('2', 't1', 2, 'a', 'b', 21, 5),      // a beats b 2-0 (2-game tie, sweep)
    M('3', 't2', 3, 'b', 'c', 21, 5), M('4', 't2', 4, 'b', 'c', 21, 5),      // b beats c 2-0
  ]
  const order = tieStandings(bundle(teams, ms), 'e').A.map(r => r.team.id)
  assert.deepEqual(order, ['a', 'b', 'c'])
})
