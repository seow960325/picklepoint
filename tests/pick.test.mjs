// Referee "play a different game" list and the pinned-team status line.
import test from 'node:test'
import assert from 'node:assert/strict'
import { courtChoices, gameTitle } from '../src/lib/pool.ts'
import { teamStatus } from '../src/lib/teamstatus.ts'

const T = (id, pool) => ({ id, name: id.toUpperCase(), pool, event_id: 'e' })
const M = (id, a, b, o = {}) => ({ id, event_id: 'e', team_a_id: a, team_b_id: b, score_a: 0, score_b: 0, status: 'scheduled',
  court_id: null, home_court: null, sequence: 0, bracket_key: null, winner_id: null, slot: null, round: 'Group A', ...o })
const base = () => ({
  competition: { code: 'X', multi_sport: false },
  events: [{ id: 'e', format: 'groups_ko', court_dispatch: 'pool' }],
  courts: [{ id: 'c1', number: 1 }, { id: 'c2', number: 2 }],
  teams: [T('a', 'A'), T('b', 'A'), T('c', 'A'), T('d', 'B'), T('e', 'B'), T('f', 'B')],
  matches: [
    M('m1', 'a', 'b', { status: 'live', court_id: 'c1', home_court: 'c1', sequence: 1, slot: 1 }),
    M('m2', 'd', 'e', { status: 'live', court_id: 'c2', home_court: 'c2', sequence: 2, slot: 1 }),
    M('m3', 'a', 'c', { home_court: 'c1', sequence: 3, slot: 2 }),
    M('m4', 'd', 'f', { home_court: 'c2', sequence: 4, slot: 2 }),
    M('m5', 'b', 'c', { home_court: 'c1', sequence: 5, slot: 3 }),
    M('m6', 'e', 'f', { home_court: 'c2', sequence: 6, slot: 3 }),
    M('k1', null, null, { bracket_key: 'KO-2-0', round: 'Final', sequence: 9 }),
  ],
})

test('courtChoices: only this court, in order, without the game on court or unknown teams', () => {
  const b = base()
  assert.deepEqual(courtChoices(b, 'c1', 'm1').map(x => x.m.id), ['m3', 'm5'])
  assert.deepEqual(courtChoices(b, 'c1', 'm1').map(x => x.busy), [null, null])
  // without excluding the live game its teams count as busy
  assert.deepEqual(courtChoices(b, 'c1').map(x => x.busy), ['a', 'b'])
})

test('courtChoices: a team on another court makes the game unavailable', () => {
  const b = base()
  b.matches.push(M('m7', 'c', 'd', { home_court: 'c1', sequence: 7, slot: 4 }))
  const x = courtChoices(b, 'c1', 'm1').find(r => r.m.id === 'm7')
  assert.equal(x.busy, 'd')
})

test('gameTitle', () => {
  const b = base()
  assert.equal(gameTitle(b, b.matches[2]), 'Group A · Slot 2')
  assert.equal(gameTitle(b, b.matches[6]), 'Final')
})

test('teamStatus: playing, queue position, group done, out', () => {
  const b = base()
  assert.equal(teamStatus(b, 'a').state, 'playing')
  const c = teamStatus(b, 'c')                      // m3 on court 1 after the live game
  assert.equal(c.state, 'next'); assert.equal(c.ahead, 1); assert.match(c.head, /Court 1 · 1 game before yours/)
  const f = teamStatus(b, 'f')
  assert.equal(f.ahead, 1); assert.equal(f.courtId, 'c2')
  b.matches[0].status = 'finished'; b.matches[0].winner_id = 'a'
  assert.match(teamStatus(b, 'c').head, /You are next · Court 1/)
  for (const m of b.matches) if (!m.bracket_key) { m.status = 'finished'; m.winner_id = m.team_a_id }
  assert.equal(teamStatus(b, 'c').state, 'waiting')   // groups finished, draw not made yet
  b.matches[6].team_a_id = 'a'; b.matches[6].team_b_id = 'd'; b.matches[6].court_id = 'c1'
  assert.equal(teamStatus(b, 'c').state, 'out')
  assert.match(teamStatus(b, 'a').head, /You are next/)
  b.matches[6].status = 'finished'; b.matches[6].winner_id = 'd'
  assert.match(teamStatus(b, 'd').head, /Champion/)
  assert.match(teamStatus(b, 'a').head, /Runner-up/)
})
