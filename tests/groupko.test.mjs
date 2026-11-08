import test from 'node:test'
import assert from 'node:assert/strict'
import {
  buildGroupKoDraw, buildBracketSkeleton, drawGroups, validateGroupKo,
  nextPowerOfTwo, koRoundName, seedOrder, bracketPositions, seedBracket, shuffled,
} from '../src/lib/draw.ts'

// deterministic rng so a failing case is reproducible
const lcg = (seed) => () => (seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296

const names = (n) => Array.from({ length: n }, (_, i) => `T${i + 1}`)

test('nextPowerOfTwo and round names', () => {
  assert.equal(nextPowerOfTwo(8), 8)
  assert.equal(nextPowerOfTwo(12), 16)
  assert.equal(nextPowerOfTwo(1), 1)
  assert.equal(koRoundName(2), 'Final')
  assert.equal(koRoundName(4), 'Semi-final')
  assert.equal(koRoundName(8), 'Quarter-final')
  assert.equal(koRoundName(16), 'Round of 16')
})

test('shuffled keeps every element exactly once', () => {
  const src = names(20)
  const out = shuffled(src, lcg(7))
  assert.equal(out.length, src.length)
  assert.deepEqual([...out].sort(), [...src].sort())
})

test('group draw is balanced and loses nobody', () => {
  for (const n of [8, 12, 16, 18, 24, 32]) {
    const teams = drawGroups(names(n), 4, lcg(n))
    assert.equal(teams.length, n)
    assert.deepEqual(teams.map(t => t.name).sort(), names(n).sort())
    const sizes = {}
    teams.forEach(t => { sizes[t.pool] = (sizes[t.pool] || 0) + 1 })
    const counts = Object.values(sizes)
    assert.ok(Math.max(...counts) - Math.min(...counts) <= 1,
      `${n} teams: group sizes ${counts} differ by more than one`)
    assert.equal(Object.keys(sizes).length, Math.ceil(n / 4))
  }
})

test('validateGroupKo rejects unplayable configurations', () => {
  assert.ok(validateGroupKo(16, 2, 1))                 // groups too small
  assert.ok(validateGroupKo(4, 4, 2))                  // only one group
  assert.ok(validateGroupKo(16, 4, 4))                 // everyone qualifies
  assert.ok(validateGroupKo(16, 4, 0))                 // nobody qualifies
  assert.equal(validateGroupKo(16, 4, 2), null)        // the standard shape
  assert.equal(validateGroupKo(24, 4, 2), null)
  assert.equal(validateGroupKo(9, 3, 1), null)
})

test('16 teams, groups of 4, top 2: the classic shape', () => {
  const d = buildGroupKoDraw(names(16), 4, { rng: lcg(1) })
  assert.equal(d.groupCount, 4)
  assert.equal(d.qualifiers, 8)
  assert.equal(d.bracketSize, 8)
  assert.equal(d.byes, 0)
  // 4 groups x C(4,2) = 24 group fixtures
  assert.equal(d.groupMatches.length, 24)
  // 4 QF + 2 SF + 1 F + 1 third place
  assert.equal(d.bracket.length, 8)
  const rounds = d.bracket.map(m => m.round)
  assert.equal(rounds.filter(r => r === 'Quarter-final').length, 4)
  assert.equal(rounds.filter(r => r === 'Semi-final').length, 2)
  assert.equal(rounds.filter(r => r === 'Final').length, 1)
  assert.equal(rounds.filter(r => r === 'Third place').length, 1)
})

test('bracket wiring: every winner has exactly one destination slot', () => {
  for (const size of [4, 8, 16, 32]) {
    const b = buildBracketSkeleton(size, 3, 1, true)
    const byKey = new Map(b.map(m => [m.key, m]))
    const filled = new Map()
    for (const m of b) {
      if (m.nextKey == null) continue
      assert.ok(byKey.has(m.nextKey), `${m.key} points at missing ${m.nextKey}`)
      const slot = `${m.nextKey}:${m.nextSlot}`
      assert.ok(!filled.has(slot), `${slot} fed by two matches`)
      filled.set(slot, m.key)
    }
    // every match except round one is fed by exactly two earlier matches
    const roundOne = size
    for (const m of b) {
      if (m.teamsInRound === roundOne || m.teamsInRound === 0) continue
      assert.ok(filled.has(`${m.key}:a`) && filled.has(`${m.key}:b`),
        `${m.key} is not fully fed`)
    }
    // exactly one final, and it terminates
    const finals = b.filter(m => m.round === 'Final')
    assert.equal(finals.length, 1)
    assert.equal(finals[0].nextKey, null)
  }
})

test('both semi-final losers feed the third-place playoff, in distinct slots', () => {
  const b = buildBracketSkeleton(8, 2, 1, true)
  const sf = b.filter(m => m.round === 'Semi-final')
  assert.equal(sf.length, 2)
  assert.deepEqual(sf.map(m => m.loserNextKey), ['KO-3P', 'KO-3P'])
  assert.deepEqual(sf.map(m => m.loserNextSlot).sort(), ['a', 'b'])
  // nobody else feeds it
  assert.equal(b.filter(m => m.loserNextKey != null).length, 2)
})

test('third-place playoff can be switched off', () => {
  const b = buildBracketSkeleton(8, 2, 1, false)
  assert.equal(b.filter(m => m.round === 'Third place').length, 0)
  assert.equal(b.filter(m => m.loserNextKey != null).length, 0)
})

test('sequences are unique and continue on from the group stage', () => {
  const d = buildGroupKoDraw(names(16), 4, { rng: lcg(3) })
  const seqs = [...d.groupMatches.map(m => m.sequence), ...d.bracket.map(m => m.sequence)]
  assert.equal(new Set(seqs).size, seqs.length, 'duplicate sequence numbers')
  assert.equal(Math.min(...seqs), 1)
  assert.equal(Math.max(...seqs), seqs.length)
})

test('an odd field pads the bracket with byes rather than breaking it', () => {
  const d = buildGroupKoDraw(names(24), 6, { rng: lcg(5) })
  assert.equal(d.groupCount, 6)
  assert.equal(d.qualifiers, 12)
  assert.equal(d.bracketSize, 16)
  assert.equal(d.byes, 4)

  const pairs = bracketPositions(seedOrder([
    ['A1', 'A2'], ['B1', 'B2'], ['C1', 'C2'],
    ['D1', 'D2'], ['E1', 'E2'], ['F1', 'F2'],
  ]), 16)
  assert.equal(pairs.length, 8)
  const present = pairs.flat().filter(Boolean)
  assert.equal(present.length, 12, 'lost or invented a qualifier')
  assert.equal(new Set(present).size, 12)
  // the four byes are matches with a single team in them
  assert.equal(pairs.filter(p => p[0] == null || p[1] == null).length, 4)
  // and the byes go to the top seeds, never to a runner-up
  for (const [a, b] of pairs) {
    if (b == null) assert.ok(String(a).endsWith('1'), `bye given to ${a}`)
  }
})

test('round one never repeats a group match', () => {
  for (const groups of [2, 3, 4, 5, 6, 8]) {
    const byGroup = Array.from({ length: groups }, (_, g) =>
      ['1', '2'].map(place => `${'ABCDEFGH'[g]}${place}`))
    const size = nextPowerOfTwo(groups * 2)
    const pairs = seedBracket(byGroup, size)
    for (const [a, b] of pairs) {
      if (a == null || b == null) continue
      assert.notEqual(a[0], b[0], `${groups} groups: ${a} meets ${b} again in round one`)
    }
    const present = pairs.flat().filter(Boolean)
    assert.equal(new Set(present).size, groups * 2, `${groups} groups: qualifier lost in seeding`)
  }
})

test('bracket geometry: the top two seeds can only meet in the final', async () => {
  const { standardSeedOrder } = await import('../src/lib/draw.ts')
  for (const size of [2, 4, 8, 16, 32]) {
    const order = standardSeedOrder(size)
    assert.equal(order.length, size)
    assert.deepEqual([...order].sort((a, b) => a - b),
      Array.from({ length: size }, (_, i) => i + 1), `size ${size}: seeds lost`)
    if (size < 4) continue
    const posOf = (seed) => order.indexOf(seed)
    // seed 1 in the first half, seed 2 in the second half
    assert.ok(posOf(1) < size / 2 && posOf(2) >= size / 2,
      `size ${size}: seeds 1 and 2 share a half`)
    // seeds 1 and 4 (and 2 and 3) can only meet in the semi-final at the earliest
    assert.notEqual(Math.floor(posOf(1) / 2), Math.floor(posOf(2) / 2))
  }
})

test('byes fall to the top seeds and never collide in the next round', () => {
  const seeds = Array.from({ length: 12 }, (_, i) => `S${i + 1}`)
  const pairs = bracketPositions(seeds, 16)
  const byeSeeds = pairs.filter(p => p[1] == null).map(p => p[0])
  assert.equal(byeSeeds.length, 4)
  assert.deepEqual([...byeSeeds].sort(), ['S1', 'S2', 'S3', 'S4'].sort())
  // the four bye winners must land in four DIFFERENT quarter-finals
  const qfOf = []
  pairs.forEach((p, i) => { if (p[1] == null) qfOf.push(Math.floor(i / 2)) })
  assert.equal(new Set(qfOf).size, 4, 'two bye seeds were drawn into the same quarter-final')
})

// ---- 6-team format: 2 groups of 3, all advance, group winners bye to SF
import { validateGroupKo as _v6, seedBracket as _s6, buildGroupKoDraw as _b6 } from '../src/lib/draw.ts'
test('six-team playoff: valid, seeds A1/B1 to semis, playoff = A3 v B2 and B3 v A2', () => {
  assert.equal(_v6(6, 3, 3), null)
  assert.notEqual(_v6(9, 3, 3), null)
  assert.deepEqual(_s6([['A1','A2','A3'],['B1','B2','B3']], 8),
    [['A1', null], ['B2', 'A3'], ['B1', null], ['A2', 'B3']])
  const d = _b6(['a','b','c','d','e','f'], 2, { groupSize: 3, advancePerGroup: 3 })
  assert.equal(d.groupMatches.length, 6)
  assert.equal(d.byes, 2)
  assert.equal(d.bracket.filter(m => m.round === 'Playoff').length, 4)
})

import { medalTable as _mt } from '../src/lib/medals.ts'
test('medal table: gold, then silver, then bronze', () => {
  const r = (first, second, third) => ({ code: 'X', name: 'X', done: true, podium: { first, second, third }, logos: {} })
  const t = _mt([r('Grace', 'Zion', 'Life'), r('Zion', 'Grace', null), r('Grace', 'Life', 'Zion'), r('Zion', 'Life', 'Grace')])
  assert.deepEqual(t.map(x => [x.name, x.gold, x.silver, x.bronze]),
    [['Grace', 2, 1, 1], ['Zion', 2, 1, 1], ['Life', 0, 2, 1]])
  const t2 = _mt([r('Zion', 'Grace', 'Life'), r('Grace', 'Zion', 'Life'), r('Zion', 'Life', 'Grace')])
  assert.equal(t2[0].name, 'Zion')   // 2 gold beats 1
})

import { buildGroupKoDraw as _bd, validateGroupKo as _vg } from '../src/lib/draw.ts'
import { flowOf as _fl } from '../src/lib/flow.ts'
// turn a draft into a bundle the way create_competition stores it
function _bundle(n, size, adv) {
  const names = Array.from({ length: n }, (_, i) => `T${i + 1}`)
  const d = _bd(names, 2, { groupSize: size, advancePerGroup: adv, rng: () => 0.5 })
  const teams = d.teams.map((t, i) => ({ id: t.name, event_id: 'e', name: t.name, pool: t.pool }))
  const keyId = k => 'ko:' + k
  const matches = d.groupMatches.map((m, i) => ({ id: 'g' + i, event_id: 'e', team_a_id: m.a ?? m.teamA ?? null, team_b_id: null, status: 'scheduled', sequence: i, score_a: 0, score_b: 0, bracket_key: null }))
    .concat(d.bracket.map(k => ({ id: keyId(k.key), event_id: 'e', round: k.round, sequence: k.sequence, bracket_key: k.key, team_a_id: null, team_b_id: null, status: 'scheduled', score_a: 0, score_b: 0,
      next_match_id: k.nextKey ? keyId(k.nextKey) : null, next_slot: k.nextSlot, loser_match_id: k.loserNextKey ? keyId(k.loserNextKey) : null, loser_slot: k.loserNextSlot })))
  const b = { events: [{ id: 'e', format: 'groups_ko', advance_per_group: adv }], teams, matches, courts: [] }
  const h = {
    groupStandings: () => { const o = {}; teams.forEach(t => (o[t.pool] ||= []).push({ team: t })); return o },
    groupStageComplete: () => false,
  }
  return { d, f: _fl(b, h) }
}
test('flow: 13 teams in 4 groups (4,3,3,3), winners to semis', () => {
  const { d, f } = _bundle(13, 4, 1)
  const sizes = Object.values(d.teams.reduce((o, t) => (o[t.pool] = (o[t.pool] ?? 0) + 1, o), {})).sort()
  assert.deepEqual(sizes, [3, 3, 3, 4])
  assert.equal(d.groupMatches.length, 6 + 3 * 3)
  assert.deepEqual(f.stages.map(s => s.title), ['Semi-finals', 'Medals'])
  assert.deepEqual(f.stages[0].games.map(g => [g.a.label, g.b.label]), [['A winner', 'D winner'], ['B winner', 'C winner']])
  assert.deepEqual(f.stages[1].games.map(g => [g.a.label, g.b.label]), [['Winner Semi 1', 'Winner Semi 2'], ['Loser Semi 1', 'Loser Semi 2']])
})
test('flow: 8 teams, 2 groups of 4, top 2: A1 v B2, B1 v A2', () => {
  const { f } = _bundle(8, 4, 2)
  assert.deepEqual(f.stages[0].games.map(g => [g.a.label, g.b.label]), [['A winner', 'B 2nd'], ['B winner', 'A 2nd']])
})
test('flow: 4 teams round robin -> Final 1v2, 3rd 3v4', () => {
  assert.equal(_vg(4, 4, 4), null)
  const { d, f } = _bundle(4, 4, 4)
  assert.equal(d.groupMatches.length, 6)
  assert.deepEqual(f.stages.map(s => s.title), ['Medals'])
  assert.deepEqual(f.stages[0].games.map(g => [g.title, g.a.label, g.b.label]),
    [['Final', '1st place', '2nd place'], ['3rd place', '3rd place', '4th place']])
})

import { drawGroups as _dg } from '../src/lib/draw.ts'
test('draw: same church never shares a group when groups allow it', () => {
  const names = ['Mega CMC 1','Mega CMC 2','Mega Suria 1','Mega Suria 2','PJ State CMC 1','PJ State CMC 2','PJ State CMC 3','PJ State CMC 4','GMSJ 1','GMSJ 2','BKCMC','Mega Subang CMC 1','Mega Subang CMC 2']
  for (let seed = 1; seed < 200; seed++) {
    let r = seed
    const t = _dg(names, 4, () => ((r = (r * 9301 + 49297) % 233280) / 233280))
    const seen = new Set()
    for (const x of t) { const k = x.name.replace(/ \d+$/, '') + '|' + x.pool; assert.ok(!seen.has(k), `seed ${seed}: ${k}`); seen.add(k) }
  }
})
