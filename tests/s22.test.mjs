// Session 22 audit (MC26): tiebreaks checked against an independent calculation,
// quarter-final numbering by bracket place, same-pool rotation, "why" wording.
import test from 'node:test'
import assert from 'node:assert/strict'
import { planDraw, koPlanOf, crossRank, cutReasons, KO_PLANS } from '../src/lib/koplan.ts'
import { rankByDiff, koShort, koOrder, koSlotLabel, groupRound, bracketCaption } from '../src/lib/pool.ts'
import { plannedTime, plannedCourt, slotOf } from '../src/lib/timetable.ts'

const row = (id, pool, won, diff, pf, name = id) => ({ team: { id, pool, name }, won, diff, pf, played: 4 })

// ---- independent ranking: wins, then point difference, then points scored
function tablesFrom(teams, games) {
  const T = new Map(teams.map(t => [t.id, { team: t, won: 0, diff: 0, pf: 0, played: 0 }]))
  for (const [a, b, sa, sb] of games) {
    const A = T.get(a), B = T.get(b)
    A.played++; B.played++; A.pf += sa; B.pf += sb; A.diff += sa - sb; B.diff += sb - sa
    ;(sa > sb ? A : B).won++
  }
  const out = {}
  for (const r of T.values()) (out[r.team.pool] ??= []).push(r)
  return out
}
const T3 = pool => [1, 2, 3].map(i => ({ id: `${pool}${i}`, pool, name: `${pool}${i}` }))

test('pool ranking: equal wins -> point difference decides', () => {
  // A1 and A2 both win 3 of 4; A1 +20, A2 +11
  const g = [['A1', 'A2', 15, 10], ['A2', 'A1', 15, 13], ['A1', 'A3', 15, 5], ['A3', 'A1', 4, 15], ['A2', 'A3', 15, 9], ['A3', 'A2', 12, 15]]
  const t = tablesFrom(T3('A'), g).A
  const r = rankByDiff(t, [], false)
  assert.deepEqual(r.map(x => [x.team.id, x.won, x.diff, x.pf]), [['A1', 3, 24, 58], ['A2', 3, 6, 55], ['A3', 0, -30, 30]])
})

test('pool ranking: equal wins and equal point difference -> points scored decides', () => {
  // A1 and A2: 2 wins each, both +0 ... A1 scored more
  const r = rankByDiff([row('A2', 'A', 2, 3, 50), row('A1', 'A', 2, 3, 54), row('A3', 'A', 2, -6, 40)], [], false)
  assert.deepEqual(r.map(x => x.team.id), ['A1', 'A2', 'A3'])
  assert.equal(r[0].tieGroup, null)
})

test('pool ranking: three teams level on wins (2-2-2) are split by point difference, then points', () => {
  // each pair splits its two games
  const g = [['A1', 'A2', 15, 8], ['A2', 'A1', 15, 13], ['A1', 'A3', 15, 14], ['A3', 'A1', 15, 9], ['A2', 'A3', 15, 12], ['A3', 'A2', 15, 11]]
  const r = rankByDiff(tablesFrom(T3('A'), g).A, [], false)
  // A1: +7-2+1-6 = 0, pf 52 ; A2: -7+2+3-4 = -6, pf 49 ; A3: -1+6-3+4 = +6, pf 56
  assert.deepEqual(r.map(x => [x.team.id, x.won, x.diff, x.pf]), [['A3', 2, 6, 56], ['A1', 2, 0, 52], ['A2', 2, -6, 49]])
})

test('fully level teams: same order on every screen (by name) and flagged for a coin toss', () => {
  const a = rankByDiff([row('x9', 'A', 2, 0, 50, 'Zed'), row('x1', 'A', 2, 0, 50, 'Amy')], [], false)
  const b = rankByDiff([row('x1', 'A', 2, 0, 50, 'Amy'), row('x9', 'A', 2, 0, 50, 'Zed')], [], false)
  assert.deepEqual(a.map(x => x.team.name), ['Amy', 'Zed'])
  assert.deepEqual(b.map(x => x.team.name), ['Amy', 'Zed'])
  assert.ok(a[0].tieGroup != null && a[0].tieGroup === a[1].tieGroup)
})

const mdTables = runners => {
  const t = {}
  for (const p of 'ABCDE') t[p] = [row(`${p}1`, p, 4, 30, 60), runners[p], row(`${p}3`, p, 0, -40, 20)]
  return t
}

test('MD best runner-up 3 (last quarter-final place): wins first', () => {
  const pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 1, 20, 59), B: row('B2', 'B', 2, -9, 30), C: row('C2', 'C', 2, 1, 40), D: row('D2', 'D', 3, -1, 45), E: row('E2', 'E', 1, 25, 58) }))
  assert.deepEqual(pd.runners.ranked.map(r => r.team.id), ['D2', 'C2', 'B2', 'E2', 'A2'])
  // B2 (2 wins, -9) is in ahead of E2 (1 win, +25)
  assert.match(cutReasons(pd.runners.ranked, 3)[2], /R3 B2 is ahead of R4 E2 on wins \(2 v 1\), so R3 takes the last quarter-final place/)
})

test('MD best runner-up 3: equal wins -> point difference; equal difference -> points scored', () => {
  let pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 2, 5, 50), B: row('B2', 'B', 2, 2, 55), C: row('C2', 'C', 3, 1, 40), D: row('D2', 'D', 3, 9, 45), E: row('E2', 'E', 2, 1, 58) }))
  assert.deepEqual(pd.runners.ranked.map(r => r.team.id), ['D2', 'C2', 'A2', 'B2', 'E2'])
  assert.match(cutReasons(pd.runners.ranked, 3)[2], /same wins \(2\), better point difference \(\+5 v \+2\)/)
  pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 2, 5, 50), B: row('B2', 'B', 2, 5, 55), C: row('C2', 'C', 3, 1, 40), D: row('D2', 'D', 3, 9, 45), E: row('E2', 'E', 2, 1, 58) }))
  assert.deepEqual(pd.runners.ranked.map(r => r.team.id), ['D2', 'C2', 'B2', 'A2', 'E2'])
  assert.match(cutReasons(pd.runners.ranked, 3)[2], /same wins \(2\) and point difference \(\+5\), more points scored \(55 v 50\)/)
  // fully level at the cut: flagged, never silently decided
  pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 2, 5, 55), B: row('B2', 'B', 2, 5, 55), C: row('C2', 'C', 3, 1, 40), D: row('D2', 'D', 3, 9, 45), E: row('E2', 'E', 2, 1, 58) }))
  assert.equal(pd.runners.level[2], true)
  assert.match(cutReasons(pd.runners.ranked, 3)[2], /coin toss/)
})

test('MD: printed slots QF1 A1 v R3, QF2 D1 v E1, QF3 C1 v R1, QF4 B1 v R2 when nobody meets their own group', () => {
  const pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 1, 0, 1), B: row('B2', 'B', 3, 9, 50), C: row('C2', 'C', 1, 0, 0), D: row('D2', 'D', 3, 5, 50), E: row('E2', 'E', 3, 1, 50) }))
  assert.equal(pd.swapped, false)
  assert.deepEqual(pd.pairs, [['A1', 'E2'], ['D1', 'E1'], ['C1', 'B2'], ['B1', 'D2']])
})

test('MD: all three best runners-up drawn against their own group winner -> they move round (no single swap works)', () => {
  // R1 = C2, R2 = B2, R3 = A2 : printed plan would be A1 v A2, C1 v C2, B1 v B2
  const pd = planDraw(KO_PLANS.MCMD, mdTables({ A: row('A2', 'A', 2, 1, 50), B: row('B2', 'B', 2, 5, 50), C: row('C2', 'C', 2, 9, 50), D: row('D2', 'D', 0, 0, 0), E: row('E2', 'E', 0, -1, 0) }))
  assert.equal(pd.swapped, true)
  for (const [a, b] of pd.pairs) assert.notEqual(a[0], b[0], `${a} v ${b} are from the same group`)
  assert.deepEqual(new Set(pd.pairs.flat()), new Set(['A1', 'B1', 'C1', 'D1', 'E1', 'A2', 'B2', 'C2']))
})

test('MD + MX: 3000 random group stages each: same qualifiers as an independent calculation, never a same-group quarter-final', () => {
  let s = 12345
  const rnd = () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  for (const [code, pools, size, legs, nR] of [['MCMD', 'ABCDE', 3, 2, 3], ['MCXD', 'ABCDEF', 4, 1, 2]]) {
    for (let it = 0; it < 3000; it++) {
      const teams = [], games = []
      for (const p of pools) {
        const ids = Array.from({ length: size }, (_, i) => ({ id: `${p}${i}`, pool: p, name: `${p}${i}` }))
        teams.push(...ids)
        for (let l = 0; l < legs; l++) for (let i = 0; i < size; i++) for (let j = i + 1; j < size; j++) {
          const lose = it % 2 ? 12 + Math.floor(rnd() * 3) : Math.floor(rnd() * 15)
          games.push(rnd() < 0.5 ? [ids[i].id, ids[j].id, 15, lose] : [ids[i].id, ids[j].id, lose, 15])
        }
      }
      const raw = tablesFrom(teams, games)
      const cmp = (x, y) => y.won - x.won || y.diff - x.diff || y.pf - x.pf
      const tables = {}
      let level = false
      for (const p of pools) {
        tables[p] = rankByDiff(raw[p], [], false)
        const mine = raw[p].slice().sort(cmp)
        for (let i = 0; i < 2; i++) if (cmp(mine[i], mine[i + 1]) === 0) level = true
        if (!level) assert.deepEqual(tables[p].map(r => r.team.id), mine.map(r => r.team.id))
      }
      const pd = planDraw(KO_PLANS[code], tables)
      for (const [a, b] of pd.pairs) assert.notEqual(a[0], b[0], `${code} run ${it}: ${a} v ${b} same group`)
      const run = [...pools].map(p => raw[p].slice().sort(cmp)[1]).sort(cmp)
      if (level || cmp(run[nR - 1], run[nR]) === 0) continue
      const want = new Set([...[...pools].map(p => raw[p].slice().sort(cmp)[0].team.id), ...run.slice(0, nR).map(r => r.team.id)])
      assert.deepEqual(new Set(pd.pairs.flat()), want, `${code} run ${it}`)
      if (!pd.swapped) {
        const res = t => t[0] === 'R' ? run[Number(t[1]) - 1].team.id : raw[t[0]].slice().sort(cmp)[Number(t[1]) - 1].team.id
        assert.deepEqual(pd.pairs, KO_PLANS[code].pairs.map(([x, y]) => [res(x), res(y)]))
      }
    }
  }
})

// ---- quarter-final numbering follows the bracket place, not the play order
function koBundle(code, seqOf) {
  const keys = ['KO-8-0', 'KO-8-1', 'KO-8-2', 'KO-8-3', 'KO-4-0', 'KO-4-1', 'KO-3P', 'KO-2-0']
  const round = k => k.startsWith('KO-8') ? 'Quarter-final' : k.startsWith('KO-4') ? 'Semi-final' : k === 'KO-3P' ? 'Third place' : 'Final'
  const next = { 'KO-8-0': ['KO-4-0', 'a'], 'KO-8-1': ['KO-4-0', 'b'], 'KO-8-2': ['KO-4-1', 'a'], 'KO-8-3': ['KO-4-1', 'b'], 'KO-4-0': ['KO-2-0', 'a'], 'KO-4-1': ['KO-2-0', 'b'] }
  const ev = { id: 'ev', format: 'groups_ko', bracket_preview: true, advance_per_group: 2, final_best_of: 1,
    ko_court_plan: { 'KO-3P': 4, 'KO-2-0': 4, 'KO-4-0': 4, 'KO-4-1': 5, 'KO-8-0': 4, 'KO-8-1': 5, 'KO-8-2': 4, 'KO-8-3': 5 } }
  const matches = keys.map(k => ({ id: k, event_id: 'ev', bracket_key: k, round: round(k), sequence: seqOf[k], status: 'scheduled',
    team_a_id: null, team_b_id: null, score_a: 0, score_b: 0, court_id: null, home_court: null,
    next_match_id: next[k]?.[0] ?? null, next_slot: next[k]?.[1] ?? null,
    loser_match_id: k.startsWith('KO-4') ? 'KO-3P' : null, loser_slot: k === 'KO-4-0' ? 'a' : k === 'KO-4-1' ? 'b' : null }))
  // 12 printed group slots
  const groups = Array.from({ length: 12 }, (_, i) => ({ id: `g${i}`, event_id: 'ev', bracket_key: null, round: 'Group A · Round robin', sequence: i + 1, slot: i + 1, status: 'scheduled', team_a_id: 't1', team_b_id: 't2', score_a: 0, score_b: 0, court_id: null, home_court: 'c4' }))
  return { competition: { code }, events: [ev], courts: [4, 5, 6].map(n => ({ id: `c${n}`, number: n, label: `Court ${n}` })),
    teams: [{ id: 't1', event_id: 'ev', pool: 'A', name: 'T1' }, { id: 't2', event_id: 'ev', pool: 'A', name: 'T2' }], matches: [...groups, ...matches] }
}

test('MCXD as it is in the database (QF play order 37 = KO-8-1, 38 = KO-8-0): QF1 is still Group A winner v Best runner-up 2', () => {
  const b = koBundle('MCXD', { 'KO-8-1': 37, 'KO-8-0': 38, 'KO-8-2': 39, 'KO-8-3': 40, 'KO-4-0': 41, 'KO-4-1': 42, 'KO-3P': 43, 'KO-2-0': 44 })
  const m = k => b.matches.find(x => x.bracket_key === k)
  assert.equal(koShort(b, m('KO-8-0')), 'QF1')
  assert.equal(koShort(b, m('KO-8-1')), 'QF2')
  assert.equal(bracketCaption(b, m('KO-8-0')), 'QF1 · Group A winner v Best runner-up 2')
  assert.equal(bracketCaption(b, m('KO-8-1')), 'QF2 · Group D winner v Group E winner')
  assert.equal(bracketCaption(b, m('KO-8-2')), 'QF3 · Group C winner v Group F winner')
  assert.equal(bracketCaption(b, m('KO-8-3')), 'QF4 · Group B winner v Best runner-up 1')
  assert.equal(koSlotLabel(b, b.events[0], m('KO-4-0'), 'a'), 'Winner QF1')
  assert.equal(koSlotLabel(b, b.events[0], m('KO-4-0'), 'b'), 'Winner QF2')
  assert.equal(koSlotLabel(b, b.events[0], m('KO-2-0'), 'a'), 'Winner SF1')
  assert.equal(koSlotLabel(b, b.events[0], m('KO-3P'), 'b'), 'Loser SF2')
  assert.ok(koOrder(m('KO-8-0'), m('KO-8-1')) < 0)
})

test('MC26 timetable: lunch 12:30, play resumes 12:45; QF1 + QF2 together, then QF3 + QF4, SF1 + SF2 share a slot, 3rd place before the Final', () => {
  const b = koBundle('MCXD', { 'KO-8-1': 37, 'KO-8-0': 38, 'KO-8-2': 39, 'KO-8-3': 40, 'KO-4-0': 41, 'KO-4-1': 42, 'KO-3P': 43, 'KO-2-0': 44 })
  const m = k => b.matches.find(x => x.bracket_key === k)
  const g = n => b.matches.find(x => x.slot === n)
  assert.equal(plannedTime(b, g(1)), '9:30 am')
  assert.equal(plannedTime(b, g(12)), '12:15 pm')
  // slot 13 would be 12:30 = lunch: play resumes 12:45
  assert.deepEqual(['KO-8-0', 'KO-8-1'].map(k => plannedTime(b, m(k))), ['12:45 pm', '12:45 pm'])
  assert.equal(plannedTime(b, m('KO-8-2')), '1:00 pm')
  assert.equal(plannedTime(b, m('KO-8-3')), '1:00 pm')
  assert.equal(plannedTime(b, m('KO-4-0')), '1:15 pm')
  assert.equal(plannedTime(b, m('KO-4-1')), '1:15 pm')
  assert.equal(plannedTime(b, m('KO-3P')), '1:30 pm')
  assert.equal(plannedTime(b, m('KO-2-0')), '1:45 pm')
  assert.ok(slotOf(b, m('KO-3P')) < slotOf(b, m('KO-2-0')))
  assert.deepEqual(['KO-8-0', 'KO-8-1', 'KO-8-2', 'KO-8-3', 'KO-4-0', 'KO-4-1', 'KO-3P', 'KO-2-0'].map(k => plannedCourt(b, m(k))), [4, 5, 4, 5, 4, 5, 4, 4])
})

test('a group game is named by its teams\' group, even when the stored label is stale', () => {
  const b = { teams: [{ id: 'x', pool: 'F' }, { id: 'y', pool: 'F' }, { id: 'z', pool: 'D' }] }
  assert.equal(groupRound(b, { round: 'Group D · Round Robin', team_a_id: 'x', team_b_id: 'y', bracket_key: null }), 'Group F · Round robin')
  assert.equal(groupRound(b, { round: 'Group A · Leg 2', team_a_id: 'z', team_b_id: 'z', bracket_key: null }), 'Group D · Round robin')
  assert.equal(groupRound(b, { round: 'Quarter-final', team_a_id: 'x', team_b_id: 'y', bracket_key: 'KO-8-0' }), 'Quarter-final')
})

// ---- YC26 Total Champion: gold, then silver, then bronze, then 4th places
import { medalTable, needsFourth } from '../src/lib/medals.ts'
const cat = (code, first, second, third, fourth) => ({ code, name: code, done: true, logos: {}, podium: { first, second, third, fourth },
  churches: Object.fromEntries([first, second, third, fourth].filter(Boolean).map(n => [n, n])) })
const order = rows => rows.filter(r => r.gold + r.silver + r.bronze + r.fourth > 0).map(r => r.name)

test('Total Champion: more gold first', () => {
  const t = medalTable([cat('1', 'GMSJ', 'Mega', 'Permai', 'Kinrara'), cat('2', 'GMSJ', 'Mega', 'Permai', 'Kinrara'), cat('3', 'Mega', 'Permai', 'GMSJ', 'Kinrara')])
  assert.deepEqual(order(t), ['GMSJ', 'Mega', 'Permai', 'Kinrara'])
  assert.equal(needsFourth(t), false)
})

test('Total Champion: same gold -> silver decides; same gold and silver -> bronze decides', () => {
  let t = medalTable([cat('1', 'GMSJ', 'Mega', 'Permai', null), cat('2', 'Mega', 'Kinrara', 'Permai', null), cat('3', 'Permai', 'Mega', 'GMSJ', null)])
  // gold 1 each for GMSJ, Mega, Permai; silver: Mega 2, others 0; bronze: Permai 2, GMSJ 1
  assert.deepEqual(order(t), ['Mega', 'Permai', 'GMSJ', 'Kinrara'])
  t = medalTable([cat('1', 'GMSJ', 'Mega', 'Permai', null), cat('2', 'Mega', 'GMSJ', 'Mega', null)])
  // GMSJ 1-1-0, Mega 1-1-1
  assert.deepEqual(order(t), ['Mega', 'GMSJ', 'Permai'])
})

test('Total Champion: level on gold, silver and bronze -> 4th places decide, and only then is the 4th column needed', () => {
  const t = medalTable([cat('1', 'GMSJ', 'Mega', 'Permai', 'Mega'), cat('2', 'Mega', 'GMSJ', 'Kinrara', 'PJ State')])
  // GMSJ 1-1-0-0, Mega 1-1-0-1 -> Mega first on 4th places
  assert.deepEqual(order(t).slice(0, 2), ['Mega', 'GMSJ'])
  assert.equal(needsFourth(t), true)
  // completely level, 4th places too: stable alphabetical order
  const u = medalTable([cat('1', 'Permai', 'GMSJ', null, null), cat('2', 'GMSJ', 'Permai', null, null)])
  assert.deepEqual(order(u), ['GMSJ', 'Permai'])
})

test('Total Champion: every church is listed from the start, with 0 medals', () => {
  const b = { competition: { code: 'X', name: 'X' }, events: [], courts: [], matches: [], teams: [] }
  const t = medalTable([], [b])
  assert.ok(t.length >= 8)
  assert.ok(t.every(r => r.gold === 0 && r.silver === 0 && r.bronze === 0 && r.fourth === 0))
  assert.equal(needsFourth(t), false)
})

test('a pair with no church chosen must not appear as a "church" in the list before it wins anything', () => {
  const b = { competition: { code: 'X', name: 'X' }, events: [], courts: [], matches: [], teams: [{ id: 't', event_id: 'e', name: 'Oscar Lee | Isaac Leong', church: null }] }
  assert.ok(!medalTable([], [b]).some(r => /Oscar/.test(r.name)))
})
