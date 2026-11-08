import test from 'node:test'
import assert from 'node:assert/strict'
import {
  CB_DEFAULT, cbFresh, cbStateOf, cbScore, clockAt, cbView, fmtClock, toLeft,
  cbRun, cbStop, cbPoint, cbUndo, cbFoul, cbTimeout, cbEndTimeout, cbAdjust, cbEndHalf, cbNextHalf, cbFlip,
  cbExtraTime, cbRestart, cbGrantTimeout, cbTimeoutBack, cbStandings, buildCbDraw,
} from '../src/lib/captainball.ts'

const start = () => ({ st: cbFresh(CB_DEFAULT), aOnLeft: true })
const T0 = 1_000_000

test('fresh game: 2 x 10 min, ready, 0-0', () => {
  const p = start()
  assert.equal(p.st.ms, 600000); assert.equal(p.st.phase, 'ready')
  assert.deepEqual(cbScore(p.st), { a: 0, b: 0 })
})

test('clock runs, stops and resumes without drifting', () => {
  let p = cbRun(start(), T0)
  assert.equal(clockAt(p.st, T0 + 15000), 585000)
  p = cbStop(p, T0 + 15000)
  assert.equal(p.st.ms, 585000); assert.equal(p.st.at, null)
  assert.equal(clockAt(p.st, T0 + 99000), 585000)         // stopped = frozen
  p = cbRun(p, T0 + 99000)
  assert.equal(clockAt(p.st, T0 + 109000), 575000)
})

test('every action raises rev; no-ops return the same object', () => {
  const p = start()
  assert.equal(cbStop(p, T0), p)                            // nothing to stop
  assert.equal(cbUndo(p, T0), p)
  assert.equal(cbPoint('a', -1)(p, T0), p)                  // can't go below 0
  const q = cbPoint('a', 2)(p, T0)
  assert.equal(q.st.rev, p.st.rev + 1)
})

test('boy +1, girl +2, minus, undo', () => {
  let p = start()
  p = cbPoint('a', 1)(p, T0); p = cbPoint('a', 2)(p, T0); p = cbPoint('b', 2)(p, T0)
  assert.deepEqual(cbScore(p.st), { a: 3, b: 2 })
  p = cbPoint('a', -1)(p, T0)
  assert.deepEqual(cbScore(p.st), { a: 2, b: 2 })
  p = cbUndo(p, T0)                                          // undoes the -1
  assert.deepEqual(cbScore(p.st), { a: 3, b: 2 })
  p = cbUndo(p, T0)
  assert.deepEqual(cbScore(p.st), { a: 3, b: 0 })
})

test('team fouls count up and down, never below 0', () => {
  let p = start()
  p = cbFoul('a', 1)(p, T0); p = cbFoul('a', 1)(p, T0); p = cbFoul('b', -1)(p, T0)
  assert.deepEqual(p.st.f, { a: 2, b: 0 })
})

test('time-out: stops the clock, 60 s countdown, each team has its own count', () => {
  let p = cbRun(start(), T0)
  p = cbTimeout('a')(p, T0 + 5000)
  assert.equal(p.st.at, null); assert.equal(p.st.ms, 595000)
  assert.equal(cbView(p.st, T0 + 5000 + 20000).toMs, 40000)
  assert.equal(cbView(p.st, T0 + 5000 + 20000).toSide, 'a')
  assert.equal(cbView(p.st, T0 + 5000 + 61000).toMs, 0)
  assert.equal(toLeft(p.st, 'a'), 1); assert.equal(toLeft(p.st, 'b'), 2)
  p = cbTimeout('a')(p, T0 + 70000)
  assert.equal(toLeft(p.st, 'a'), 0)
  const q = cbTimeout('a')(p, T0 + 80000)                     // none left
  assert.equal(q, p)
  assert.equal(toLeft(cbGrantTimeout('a', 1)(p, T0).st, 'a'), 1)   // referee grants an extra one
  assert.equal(toLeft(cbTimeoutBack('a')(p, T0).st, 'a'), 1)       // pressed by mistake
})

test('different time-out counts per team (rules + extra for one team only)', () => {
  const r = { ...CB_DEFAULT, to_h1: 1, to_h2: 3 }
  let p = { st: cbFresh(r), aOnLeft: true }
  p = cbGrantTimeout('b', 1)(p, T0)
  assert.equal(toLeft(p.st, 'a'), 1); assert.equal(toLeft(p.st, 'b'), 2)
})

test('time-outs reset for the 2nd half', () => {
  let p = cbRun(start(), T0)
  p = cbTimeout('a')(p, T0 + 1000); p = cbTimeout('a')(p, T0 + 70000)
  assert.equal(toLeft(p.st, 'a'), 0)
  p = cbEndHalf(p, T0 + 80000); p = cbNextHalf(p, T0 + 90000)
  assert.equal(toLeft(p.st, 'a'), 2)
})

test('add time back: +/- on a running and a stopped clock, tracked, clamped', () => {
  let p = cbRun(start(), T0)
  p = cbAdjust(30000)(p, T0 + 10000)                         // 590 + 30 = 620
  assert.equal(clockAt(p.st, T0 + 10000), 620000)
  assert.equal(clockAt(p.st, T0 + 20000), 610000)            // still running
  p = cbStop(p, T0 + 20000)
  p = cbAdjust(-60000)(p, T0 + 20000)
  assert.equal(clockAt(p.st, T0 + 20000), 550000)
  assert.equal(p.st.adj, -30000)
  const z = cbAdjust(-9999999)(p, T0 + 20000)
  assert.equal(clockAt(z.st, T0 + 20000), 0)
})

test('time added after the clock hit 0:00 does not restart it by itself', () => {
  let p = cbRun(start(), T0)
  assert.equal(cbView(p.st, T0 + 600000).expired, true)
  p = cbAdjust(20000)(p, T0 + 605000)
  assert.equal(p.st.at, null); assert.equal(p.st.ms, 20000)
  assert.equal(cbView(p.st, T0 + 605000).expired, false)
})

test('end of half 1 -> 2 min rest -> half 2 with a full clock and ends kept until swapped', () => {
  let p = cbRun(start(), T0)
  p = cbPoint('a', 2)(p, T0 + 1000)
  p = cbEndHalf(p, T0 + 600000)
  assert.equal(p.st.phase, 'break')
  assert.equal(cbView(p.st, T0 + 600000 + 30000).brkMs, 90000)
  assert.equal(p.aOnLeft, true)
  p = cbNextHalf(p, T0 + 700000)
  assert.equal(p.st.half, 2); assert.equal(p.st.ms, 600000); assert.equal(p.st.phase, 'ready')
  assert.equal(p.aOnLeft, true)                               // ends only change when the referee swaps
  assert.equal(cbFlip(p, T0).aOnLeft, false)
  assert.deepEqual(cbScore(p.st), { a: 2, b: 0 })             // score carries over
  assert.equal(p.st.log[0].h, 1)
  assert.equal(cbPoint('b', 1)(p, T0).st.log[1].h, 2)
})

test('after the last half the game is over; level -> extra time', () => {
  let p = cbRun(start(), T0)
  p = cbEndHalf(p, T0); p = cbNextHalf(p, T0); p = cbRun(p, T0)
  p = cbEndHalf(p, T0 + 1)
  assert.equal(p.st.phase, 'over')
  p = cbExtraTime(p, T0)
  assert.equal(p.st.et, true); assert.equal(p.st.ms, 180000); assert.equal(p.st.phase, 'ready')
  assert.equal(cbView(p.st, T0).periodLabel, 'EXTRA TIME')
})

test('restart goes back to 0-0 and keeps counting rev up', () => {
  let p = cbPoint('a', 2)(cbRun(start(), T0), T0)
  const q = cbRestart(CB_DEFAULT)(p, T0)
  assert.deepEqual(cbScore(q.st), { a: 0, b: 0 }); assert.ok(q.st.rev > p.st.rev); assert.equal(q.st.phase, 'ready')
})

test('a match never started (or admin-reset) reads as a fresh game with the event rules', () => {
  const ev = { cb_rules: { half_min: 7, rest_min: 3 } }
  const st = cbStateOf({ cb: { rev: 9, half: 2 }, started_at: null }, ev)
  assert.equal(st.rev, 0); assert.equal(st.ms, 7 * 60000); assert.equal(st.r.rest_min, 3)
  const live = cbStateOf({ cb: { rev: 9, half: 2, ms: 1000, phase: 'play', at: null, r: { half_min: 7 } }, started_at: 'x' }, ev)
  assert.equal(live.rev, 9); assert.equal(live.half, 2); assert.equal(live.r.half_min, 7)
})

test('clock text', () => {
  assert.equal(fmtClock(600000), '10:00'); assert.equal(fmtClock(59000, false), '0:59')
  assert.equal(fmtClock(42700), '42.7'); assert.equal(fmtClock(61000), '1:01'); assert.equal(fmtClock(0), '0.0')
})

test('round robin: 6 teams = 15 games, nobody twice in a row, every pair once', () => {
  const names = ['A', 'B', 'C', 'D', 'E', 'F']
  const d = buildCbDraw(names.map(n => ({ name: n, pool: 'A' })), 1)
  assert.equal(d.length, 15)
  const pairs = new Set(d.map(f => [f.aIdx, f.bIdx].sort().join('-')))
  assert.equal(pairs.size, 15)
  assert.ok(d.every(f => f.courtIdx === 0 && f.game === 'CB'))
})

test('table: win 3 / draw 1, then point difference', () => {
  const T = (id) => ({ id, event_id: 'e', name: id, pool: 'A' })
  const M = (id, a, b, sa, sb, status = 'finished') => ({ id, event_id: 'e', team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, status })
  const b = { events: [{ id: 'e' }], teams: [T('x'), T('y'), T('z')], matches: [
    M(1, 'x', 'y', 10, 4), M(2, 'y', 'z', 6, 6), M(3, 'x', 'z', 5, 8), M(4, 'x', 'y', 0, 0, 'live')] }
  const r = cbStandings(b, 'e')
  assert.deepEqual(r.map(x => x.team.id), ['z', 'x', 'y'])
  const x = r.find(q => q.team.id === 'x'), y = r.find(q => q.team.id === 'y'), z = r.find(q => q.team.id === 'z')
  assert.deepEqual([x.pts, y.pts, z.pts], [3, 1, 4])
  assert.equal(x.diff, 3); assert.equal(x.p, 2)             // live game ignored
})

// ---- groups A/B -> playoff -> semis -> 3rd + final
import { cbKo as _cbKo, cbStandings as _cbSt } from '../src/lib/captainball.ts'
test('captain ball church format: stages follow the sheet', () => {
  const ev = { id: 'e', sport: 'captainball' }
  const mk = (n, pool) => ({ id: n, event_id: 'e', name: n, pool })
  const teams = [mk('A1','A'), mk('A2','A'), mk('A3','A'), mk('B1','B'), mk('B2','B'), mk('B3','B')]
  let seq = 0
  const g = (a, b, sa, sb, stage = null, status = 'finished') =>
    ({ id: `m${++seq}`, event_id: 'e', team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, status, tie_stage: stage, court_id: 'c', sequence: seq })
  const b = { events: [ev], teams, courts: [{ id: 'c', number: 1 }], matches: [
    g('A1','A2',10,5), g('A1','A3',8,2), g('A2','A3',6,4),     // A: A1 2-0, A2 1-1, A3 0-2
    g('B1','B2',3,9), g('B1','B3',7,4), g('B2','B3',5,1),      // B: B2 2-0, B1 1-1, B3 0-2
  ] }
  let k = _cbKo(b, ev)
  assert.equal(k.supported, true); assert.equal(k.groupsDone, true)
  assert.deepEqual(k.next.pairs.map(p => [p.stage, p.a.id, p.b.id]),
    [['P1', 'A3', 'B1'], ['P2', 'B3', 'A2']])   // A last v B 2nd place, B last v A 2nd place
  b.matches.push(g('A3','B1',2,5,'P1'), g('B3','A2',3,4,'P2'))
  k = _cbKo(b, ev)
  assert.deepEqual(k.next.pairs.map(p => [p.stage, p.a.id, p.b.id]),
    [['SF1', 'A1', 'B1'], ['SF2', 'B2', 'A2']])  // A1 v W(P1), B-winner v W(P2)
  b.matches.push(g('A1','B1',9,6,'SF1'), g('B2','A2',4,7,'SF2'))
  k = _cbKo(b, ev)
  assert.deepEqual(k.next.pairs.map(p => [p.stage, p.a.id, p.b.id]),
    [['3P', 'B1', 'B2'], ['F', 'A1', 'A2']])
  b.matches.push(g('B1','B2',5,3,'3P'), g('A1','A2',6,2,'F'))
  k = _cbKo(b, ev)
  assert.equal(k.podium.first.id, 'A1'); assert.equal(k.podium.second.id, 'A2'); assert.equal(k.podium.third.id, 'B1')
  assert.equal(_cbSt(b, 'e', 'A')[0].team.id, 'A1')   // knockout games never touch the group table
})

import { flowOf as _flowOf } from '../src/lib/flow.ts'
test('flow chart: captain ball fills in group places, playoff, semis, final', () => {
  const ev = { id: 'e', sport: 'captainball' }
  const mk = (n, pool) => ({ id: n, event_id: 'e', name: n, pool })
  const teams = [mk('A1','A'), mk('A2','A'), mk('A3','A'), mk('B1','B'), mk('B2','B'), mk('B3','B')]
  let seq = 0
  const g = (a, b, sa, sb, stage = null) =>
    ({ id: `m${++seq}`, event_id: 'e', team_a_id: a, team_b_id: b, score_a: sa, score_b: sb, status: 'finished', tie_stage: stage, court_id: 'c', sequence: seq })
  const b = { events: [ev], teams, courts: [{ id: 'c', number: 1 }], matches: [] }
  let f = _flowOf(b)
  assert.equal(f.games.P1.a.id, null)                       // nothing played: empty slots
  b.matches.push(g('A1','A2',10,5), g('A1','A3',8,2), g('A2','A3',6,4), g('B1','B2',3,9), g('B1','B3',7,4), g('B2','B3',5,1))
  f = _flowOf(b)
  assert.deepEqual([f.games.P1.a.id, f.games.P1.b.id, f.games.P2.a.id, f.games.P2.b.id], ['A3','B1','B3','A2'])
  assert.equal(f.games.SF1.a.id, 'A1'); assert.equal(f.games.SF1.b.id, null)
  b.matches.push(g('A3','B1',2,5,'P1'), g('B3','A2',3,4,'P2'), g('A1','B1',9,6,'SF1'), g('B2','A2',4,7,'SF2'))
  f = _flowOf(b)
  assert.deepEqual([f.games.F.a.id, f.games.F.b.id, f.games['3P'].a.id, f.games['3P'].b.id], ['A1','A2','B1','B2'])
  b.matches.push(g('A1','A2',6,2,'F'))
  assert.equal(_flowOf(b).champion, 'A1')
})
