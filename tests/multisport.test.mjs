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

test('court groups: each game type stays on its own courts', () => {
  const teams = [
    { name: 'A', pool: 'A', roster: 6 }, { name: 'B', pool: 'A', roster: 6 },
    { name: 'C', pool: 'A', roster: 6 }, { name: 'D', pool: 'A', roster: 6 },
  ]
  // courts: 0,1 = MD1, 2 = MD2, 3 = XD
  const d = buildTieDraw(teams, ['MD1', 'MD1', 'MD2', 'XD'])
  for (const g of d) {
    const want = { MD1: [0, 1], MD2: [2], XD: [3] }[g.game]
    assert.ok(want.includes(g.courtIdx), `${g.game} on court ${g.courtIdx}`)
  }
  // both MD1 courts get used
  assert.deepEqual([...new Set(d.filter(g => g.game === 'MD1').map(g => g.courtIdx))].sort(), [0, 1])
})

test('court groups: a 4-player tie MD uses the MD1 courts; untagged courts fall back to all', () => {
  const teams = [{ name: 'A', pool: 'A', roster: 4 }, { name: 'B', pool: 'A', roster: 4 }]
  const d = buildTieDraw(teams, ['MD1', 'MD2', 'XD'])
  assert.equal(d.find(g => g.game === 'MD').courtIdx, 0)
  assert.equal(d.find(g => g.game === 'XD').courtIdx, 2)
  const any = buildTieDraw(teams, [null, null])
  assert.ok(any.every(g => g.courtIdx === 0 || g.courtIdx === 1))
})

// ------------------------------------------------------------- knockout (0025)
import { semiPlan, koGames, koState, finalsPlan, groupStageDone, allTies } from '../src/lib/multisport.ts'

const KM = (id, tie, seq, a, b, sa, sb, stage, game, set = null, status = 'finished') => ({
  id, event_id: 'e', tie_id: tie, sequence: seq, team_a_id: a, team_b_id: b,
  score_a: sa, score_b: sb, status, game_label: game, tie_stage: stage, set_no: set,
})

test('knockout ties never count in the group table', () => {
  const teams = [T('a', 'A', 'A'), T('b', 'B', 'A')]
  const b = bundle(teams, [
    M('g1', 't1', 1, 'a', 'b', 21, 10, 'finished', 'MD1'),
    KM('k1', 'k', 9, 'b', 'a', 21, 5, 'SF1', 'MD1'),
  ])
  const rows = tieStandings(b, 'e').A
  assert.equal(rows[0].team.id, 'a')
  assert.equal(rows[0].gw, 1)
  assert.equal(rows[1].gw, 0)
})

test('final discipline is best of 3: 2 games won decides it, tie needs 2 of 3 disciplines', () => {
  const teams = [T('a', 'A', 'A'), T('b', 'B', 'A')]
  const g = [
    KM('1', 'f', 1, 'a', 'b', 11, 5, 'F', 'MD1', 1), KM('2', 'f', 2, 'a', 'b', 11, 7, 'F', 'MD1', 2),
    KM('3', 'f', 3, 'a', 'b', 5, 11, 'F', 'MD2', 1), KM('4', 'f', 4, 'a', 'b', 11, 9, 'F', 'MD2', 2),
    KM('5', 'f', 5, 'a', 'b', 0, 0, 'F', 'MD2', 3, 'scheduled'),
    KM('6', 'f', 6, 'a', 'b', 0, 0, 'F', 'XD', 1, 'scheduled'),
  ]
  const [t] = tiesOf(bundle(teams, g), 'e')
  assert.equal(t.units.length, 3)
  assert.deepEqual(t.units.map(u => u.winner), ['a', null, null])
  assert.equal(t.winner, null)
  g[4].status = 'finished'; g[4].score_a = 11; g[4].score_b = 8
  const [t2] = tiesOf(bundle(teams, g), 'e')
  assert.equal(t2.aGames, 2)
  assert.equal(t2.winner, 'a')            // 2 of 3 disciplines, XD not needed
  assert.equal(t2.done, false)
})

test('2-game knockout tie at 1-1 goes to total points', () => {
  const teams = [T('a', 'A', 'A', 4), T('b', 'B', 'A', 4)]
  const [t] = tiesOf(bundle(teams, [
    KM('1', 's', 1, 'a', 'b', 21, 19, 'SF1', 'MD'),
    KM('2', 's', 2, 'a', 'b', 12, 21, 'SF1', 'XD'),
  ]), 'e')
  assert.equal(t.done, true)
  assert.equal(t.winner, 'b')             // 33 v 40
})

test('semis: two groups cross A1-B2 and B1-A2, ready only when groups finish', () => {
  const teams = [T('a1', 'A1', 'A'), T('a2', 'A2', 'A'), T('b1', 'B1', 'B'), T('b2', 'B2', 'B')]
  const ms = [
    M('1', 'x', 1, 'a1', 'a2', 21, 3), M('2', 'y', 2, 'b1', 'b2', 21, 3, 'live'),
  ]
  let p = semiPlan(bundle(teams, ms), 'e')
  assert.equal(p.supported, true)
  assert.equal(p.ready, false)
  ms[1].status = 'finished'
  p = semiPlan(bundle(teams, ms), 'e')
  assert.equal(p.ready, true)
  assert.deepEqual(p.sf.map(s => [s.a.team.id, s.b.team.id]), [['a1', 'b2'], ['b1', 'a2']])
  assert.deepEqual(p.sf.map(s => [s.a.seed, s.b.seed]), [['A1', 'B2'], ['B1', 'A2']])
  assert.equal(groupStageDone(bundle(teams, ms), 'e'), true)
})

test('knockout games land on their game-group courts; best of 3 keeps a discipline on one court', () => {
  const sb = {
    ...bundle([], []),
    courts: [
      { id: 'c1', number: 1, game_group: 'MD1' }, { id: 'c2', number: 2, game_group: 'MD2' },
      { id: 'c3', number: 3, game_group: 'XD' },
    ],
  }
  const A = { id: 'a', roster: 6 }, B = { id: 'b', roster: 6 }
  const sf = koGames(sb, 'SF1', A, B)
  assert.deepEqual(sf.map(g => [g.game, g.court]), [['MD1', 'c1'], ['MD2', 'c2'], ['XD', 'c3']])
  const f = koGames(sb, 'F', A, B, { bestOf3: true })
  assert.equal(f.length, 9)
  assert.ok(f.filter(g => g.game === 'MD2').every(g => g.court === 'c2'))
  assert.deepEqual(f.filter(g => g.game === 'XD').map(g => g.set), [1, 2, 3])
  assert.equal(f[0].round, 'Final · MD1 · G1')
  // 4-player team: MD uses the MD1 court
  const s4 = koGames(sb, 'SF2', A, { id: 'c', roster: 4 })
  assert.deepEqual(s4.map(g => [g.game, g.court]), [['MD', 'c1'], ['XD', 'c3']])
})

test('phase walks groups -> semis -> finals -> done with champion, runner-up, third', () => {
  const teams = [T('a', 'A', 'A'), T('b', 'B', 'A'), T('c', 'C', 'B'), T('d', 'D', 'B')]
  const ms = [M('g', 'g', 1, 'a', 'b', 21, 3)]
  assert.equal(koState(bundle(teams, ms)).phase, 'groups')
  ms.push(KM('s1', 'S1', 2, 'a', 'd', 21, 9, 'SF1', 'MD1'), KM('s2', 'S2', 3, 'c', 'b', 21, 9, 'SF2', 'MD1'))
  assert.equal(koState(bundle(teams, ms)).phase, 'semis')
  const fp = finalsPlan(bundle(teams, ms))
  assert.deepEqual(fp.final, ['a', 'c'])
  assert.deepEqual(fp.third, ['d', 'b'])
  ms.push(KM('t', 'T', 4, 'd', 'b', 21, 15, '3P', 'MD1'), KM('f', 'F', 5, 'a', 'c', 9, 11, 'F', 'MD1', 1, 'live'))
  assert.equal(koState(bundle(teams, ms)).phase, 'finals')
  ms[4].status = 'finished'
  ms.push(KM('f2', 'F', 6, 'a', 'c', 8, 11, 'F', 'MD1', 2))
  const k = koState(bundle(teams, ms))
  assert.equal(k.phase, 'done')
  assert.deepEqual([k.champion, k.runnerUp, k.thirdPlace], ['c', 'a', 'd'])
  assert.equal(allTies(bundle(teams, ms)).length, 5)
})
