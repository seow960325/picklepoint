// Christmas Outreach fundraiser (MCMD 14 teams / MCXD 24 teams): the printed
// schedule, the printed knockout draw, ranking and per-round scoring rules.
import test from 'node:test'
import assert from 'node:assert/strict'
import { MD, MX, build } from '../scripts/xmas-seed.mjs'
import { planDraw, koPlanOf, crossRank, slotName } from '../src/lib/koplan.ts'
import { rulesOf, isGameOver } from '../src/lib/scoring.ts'
import { rankByDiff, poolDispatch, koSlotLabel } from '../src/lib/pool.ts'
import { flowOf } from '../src/lib/flow.ts'

const names = n => Array.from({ length: n }, (_, i) => `T${i + 1}`)

for (const cfg of [MD, MX]) {
  test(`${cfg.code}: printed schedule is complete and fair`, () => {
    const { teams, games, bracket } = build(cfg, names(Object.values(cfg.pools).reduce((a, b) => a + b)))
    assert.equal(games.length, cfg === MD ? 30 : 36)
    assert.equal(games.length + bracket.length, cfg === MD ? 38 : 44)
    // every pair in a pool meets exactly `legs` times
    const meet = new Map()
    for (const g of games) {
      assert.equal(teams[g.a].pool, teams[g.b].pool)
      const k = [g.a, g.b].sort((x, y) => x - y).join('-')
      meet.set(k, (meet.get(k) ?? 0) + 1)
    }
    for (const [pool, n] of Object.entries(cfg.pools)) {
      const ids = teams.map((t, i) => i).filter(i => teams[i].pool === pool)
      for (let x = 0; x < ids.length; x++) for (let y = x + 1; y < ids.length; y++)
        assert.equal(meet.get(`${ids[x]}-${ids[y]}`), cfg.legs, `${pool} ${x + 1}v${y + 1}`)
      assert.equal(ids.length, n)
    }
    // one game per court per slot, nobody twice in a slot or in consecutive slots
    const slots = new Map()
    for (const g of games) (slots.get(g.slot) ?? slots.set(g.slot, []).get(g.slot)).push(g)
    for (const [s, gs] of slots) {
      assert.deepEqual(gs.map(g => g.court), cfg.courts.slice(0, gs.length))
      assert.ok(gs.length === 3 || (cfg === MD && gs.length === 2))
      const busy = gs.flatMap(g => [g.a, g.b])
      assert.equal(new Set(busy).size, gs.length * 2, `slot ${s}`)
      const next = (slots.get(s + 1) ?? []).flatMap(g => [g.a, g.b])
      assert.ok(!next.some(t => busy.includes(t)), `back-to-back after slot ${s}`)
    }
    // the knockout order: QF1-4, SF1, SF2, 3rd place, Final
    assert.deepEqual(bracket.map(b => b.key), ['KO-8-0', 'KO-8-1', 'KO-8-2', 'KO-8-3', 'KO-4-0', 'KO-4-1', 'KO-3P', 'KO-2-0'])
  })
}

test('MD slot 1 is A/B/C 1v2, slot 2 D/E 1v2 on Courts 1-2, slot 7 repeats slot 1 with ends swapped', () => {
  const { teams, games } = build(MD, names(15))
  const s1 = games.filter(g => g.slot === 1).map(g => `${teams[g.a].name}-${teams[g.b].name}`)
  assert.deepEqual(s1, ['T1-T2', 'T4-T5', 'T7-T8'])
  const s2 = games.filter(g => g.slot === 2)
  assert.deepEqual(s2.map(g => `${teams[g.a].name}-${teams[g.b].name}@${g.court}`), ['T10-T11@1', 'T13-T14@2'])
  // every team plays 4 games, never in two consecutive slots
  for (let t = 0; t < 15; t++) {
    const sl = games.filter(g => g.a === t || g.b === t).map(g => g.slot)
    assert.equal(sl.length, 4)
    for (let i = 1; i < sl.length; i++) assert.ok(sl[i] - sl[i - 1] >= 2)
  }
  const s7 = games.filter(g => g.slot === 7).map(g => `${teams[g.b].name}-${teams[g.a].name}`)
  assert.deepEqual(s7, s1)
  assert.equal(games.find(g => g.slot === 7).round, 'Group A · Leg 2')
})

// ---------------------------------------------------------------- draws
const row = (id, pool, won, diff) => ({ team: { id, pool }, won, diff })
const tablesOf = spec => Object.fromEntries(Object.entries(spec).map(([p, rows]) =>
  [p, rows.map(([id, w, d]) => row(id, p, w, d))]))

test('MD printed quarter-finals: 5 winners + 3 best runners-up, W1vR3 W4vW5 W3vR1 W2vR2', () => {
  const t = tablesOf({
    A: [['A1', 4, 30], ['A2', 2, 10], ['A3', 0, -40]],
    B: [['B1', 4, 25], ['B2', 2, 8], ['B3', 0, -33]],
    C: [['C1', 3, 20], ['C2', 2, 6], ['C3', 1, -26]],
    D: [['D1', 3, 15], ['D2', 2, 4], ['D3', 1, -19]],
    E: [['E1', 3, 10], ['E2', 1, 2], ['E3', 2, -12]],
  })
  const pd = planDraw(koPlanOf('MCMD'), t)
  // W: A1 B1 C1 D1 E1; R: A2(2,10) B2(2,8) C2(2,6) | D2 E2 out
  // unswapped W2 B1 would meet R2 B2 (same pool) -> R1/R2 swap fixes it
  assert.deepEqual(pd.pairs, [['A1', 'C2'], ['D1', 'E1'], ['C1', 'B2'], ['B1', 'A2']])
  assert.equal(pd.swapped, true)
  assert.equal(koPlanOf('PBMD'), null)
})

test('MD: no same-pool quarter-final needs no swap', () => {
  const t = tablesOf({
    A: [['A1', 4, 30], ['A2', 2, 1]], B: [['B1', 4, 25], ['B2', 2, 10]], C: [['C1', 3, 20], ['C2', 2, 6]],
    D: [['D1', 3, 15], ['D2', 2, 8]], E: [['E1', 3, 10], ['E2', 1, 2]],
  })
  // R: B2(2,10) D2(2,8) C2(2,6); W1 A1 v R3 C2, W4 D1 v W5 E1, W3 C1 v R1 B2, W2 B1 v R2 D2
  const pd = planDraw(koPlanOf('MCMD'), t)
  assert.deepEqual(pd.pairs, [['A1', 'C2'], ['D1', 'E1'], ['C1', 'B2'], ['B1', 'D2']])
  assert.equal(pd.swapped, false)
})

test('MX: winners ranked across pools, best 2 runners-up, W1vR2 W4vW5 W3vW6 W2vR1', () => {
  const t = tablesOf({
    A: [['A1', 3, 30], ['A2', 2, 15]], B: [['B1', 3, 20], ['B2', 2, 5]],
    C: [['C1', 2, 10], ['C2', 2, 12]], D: [['D1', 3, 25], ['D2', 1, 3]],
    E: [['E1', 2, 8], ['E2', 1, -2]], F: [['F1', 2, 4], ['F2', 2, 1]],
  })
  const pd = planDraw(koPlanOf('MCXD'), t)
  // W: A1(3,30) D1(3,25) B1(3,20) C1(2,10) E1(2,8) F1(2,4); R: A2(2,15) C2(2,12) B2 F2 D2 E2
  assert.deepEqual(pd.winners.ranked.map(r => r.team.id), ['A1', 'D1', 'B1', 'C1', 'E1', 'F1'])
  assert.deepEqual(pd.runners.ranked.slice(0, 2).map(r => r.team.id), ['A2', 'C2'])
  // W1 A1 v R2 C2 · W4 C1 v W5 E1 · W3 B1 v W6 F1 · W2 D1 v R1 A2
  assert.deepEqual(pd.pairs, [['A1', 'C2'], ['C1', 'E1'], ['B1', 'F1'], ['D1', 'A2']])
  assert.equal(pd.swapped, false)
})

test('MX: a winner drawn against its own runner-up swaps R1 and R2', () => {
  const t = tablesOf({
    A: [['A1', 3, 30], ['A2', 2, 20]], B: [['B1', 3, 20], ['B2', 2, 15]],
    C: [['C1', 2, 10], ['C2', 0, -9]], D: [['D1', 2, 9], ['D2', 1, 3]],
    E: [['E1', 2, 8], ['E2', 1, -2]], F: [['F1', 2, 4], ['F2', 1, 1]],
  })
  // W1 A1, W2 B1; R1 A2, R2 B2 -> W2 B1 v R1 A2 fine, but W1 A1 v R2 B2 fine too: no swap
  let pd = planDraw(koPlanOf('MCXD'), t)
  assert.equal(pd.swapped, false)
  // make R2 come from pool A: W1 A1 v R2 A2 -> swap
  t.B[1].diff = 25
  pd = planDraw(koPlanOf('MCXD'), t)
  assert.deepEqual(pd.runners.ranked.slice(0, 2).map(r => r.team.id), ['B2', 'A2'])
  assert.equal(pd.swapped, true)
  assert.deepEqual(pd.pairs[0], ['A1', 'B2'])
  assert.deepEqual(pd.pairs[3], ['B1', 'A2'])
})

test('cross-pool ties are flagged and an organiser order (coin toss) wins', () => {
  const rows = [row('x', 'A', 2, 5), row('y', 'B', 2, 5), row('z', 'C', 1, 0)]
  const r = crossRank(rows)
  assert.deepEqual(r.level, [true, false, false])
  assert.deepEqual(crossRank(rows, ['y', 'x', 'z']).ranked.map(q => q.team.id), ['y', 'x', 'z'])
})

test('tiebreak diff_only: no head-to-head, level teams share a coin-toss group', () => {
  const T = id => ({ id, pool: 'A' })
  const rows = [{ team: T('p'), won: 2, diff: 4 }, { team: T('q'), won: 2, diff: 4 }]
  const done = [{ team_a_id: 'q', team_b_id: 'p', score_a: 15, score_b: 10 }]
  assert.deepEqual(rankByDiff(rows, done).map(r => r.team.id), ['q', 'p'])         // h2h
  const o = rankByDiff(rows, done, false)
  assert.equal(o[0].tieGroup, o[1].tieGroup)
  assert.notEqual(o[0].tieGroup, null)
})

test('ko_from_sf: QF to 15, SF / 3rd / Final to 21, groups to 15', () => {
  const ev = { target_score: 15, win_by: 1, cap: 15, switch_at: 0, serve_mode: 'winner',
    ko_target_score: 21, ko_win_by: 1, ko_cap: 21, ko_switch_at: 0, ko_from_sf: true }
  const at = key => rulesOf(ev, { bracket_key: key }).target_score
  assert.equal(at(null), 15)
  for (const k of ['KO-8-0', 'KO-8-3']) assert.equal(at(k), 15)
  for (const k of ['KO-4-0', 'KO-4-1', 'KO-3P', 'KO-2-0']) assert.equal(at(k), 21)
  const sf = rulesOf(ev, { bracket_key: 'KO-4-0' })
  assert.equal(isGameOver(21, 20, sf), true)       // sudden death at 20-20
  assert.equal(isGameOver(20, 20, sf), false)
  assert.equal(isGameOver(15, 14, rulesOf(ev, { bracket_key: 'KO-8-1' })), true)
  // without the flag every knockout game keeps the old behaviour (21)
  assert.equal(rulesOf({ ...ev, ko_from_sf: false }, { bracket_key: 'KO-8-0' }).target_score, 21)
})

// ---------------------------------------------------------------- bundle-level
function bundleOf(cfg, n) {
  const { teams, games, bracket } = build(cfg, names(n))
  const ev = { id: 'ev', competition_id: 'c', name: cfg.category, format: 'groups_ko', target_score: 15, win_by: 1, cap: 15,
    switch_at: 0, serve_mode: 'winner', group_size: 4, advance_per_group: 2, third_place: true, legs: cfg.legs,
    tiebreak: 'diff_only', court_dispatch: 'pool', pool_strict: true, bracket_preview: true }
  const courts = cfg.courts.map(k => ({ id: `ct${k}`, number: k, label: `Court ${k}` }))
  const T = teams.map((t, i) => ({ id: `t${i}`, event_id: 'ev', name: t.name, pool: t.pool }))
  const placed = new Set()
  const M = games.map(g => {
    const first = !placed.has(g.court); placed.add(g.court)
    return { id: `g${g.sequence}`, event_id: 'ev', sequence: g.sequence, round: g.round, bracket_key: null,
      team_a_id: `t${g.a}`, team_b_id: `t${g.b}`, court_id: first ? `ct${g.court}` : null, home_court: `ct${g.court}`, slot: g.slot,
      status: first ? 'live' : 'scheduled', score_a: 0, score_b: 0, finished_at: null }
  })
  const keyId = Object.fromEntries(bracket.map(b => [b.key, `k${b.key}`]))
  for (const b of bracket) M.push({ id: keyId[b.key], event_id: 'ev', sequence: b.sequence, round: b.round, bracket_key: b.key,
    team_a_id: null, team_b_id: null, court_id: null, status: 'scheduled', score_a: 0, score_b: 0,
    next_match_id: b.next_key ? keyId[b.next_key] : null, next_slot: b.next_slot,
    loser_match_id: b.loser_next_key ? keyId[b.loser_next_key] : null, loser_slot: b.loser_next_slot })
  return { competition: { id: 'c', code: cfg.code }, events: [ev], courts, teams: T, matches: M }
}

test('pool_strict + printed slots: courts keep printed order, a slot starts only after the previous one', () => {
  const b = bundleOf(MD, 15)
  const order = []
  const startedAt = new Map(), finishedAt = new Map()
  let clock = 0
  // finish ONE live game at a time, in random court order, so courts drift
  let seed = 3; const rnd = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (const m of b.matches) if (m.status === 'live') startedAt.set(m.sequence, 0)
  for (let step = 0; step < 200; step++) {
    const live = b.matches.filter(m => m.status === 'live' && !m.bracket_key)
    if (!live.length) break
    const m = live[Math.floor(rnd() * live.length)]
    m.status = 'finished'; m.score_a = 15; m.finished_at = new Date(++clock * 1e6).toISOString()
    finishedAt.set(m.sequence, clock); order.push(m.sequence)
    for (const x of poolDispatch(b, 'ev', clock * 1e6 + 1)) startedAt.set(x.sequence, clock)
  }
  assert.equal(order.length, 30)
  for (const ct of MD.courts) {
    const seqs = order.filter(s => b.matches.find(m => m.sequence === s).home_court === `ct${ct}`)
    assert.deepEqual(seqs, seqs.slice().sort((x, y) => x - y))
  }
  // a game of slot k never started before every game of slot k-1 had finished
  const g = b.matches.filter(m => !m.bracket_key)
  for (const m of g) for (const x of g) if (x.slot === m.slot - 1)
    assert.ok(startedAt.get(m.sequence) >= finishedAt.get(x.sequence), `slot ${m.slot} #${m.sequence} before #${x.sequence}`)

  // a court whose next game has a team still on court waits
  const c = bundleOf(MD, 15)
  for (const m of c.matches.filter(x => x.slot === 1)) m.status = 'finished'
  const next1 = c.matches.find(m => m.sequence === 4)      // slot 2, Court 1
  const other = c.matches.find(m => m.sequence === 5)      // slot 2, Court 2
  poolDispatch(c, 'ev', 1)
  assert.equal(next1.status, 'live')
  assert.equal(other.status, 'live')
  // Court 3 has nothing in slot 2: its slot-3 game waits for slot 2 to finish
  const c3 = c.matches.find(m => m.sequence === 8)         // slot 3, Court 3
  assert.equal(c3.status, 'scheduled')
  next1.status = 'finished'; poolDispatch(c, 'ev', 2)
  assert.equal(c3.status, 'scheduled')
  other.status = 'finished'; poolDispatch(c, 'ev', 3)
  assert.equal(c3.status, 'live')
})

test('bracket preview + flow chart show the printed draw before any result', () => {
  const md = bundleOf(MD, 15)
  const ev = md.events[0]
  const qf = key => md.matches.find(m => m.bracket_key === key)
  assert.equal(koSlotLabel(md, ev, qf('KO-8-0'), 'a'), 'Best group winner 1')
  assert.equal(koSlotLabel(md, ev, qf('KO-8-0'), 'b'), 'Best runner-up 3')
  assert.equal(koSlotLabel(md, ev, qf('KO-8-3'), 'b'), 'Best runner-up 2')
  assert.equal(koSlotLabel(md, ev, md.matches.find(m => m.bracket_key === 'KO-4-0'), 'a'), 'Winner QF1')
  const mx = bundleOf(MX, 24)
  assert.equal(koSlotLabel(mx, mx.events[0], mx.matches.find(m => m.bracket_key === 'KO-8-1'), 'b'), 'Best group winner 5')
  assert.equal(koSlotLabel(mx, mx.events[0], mx.matches.find(m => m.bracket_key === 'KO-8-3'), 'b'), 'Best runner-up 1')
  assert.equal(slotName('C2'), 'Group C runner-up')

  const helpers = {
    groupStandings: (b) => {
      const t = {}
      for (const x of b.teams) (t[x.pool] ||= []).push({ team: x, won: 0, diff: 0 })
      return t
    },
    groupStageComplete: () => false,
  }
  const f = flowOf(mx, helpers)
  const qfs = f.stages[0].games.map(g => [g.a.label, g.b.label])
  assert.deepEqual(qfs, [['Best group winner 1', 'Best runner-up 2'], ['Best group winner 4', 'Best group winner 5'], ['Best group winner 3', 'Best group winner 6'], ['Best group winner 2', 'Best runner-up 1']])
  const fm = flowOf(md, helpers)
  assert.deepEqual(fm.stages[0].games.map(g => [g.a.label, g.b.label]),
    [['Best group winner 1', 'Best runner-up 3'], ['Best group winner 4', 'Best group winner 5'], ['Best group winner 3', 'Best runner-up 1'], ['Best group winner 2', 'Best runner-up 2']])
})
