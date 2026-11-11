// Group fixtures spread evenly over the courts, nobody on two courts at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { buildRestedDraw, buildGroupKoDraw } from '../src/lib/draw.ts'

const mk = sizes => sizes.flatMap((n, g) => [...Array(n).keys()].map(i => ({ name: `${'ABCDEFGH'[g]}${i + 1}`, pool: 'ABCDEFGH'[g] })))
const turns = d => {                      // each court plays its list in order: a game's turn = its place on its court
  const n = {}
  return [...d].sort((a, b) => a.sequence - b.sequence).map(m => ({ ...m, turn: (n[m.courtIdx] = (n[m.courtIdx] ?? 0) + 1) }))
}

for (const [label, sizes, courts, legs] of [
  ['8 teams 2x4, 3 courts, twice', [4, 4], 3, 2], ['8 teams 2x4, 2 courts', [4, 4], 2, 1], ['13 teams 3/3/3/4, 3 courts', [3, 3, 3, 4], 3, 1],
  ['13 teams, 4 courts', [3, 3, 3, 4], 4, 1], ['6 teams 2x3, 2 courts', [3, 3], 2, 1], ['4 teams, 3 courts, twice', [4], 3, 2], ['16 teams 4x4, 4 courts', [4, 4, 4, 4], 4, 1],
]) test(`buildRestedDraw ${label}`, () => {
  const teams = mk(sizes), d = buildRestedDraw(teams, courts, legs), t = turns(d)
  const want = sizes.reduce((s, n) => s + n * (n - 1) / 2, 0) * legs
  assert.equal(d.length, want)
  // every pair of a pool meets exactly `legs` times
  const met = {}
  for (const m of d) { const k = [m.aIdx, m.bIdx].sort((x, y) => x - y).join('-'); met[k] = (met[k] ?? 0) + 1; assert.equal(teams[m.aIdx].pool, teams[m.bIdx].pool) }
  assert.ok(Object.values(met).every(v => v === legs))
  // no team twice in the same turn
  const seen = new Set()
  for (const m of t) for (const x of [m.aIdx, m.bIdx]) { const k = `${x}@${m.turn}`; assert.ok(!seen.has(k), `team ${x} twice in turn ${m.turn}`); seen.add(k) }
  // courts that are used carry the same load (difference of one game at most)
  const load = Object.values(t.reduce((o, m) => ({ ...o, [m.courtIdx]: (o[m.courtIdx] ?? 0) + 1 }), {}))
  assert.ok(Math.max(...load) - Math.min(...load) <= 1, `loads ${load}`)
  // sequence is 1..n and second meetings come after all first meetings
  assert.deepEqual(d.map(m => m.sequence), d.map((_, i) => i + 1))
  if (legs === 2) { const firstSecond = d.findIndex((m, i) => d.slice(0, i).some(p => p.aIdx === m.bIdx && p.bIdx === m.aIdx)); assert.ok(firstSecond >= want / 2 - courts) }
})

test('2 courts, 8 teams: nobody plays two turns in a row', () => {
  const t = turns(buildRestedDraw(mk([4, 4]), 2))
  const by = {}
  for (const m of t) for (const x of [m.aIdx, m.bIdx]) (by[x] ||= []).push(m.turn)
  for (const x in by) { const s = by[x].sort((a, b) => a - b); for (let i = 1; i < s.length; i++) assert.ok(s[i] - s[i - 1] >= 2) }
})

test('the wizard uses it (16 teams, 4 courts: 6 games per court)', () => {
  let seed = 9; const rng = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff
  const d = buildGroupKoDraw([...Array(16).keys()].map(i => `T${i}`), 4, { rng })
  const load = [0, 0, 0, 0]; for (const m of d.groupMatches) load[m.courtIdx]++
  assert.deepEqual(load, [6, 6, 6, 6])
})
