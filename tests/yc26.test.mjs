// YC26 printed timetable: slot -> clock time per category, knockout slots and courts
import test from 'node:test'
import assert from 'node:assert/strict'
import { slotTime, slotOf, plannedCourt, plannedTime, clockOfCode } from '../src/lib/timetable.ts'

const comp = code => ({ code, name: code, venue: null, event_date: '2026-11-14', status: 'live' })
const bundle = (code, matches, courts = []) => ({ competition: comp(code), events: [{ id: 'e1', competition_id: 'c', name: code, format: 'groups_ko', sort_order: 0 }], courts, teams: [], matches })
const m = (o) => ({ id: 'm' + Math.random(), event_id: 'e1', court_id: null, round: null, sequence: 1, team_a_id: 'a', team_b_id: 'b', score_a: 0, score_b: 0, status: 'scheduled', ...o })

test('slot times per category', () => {
  assert.equal(slotTime(clockOfCode('BMMD'), 1), '9:00 am')
  assert.equal(slotTime(clockOfCode('BMMD'), 9), '1:00 pm')
  assert.equal(slotTime(clockOfCode('BMMD'), 10), '3:15 pm')
  assert.equal(slotTime(clockOfCode('PBMD'), 12), '12:40 pm')
  assert.equal(slotTime(clockOfCode('PBMD'), 15), '3:25 pm')
  assert.equal(slotTime(clockOfCode('PBXD'), 13), '2:30 pm')
  assert.equal(slotTime(clockOfCode('YC26'), 7), '1:30 pm')
  assert.equal(slotTime(clockOfCode('YC26'), 12), '3:10 pm')
})

test('knockout rounds get their slot and court', () => {
  const sf = [m({ bracket_key: 'KO-4-0', round: 'Semi-final', sequence: 60 }), m({ bracket_key: 'KO-4-1', round: 'Semi-final', sequence: 61 })]
  const fin = m({ bracket_key: 'KO-2-0', round: 'Final', sequence: 63 })
  const b = bundle('PBMD', [...sf, fin])
  assert.equal(slotOf(b, sf[0]), 13); assert.equal(slotOf(b, sf[1]), 13); assert.equal(slotOf(b, fin), 15)
  assert.equal(plannedCourt(b, sf[0]), 2); assert.equal(plannedCourt(b, sf[1]), 3)
  assert.equal(plannedTime(b, fin), '3:25 pm')
  const b2 = bundle('BMXD', [m({ bracket_key: 'KO-4-0', round: 'Semi-final', sequence: 5 })])
  assert.equal(plannedCourt(b2, b2.matches[0]), 6)
})

test('captain ball: group games by order, knockout by stage', () => {
  const g = m({ sequence: 3, round: 'Round 2' }), p1 = m({ sequence: 46, round: 'Playoff 1' }), sf2 = m({ sequence: 51, round: 'Semi-final 2' }), fin = m({ sequence: 55, round: 'Final' })
  const b = bundle('YC26', [g, p1, sf2, fin])
  assert.equal(plannedTime(b, g), '9:40 am'); assert.equal(plannedTime(b, p1), '1:30 pm')
  assert.equal(plannedTime(b, sf2), '2:30 pm'); assert.equal(plannedTime(b, fin), '3:10 pm')
  assert.equal(plannedCourt(b, fin), 2)
})

test('MC26 keeps its own clock', () => {
  assert.equal(slotTime(clockOfCode('MC26'), 1), '9:30 am')
})
