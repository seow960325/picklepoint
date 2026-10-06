// MCMD / MCXD rules (migration 0026 opt-ins): double round robin on a shared
// court queue, wins -> point difference -> head-to-head -> coin toss,
// 15-point sudden-death groups, 21-point sudden-death knockout, fixed
// A-v-H bracket visible before the groups finish.
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildPoolSchedule, poolDispatch, poolQueue, koSlotLabel, koShort, rankByDiff, shuffleMap, upNext,
} from '../src/lib/pool.ts'
import { buildBracketSkeleton, seedBracket, drawGroups } from '../src/lib/draw.ts'
import { rulesOf, isGameOver, applyPoint, applyUndo } from '../src/lib/scoring.ts'

const COUNTRIES = Array.from({ length: 32 }, (_, i) => `Team ${String(i + 1).padStart(2, '0')}`)

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32) }

const EV = {
  id: 'ev', competition_id: 'c', name: "Men's Doubles", format: 'groups_ko',
  target_score: 15, win_by: 1, cap: 15, switch_at: 0, sort_order: 0, serve_mode: 'winner',
  group_size: 4, advance_per_group: 1, third_place: true,
  legs: 2, tiebreak: 'diff', ko_target_score: 21, ko_win_by: 1, ko_cap: 21, ko_switch_at: 0,
  play_clock: true, court_dispatch: 'pool', bracket_preview: true,
}

/** A bundle shaped exactly like create_competition_v3 + demo.create leave it. */
function makeBundle(seed = 1) {
  const teams = drawGroups(COUNTRIES, 4, rng(seed))
  const fixtures = buildPoolSchedule(teams, 3, 2)
  const courts = [1, 2, 3].map(n => ({ id: `ct${n}`, number: n, label: `Court ${n}` }))
  const T = teams.map((t, i) => ({ id: `t${i}`, event_id: 'ev', name: t.name, pool: t.pool, player1: null, player2: null }))
  const blank = { score_a: 0, score_b: 0, a_on_left: true, sides_switched: false, winner_id: null,
    next_match_id: null, next_slot: null, started_at: null, finished_at: null, duration_seconds: null }
  const matches = fixtures.map((f, i) => ({
    ...blank, id: `g${i}`, event_id: 'ev', court_id: f.courtIdx >= 0 ? courts[f.courtIdx].id : null,
    round: f.label, sequence: f.sequence, team_a_id: T[f.aIdx].id, team_b_id: T[f.bIdx].id,
    status: 'scheduled', bracket_key: null, home_court: courts[f.homeCourt].id,
  }))
  const sk = buildBracketSkeleton(8, 3, fixtures.length + 1, true)
  const id = k => `k:${k}`
  for (const k of sk) matches.push({
    ...blank, id: id(k.key), event_id: 'ev', court_id: null, round: k.round, sequence: k.sequence,
    team_a_id: null, team_b_id: null, status: 'scheduled', bracket_key: k.key,
    next_match_id: k.nextKey ? id(k.nextKey) : null, next_slot: k.nextSlot,
    loser_match_id: k.loserNextKey ? id(k.loserNextKey) : null, loser_slot: k.loserNextSlot,
  })
  for (const c of courts) {
    const first = matches.filter(m => m.court_id === c.id).sort((a, b) => a.sequence - b.sequence)[0]
    if (first) first.status = 'live'
  }
  return { competition: { id: 'c', code: 'MCMD', name: 'x', venue: null, event_date: '', status: 'live' },
    events: [EV], courts, teams: T, matches }
}

// ----------------------------------------------------------------- schedule
test('double round robin: 8 groups x 12 = 96 games, every pair twice with ends swapped', () => {
  const b = makeBundle(7)
  const g = b.matches.filter(m => !m.bracket_key)
  assert.equal(g.length, 96)
  const pool = id => b.teams.find(t => t.id === id).pool
  const pairs = new Map()
  for (const m of g) {
    assert.equal(pool(m.team_a_id), pool(m.team_b_id), 'never mixes groups')
    const k = [m.team_a_id, m.team_b_id].sort().join('|')
    pairs.set(k, [...(pairs.get(k) ?? []), m])
  }
  assert.equal(pairs.size, 48)
  for (const ms of pairs.values()) {
    assert.equal(ms.length, 2)
    assert.equal(ms[0].team_a_id, ms[1].team_b_id, 'leg 2 swaps ends')
  }
  for (const t of b.teams) assert.equal(g.filter(m => m.team_a_id === t.id || m.team_b_id === t.id).length, 6)
})

test('play order: never back-to-back, second leg only after the first, even spacing', () => {
  for (const seed of [1, 2, 3, 4, 5]) {
    const b = makeBundle(seed)
    const g = b.matches.filter(m => !m.bracket_key).sort((x, y) => x.sequence - y.sequence)
    const slotOf = m => Math.floor((m.sequence - 1) / 3)
    for (const t of b.teams) {
      const mine = g.filter(m => m.team_a_id === t.id || m.team_b_id === t.id)
      const slots = mine.map(slotOf)
      for (let i = 1; i < slots.length; i++) {
        assert.ok(slots[i] - slots[i - 1] >= 3, `${t.name} rests under 2 games (seed ${seed})`)
        assert.ok(slots[i] - slots[i - 1] <= 7, `${t.name} waits too long: ${slots[i] - slots[i - 1]} (seed ${seed})`)
      }
      assert.ok(mine.slice(0, 3).every(m => m.round.endsWith('Leg 1')), 'first three games are leg 1')
    }
    // only the first game on each court starts live; the rest wait in the queue
    assert.equal(g.filter(m => m.status === 'live').length, 3)
    assert.equal(poolQueue(b, 'ev').length, 93)
  }
})

// ----------------------------------------------------------------- dispatch
function simulate(seed) {
  const R = rng(seed)
  const b = makeBundle(seed)
  const now = { t: 0 }
  const end = new Map()      // matchId -> finish time
  const start = new Map()
  const startLive = () => {
    for (const m of b.matches) if (m.status === 'live' && !start.has(m.id)) {
      start.set(m.id, now.t)
      end.set(m.id, now.t + 9 + R() * 7)       // 9-16 min a game
    }
  }
  startLive()
  let guard = 0
  while (b.matches.some(m => !m.bracket_key && m.status !== 'finished') && guard++ < 1000) {
    const live = b.matches.filter(m => m.status === 'live')
    // invariant: nobody on two courts at once
    const on = live.flatMap(m => [m.team_a_id, m.team_b_id])
    assert.equal(new Set(on).size, on.length, 'a team is on two courts')
    assert.ok(live.length > 0, 'courts stalled with games left')
    const m = live.sort((x, y) => end.get(x.id) - end.get(y.id))[0]
    now.t = end.get(m.id) + 1                    // 1 min changeover
    const aWins = R() < 0.5
    m.score_a = aWins ? 15 : Math.floor(R() * 15); m.score_b = aWins ? Math.floor(R() * 15) : 15
    m.status = 'finished'; m.winner_id = aWins ? m.team_a_id : m.team_b_id
    m.finished_at = new Date((now.t - 1) * 60000).toISOString()
    poolDispatch(b, 'ev', now.t * 60000)
    startLive()
  }
  return { b, start, end, total: now.t }
}

test('shared queue: all 96 games played, nobody on two courts, waits even', () => {
  const worst = []
  for (const seed of [11, 12, 13, 14, 15, 16, 17, 18]) {
    const { b, start, end, total } = simulate(seed)
    const g = b.matches.filter(m => !m.bracket_key)
    assert.ok(g.every(m => m.status === 'finished'))
    let maxWait = 0, minGap = Infinity
    for (const t of b.teams) {
      const mine = g.filter(m => m.team_a_id === t.id || m.team_b_id === t.id)
        .sort((x, y) => start.get(x.id) - start.get(y.id))
      for (let i = 1; i < mine.length; i++) {
        const wait = start.get(mine[i].id) - end.get(mine[i - 1].id)
        maxWait = Math.max(maxWait, wait); minGap = Math.min(minGap, wait)
      }
    }
    worst.push({ seed, hours: +(total / 60).toFixed(1), maxWait: Math.round(maxWait), minRest: Math.round(minGap) })
    assert.ok(minGap >= 10, `a team rested only ${Math.round(minGap)} min (seed ${seed})`)
    assert.ok(maxWait < 120, `a team waited ${Math.round(maxWait)} min (seed ${seed})`)
    // court movement: a team plays on one court, or moves once to a second
    for (const t of b.teams) {
      const mine = g.filter(m => m.team_a_id === t.id || m.team_b_id === t.id)
        .sort((x, y) => start.get(x.id) - start.get(y.id)).map(m => m.court_id)
      assert.ok(new Set(mine).size <= 2, `${t.name} used 3 courts`)
      assert.ok(mine.filter((c, i) => i && c !== mine[i - 1]).length <= 1, `${t.name} moved more than once`)
    }
    const oneCourt = b.teams.filter(t => new Set(g.filter(m => m.team_a_id === t.id || m.team_b_id === t.id).map(m => m.court_id)).size === 1).length
    assert.equal(oneCourt, 24, '6 of 8 groups never leave their court')
  }
  console.log('# group stage sims (min):', JSON.stringify(worst))
})

test('dispatch skips a match whose team is still on court, never steals a queued court', () => {
  const b = makeBundle(3)
  const [m1] = b.matches.filter(m => m.status === 'live')
  m1.status = 'finished'
  // put a busy team at the head of the queue
  const head = poolQueue(b, 'ev')[0]
  const busyTeam = b.matches.find(m => m.status === 'live').team_a_id
  head.team_a_id = busyTeam
  const placed = poolDispatch(b, 'ev')
  assert.equal(placed.length, 1)
  assert.notEqual(placed[0].id, head.id)
  assert.equal(placed[0].court_id, m1.court_id)
  assert.ok(upNext(b, 'ev', 3).some(x => x.m.id === head.id && x.waiting))
  // a court with a match already queued on it is left for confirm_match
  const b2 = makeBundle(4)
  const ko = b2.matches.find(m => m.bracket_key === 'KO-8-0')
  const [live] = b2.matches.filter(m => m.status === 'live')
  live.status = 'finished'
  ko.court_id = live.court_id; ko.team_a_id = 'x'; ko.team_b_id = 'y'
  assert.equal(poolDispatch(b2, 'ev').length, 0)
})

// ----------------------------------------------------------------- ranking
const row = (id, won, pf, pa) => ({ team: { id, name: id }, played: 6, won, lost: 6 - won, pf, pa, diff: pf - pa })
const game = (a, b, sa, sb) => ({ team_a_id: a, team_b_id: b, score_a: sa, score_b: sb })

test("David's example: level on wins -> bigger point difference goes through", () => {
  // A and B both 5-1 (they beat each other once). A wins big, B wins by 1.
  const done = [
    game('A', 'B', 15, 14), game('B', 'A', 15, 7),
    ...['C', 'D'].flatMap(o => [game('A', o, 15, 7), game(o, 'A', 7, 15)]),
    ...['C', 'D'].flatMap(o => [game('B', o, 15, 14), game(o, 'B', 14, 15)]),
    game('C', 'D', 15, 10), game('D', 'C', 15, 10),
  ]
  const tally = id => {
    let w = 0, pf = 0, pa = 0
    for (const g of done) {
      if (g.team_a_id === id) { pf += g.score_a; pa += g.score_b; if (g.score_a > g.score_b) w++ }
      if (g.team_b_id === id) { pf += g.score_b; pa += g.score_a; if (g.score_b > g.score_a) w++ }
    }
    return row(id, w, pf, pa)
  }
  const ranked = rankByDiff(['B', 'C', 'A', 'D'].map(tally), done)
  assert.deepEqual(ranked.map(r => r.team.id).slice(0, 2), ['A', 'B'])
  assert.equal(ranked[0].won, ranked[1].won)
  assert.ok(ranked[0].diff > ranked[1].diff)       // A +31, B -4
  assert.equal(ranked[0].tieGroup, null)
  assert.equal(ranked[1].tieGroup, null)
})

test('wins always beat point difference', () => {
  const ranked = rankByDiff([row('A', 4, 90, 40), row('B', 5, 80, 79)], [])
  assert.equal(ranked[0].team.id, 'B')
})

test('level on wins AND difference -> head-to-head wins decide', () => {
  const done = [game('A', 'B', 15, 13), game('B', 'A', 13, 15)]  // A won both meetings
  const ranked = rankByDiff([row('B', 4, 80, 70), row('A', 4, 80, 70)], done)
  assert.deepEqual(ranked.map(r => r.team.id), ['A', 'B'])
  assert.ok(ranked.every(r => r.tieGroup == null))
})

test('still level after head-to-head (1-1) -> flagged for a coin toss', () => {
  const done = [game('A', 'B', 15, 13), game('B', 'A', 15, 13)]
  const ranked = rankByDiff([row('A', 4, 80, 70), row('B', 4, 80, 70), row('C', 2, 60, 75)], done)
  assert.equal(ranked[0].tieGroup, ranked[1].tieGroup)
  assert.ok(ranked[0].tieGroup != null)
  assert.equal(ranked[2].tieGroup, null)
})

test('three-way tie: head-to-head mini-table, the leftover pair goes to a toss', () => {
  // A beat B and C twice each (4 head-to-head wins); B and C split 1-1
  const done = [
    game('A', 'B', 15, 10), game('B', 'A', 10, 15), game('A', 'C', 15, 10), game('C', 'A', 10, 15),
    game('B', 'C', 15, 10), game('C', 'B', 15, 10),
  ]
  const ranked = rankByDiff([row('C', 4, 85, 75), row('B', 4, 85, 75), row('A', 4, 85, 75)], done)
  assert.equal(ranked[0].team.id, 'A')                // 4 head-to-head wins
  assert.equal(ranked[0].tieGroup, null)
  assert.equal(ranked[1].tieGroup, ranked[2].tieGroup)  // B, C: 2 each -> coin
  assert.ok(ranked[1].tieGroup != null)
})

// ----------------------------------------------------------------- scoring
test('sudden death: groups to 15, knockout to 21, no win-by-2', () => {
  const g = rulesOf(EV, { bracket_key: null })
  const k = rulesOf(EV, { bracket_key: 'KO-8-0' })
  assert.deepEqual([g.target_score, g.win_by, g.cap, g.switch_at], [15, 1, 15, 0])
  assert.deepEqual([k.target_score, k.win_by, k.cap, k.switch_at], [21, 1, 21, 0])
  assert.equal(isGameOver(14, 14, g), false)
  assert.equal(isGameOver(15, 14, g), true)
  assert.equal(isGameOver(16, 14, g), true)
  assert.equal(isGameOver(20, 20, k), false)
  assert.equal(isGameOver(21, 20, k), true)
  assert.equal(isGameOver(15, 3, k), false, 'a knockout game does not end at 15')
})

test('events without knockout rules are untouched', () => {
  const plain = { ...EV, ko_target_score: null, target_score: 11, win_by: 2, cap: 15 }
  assert.deepEqual(rulesOf(plain, { bracket_key: 'KO-4-0' }), rulesOf(plain))
  assert.equal(rulesOf(plain, { bracket_key: 'KO-4-0' }).target_score, 11)
})

test('referee taps 15 by mistake -> REVIEW (undo) reopens the game', () => {
  const r = rulesOf(EV, { bracket_key: null })
  let m = { score_a: 14, score_b: 9, a_on_left: true, sides_switched: false, status: 'live' }
  const before = { ...m }
  m = applyPoint(m, 'left', r)
  assert.equal(m.status, 'awaiting_confirm')
  m = applyUndo(m, before.score_a, before.score_b, r, {})
  assert.equal(m.status, 'live')
  assert.deepEqual([m.score_a, m.score_b], [14, 9])
  m = applyPoint(m, 'right', r)
  assert.deepEqual([m.score_a, m.score_b, m.status], [14, 10, 'live'])
})

// ----------------------------------------------------------------- bracket
test('fixed bracket: preview labels match the draw that is written later', () => {
  const b = makeBundle(9)
  const ko = b.matches.filter(m => m.bracket_key).sort((x, y) => x.sequence - y.sequence)
  const qf = ko.filter(m => m.round === 'Quarter-final')
  assert.deepEqual(qf.map(m => [koSlotLabel(b, EV, m, 'a'), koSlotLabel(b, EV, m, 'b')]), [
    ['Group A winner', 'Group H winner'], ['Group D winner', 'Group E winner'],
    ['Group B winner', 'Group G winner'], ['Group C winner', 'Group F winner'],
  ])
  const sf = ko.filter(m => m.round === 'Semi-final')
  assert.deepEqual(sf.map(m => [koSlotLabel(b, EV, m, 'a'), koSlotLabel(b, EV, m, 'b')]),
    [['Winner QF1', 'Winner QF2'], ['Winner QF3', 'Winner QF4']])
  const fin = ko.find(m => m.round === 'Final'), third = ko.find(m => m.round === 'Third place')
  assert.deepEqual([koSlotLabel(b, EV, fin, 'a'), koSlotLabel(b, EV, fin, 'b')], ['Winner SF1', 'Winner SF2'])
  assert.deepEqual([koSlotLabel(b, EV, third, 'a'), koSlotLabel(b, EV, third, 'b')], ['Loser SF1', 'Loser SF2'])
  assert.equal(koShort(b, qf[2]), 'QF3')

  // the admin's LOCK button writes seedBracket(group winners in group order)
  const winners = 'ABCDEFGH'.split('').map(g => [b.teams.find(t => t.pool === g).id])
  const pairs = seedBracket(winners, 8)
  const poolOf = id => b.teams.find(t => t.id === id).pool
  assert.deepEqual(pairs.map(([a, z]) => `${poolOf(a)}v${poolOf(z)}`), ['AvH', 'DvE', 'BvG', 'CvF'])
})

// ----------------------------------------------------------------- groups
test('random group draw is a full permutation; 8 groups of exactly 4', () => {
  const ids = Array.from({ length: 32 }, (_, i) => `t${i}`)
  const map = shuffleMap(ids, rng(5))
  assert.deepEqual(map.map(x => x.slot), ids)
  assert.deepEqual(map.map(x => x.src).sort(), ids.slice().sort())
  const teams = drawGroups(COUNTRIES, 4, rng(2))
  const sizes = {}
  teams.forEach(t => { sizes[t.pool] = (sizes[t.pool] ?? 0) + 1 })
  assert.deepEqual(Object.keys(sizes).sort().join(''), 'ABCDEFGH')
  assert.ok(Object.values(sizes).every(n => n === 4))
})
