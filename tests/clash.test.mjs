// Random groups that keep a player in both categories off two courts at once.
import test from 'node:test'
import assert from 'node:assert/strict'
import { smartDraw, playersOf, meetsOf, slotClock } from '../src/lib/clash.ts'

// printed Christmas Outreach timetables
const MD = { A: 'odd', B: 'odd', C: 'odd', D: 'even', E: 'even' }
const mdSeats = Object.entries(MD).flatMap(([pool, k]) => {
  const o = k === 'odd' ? 0 : 1
  return [[1, 3], [1, 5], [3, 5]].map((s, i) => ({ id: `md${pool}${i + 1}`, pool, slots: [...s, ...s.map(x => x + 6)].map(x => x + o) }))
})
const XD_SLOTS = ['B12 D13 E23', 'A24 C13 D24', 'B13 E14 F24', 'A14 C23 D23', 'B34 E34 F23', 'A12 D12 E12',
  'A34 C24 F14', 'B23 D14 E24', 'A23 B14 C14', 'E13 F12 F34', 'A13 B24 D34', 'C12 C34 F13']
const xdSeats = 'ABCDEF'.split('').flatMap(pool => [1, 2, 3, 4].map(n => ({
  id: `xd${pool}${n}`, pool,
  slots: XD_SLOTS.flatMap((row, s) => row.split(' ').some(g => g[0] === pool && g.slice(1).includes(String(n))) ? [s + 1] : []),
})))
const rngOf = seed => () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff

test('timetables: every team 4 (MD) / 3 (XD) group games', () => {
  assert.ok(mdSeats.every(s => s.slots.length === 4))
  assert.ok(xdSeats.every(s => s.slots.length === 3))
  assert.deepEqual(mdSeats[0].slots, [1, 3, 7, 9])
  assert.deepEqual(xdSeats.find(s => s.id === 'xdF3').slots, [5, 10, 12])
})

test('playersOf: registered names, else the team name split', () => {
  assert.deepEqual(playersOf({ name: 'x', player1: ' Siang ', player2: 'MARCUS' }), ['siang', 'marcus'])
  assert.deepEqual(playersOf({ name: 'Siang & Marcus' }), ['siang', 'marcus'])
  assert.deepEqual(playersOf({ name: 'Malaysia' }), [])
})

test('no player in both: plain random permutation', () => {
  const entries = mdSeats.map((s, i) => ({ id: s.id, name: `T${i}`, players: [`p${i}a`, `p${i}b`] }))
  const d = smartDraw(mdSeats, entries, [], rngOf(3))
  assert.equal(new Set(d.map.map(m => m.src)).size, 15)
  assert.equal(d.meets.length, 0)
})

test('10 men also play mixed: never two courts at once, for 40 different draws', () => {
  // mixed doubles is drawn already (fixed); 10 of its men are in men's doubles too
  const fixed = xdSeats.map((s, i) => ({ label: `XD T${i}`, pool: s.pool, players: [`m${i}`, `w${i}`], slots: s.slots }))
  const entries = mdSeats.map((s, i) => ({ id: s.id, name: `MD${i}`, players: i < 10 ? [`m${i * 2}`, `x${i}`] : [`y${i}`, `z${i}`] }))
  const seen = new Set()
  for (let seed = 1; seed <= 40; seed++) {
    const d = smartDraw(mdSeats, entries, fixed, rngOf(seed))
    assert.equal(d.clashes, 0, `seed ${seed}`)
    assert.equal(new Set(d.map.map(m => m.src)).size, 15)
    assert.equal(new Set(d.map.map(m => m.slot)).size, 15)
    seen.add(d.map.map(m => m.src).join())
  }
  assert.ok(seen.size > 30, 'still random')
})

test('the other way round: mixed drawn around a fixed men\'s draw, both players of a pair busy', () => {
  const fixed = mdSeats.map((s, i) => ({ label: `MD T${i}`, pool: s.pool, players: [`m${i}`, `n${i}`], slots: s.slots }))
  const entries = xdSeats.map((s, i) => ({ id: s.id, name: `XD${i}`, players: i < 15 ? [`m${i}`, `w${i}`] : [`q${i}`, `w${i}`] }))
  for (let seed = 1; seed <= 20; seed++) assert.equal(smartDraw(xdSeats, entries, fixed, rngOf(seed)).clashes, 0)
})

test('meetsOf reports the colliding slot', () => {
  const m = meetsOf([{ id: 's', pool: 'A', slots: [1, 3] }], [{ id: 'e', name: 'E', players: ['kai'] }], [0],
    [{ label: 'XD · K', pool: 'B', players: ['kai'], slots: [3, 4] }])
  assert.deepEqual(m[0].clash, [3]); assert.deepEqual(m[0].tight, [3])
})

test('slotClock', () => {
  assert.equal(slotClock('MCMD', 1), '9:30'); assert.equal(slotClock('mcxd', 12), '12:15'); assert.equal(slotClock('MCMD', 15), '1:00')
})

test('jointDraw: 12 men play both categories -> nobody on two courts at once, both draws complete', async () => {
  const { jointDraw } = await import('../src/lib/clash.ts')
  // men's teams 0-3 have both men in mixed, teams 4-7 one man each
  const md = { label: 'MD', seats: mdSeats, entries: mdSeats.map((s, i) => ({ id: s.id, name: `MD${i}`, players: [`m${i}`, `n${i}`] })) }
  const men = ['m0', 'n0', 'm1', 'n1', 'm2', 'n2', 'm3', 'n3', 'm4', 'm5', 'm6', 'm7']
  const xd = { label: 'XD', seats: xdSeats, entries: xdSeats.map((s, i) => ({ id: s.id, name: `XD${i}`, players: [men[i] ?? `o${i}`, `w${i}`] })) }
  const seen = new Set()
  for (let seed = 1; seed <= 12; seed++) {
    const r = jointDraw(md, xd, rngOf(seed))
    assert.equal(r.a.clashes, 0, `seed ${seed}`); assert.equal(r.b.clashes, 0)
    assert.equal(r.a.meets.length, 12); assert.equal(r.b.meets.length, 12)
    assert.equal(new Set(r.a.map.map(m => m.src)).size, 15); assert.equal(new Set(r.b.map.map(m => m.src)).size, 24)
    seen.add(r.a.map.map(m => m.src).join())
  }
  assert.ok(seen.size >= 11, 'still random')
})

test('jointDraw: more shared players than the timetable can separate -> far fewer collisions than a plain shuffle', async () => {
  const { jointDraw, smartDraw: plain } = await import('../src/lib/clash.ts')
  const md = { label: 'MD', seats: mdSeats, entries: mdSeats.map((s, i) => ({ id: s.id, name: `MD${i}`, players: [`m${i}`, `n${i}`] })) }
  const men = [...Array(15).keys()].map(i => `m${i}`).concat([...Array(9).keys()].map(i => `n${i}`))
  const xd = { label: 'XD', seats: xdSeats, entries: xdSeats.map((s, i) => ({ id: s.id, name: `XD${i}`, players: [men[i], `w${i}`] })) }
  const r = jointDraw(md, xd, rngOf(5))
  const fixed = xdSeats.map((s, i) => ({ label: 'x', pool: s.pool, players: xd.entries[i].players, slots: s.slots }))
  const shuffled = plain(mdSeats, md.entries, fixed, rngOf(5), 0)
  assert.ok(r.a.clashes <= 3, `left ${r.a.clashes}`)
  assert.ok(shuffled.clashes >= 3 * Math.max(1, r.a.clashes))
})
