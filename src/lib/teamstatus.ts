/** Where one team stands right now, in words a player understands:
 *  on court / which court and how many games before theirs / waiting / out. */
import type { Bundle, Match } from './types'

export interface TeamStatus {
  state: 'playing' | 'next' | 'waiting' | 'out' | 'champion'
  head: string
  sub: string
  match?: Match
  courtId?: string | null
  /** games that court plays before this team's game (0 = they are next up) */
  ahead?: number
}

const ON = new Set(['live', 'awaiting_confirm'])
const OPEN = new Set(['scheduled', 'on_deck'])
const ORD = ['1st', '2nd', '3rd', '4th', '5th', '6th']

export const courtLabel = (b: Bundle, id: string | null | undefined): string => {
  const c = b.courts.find(x => x.id === id)
  if (!c) return ''
  return b.competition.multi_sport && c.label ? c.label : `Court ${c.number}`
}

export function teamStatus(b: Bundle, teamId: string, tables?: Record<string, Array<{ team: { id: string } }>>): TeamStatus {
  const mine = b.matches.filter(m => m.team_a_id === teamId || m.team_b_id === teamId).sort((x, y) => x.sequence - y.sequence)
  const opp = (m: Match) => b.teams.find(t => t.id === (m.team_a_id === teamId ? m.team_b_id : m.team_a_id))?.name ?? 'to be decided'
  const stage = (m: Match) => m.bracket_key ? (m.round === 'Third place' ? '3rd place game' : m.round ?? 'Knockout') : m.tie_stage ? (m.round ?? 'Knockout') : 'Group game'
  const pool = b.teams.find(t => t.id === teamId)?.pool
  const pos = pool && tables?.[pool] ? tables[pool].findIndex(r => r.team.id === teamId) : -1
  const place = pos >= 0 ? `${ORD[pos] ?? `#${pos + 1}`} in Group ${pool}` : ''

  const live = mine.find(m => ON.has(m.status))
  if (live) {
    const [us, them] = live.team_a_id === teamId ? [live.score_a, live.score_b] : [live.score_b, live.score_a]
    return { state: 'playing', head: `Playing now · ${courtLabel(b, live.court_id)}`, sub: `${us}–${them} vs ${opp(live)} · ${stage(live)}`, match: live, courtId: live.court_id }
  }

  const next = mine.find(m => OPEN.has(m.status) && m.team_a_id && m.team_b_id)
  if (next) {
    const cid = next.court_id ?? next.home_court ?? null
    if (!cid) return { state: 'next', head: 'Next game', sub: `vs ${opp(next)} · ${stage(next)} · court shown soon`, match: next }
    const before = b.matches.filter(m => m.id !== next.id && (
      (ON.has(m.status) && m.court_id === cid)
      || (OPEN.has(m.status) && m.team_a_id && m.team_b_id && m.sequence < next.sequence
          && (m.court_id === cid || (m.court_id == null && m.home_court === cid))))).length
    const head = before === 0 ? `You are next · ${courtLabel(b, cid)}`
      : `${courtLabel(b, cid)} · ${before} game${before === 1 ? '' : 's'} before yours`
    return { state: 'next', head, sub: `vs ${opp(next)} · ${stage(next)}`, match: next, courtId: cid, ahead: before }
  }

  // nothing on court and nothing fixed yet
  const ko = mine.filter(m => m.bracket_key || m.tie_stage)
  const final = b.matches.find(m => m.bracket_key?.startsWith('KO-2-0') && m.status === 'finished')
  const lastFinal = b.matches.filter(m => m.round === 'Final' && m.bracket_key).every(m => m.status === 'finished')
  if (final && lastFinal && final.winner_id === teamId) return { state: 'champion', head: 'Champion 🏆', sub: place }
  const pending = ko.find(m => m.status !== 'finished')
  if (pending) return { state: 'waiting', head: `Through to the ${stage(pending).toLowerCase()}`, sub: 'Waiting for the other game to finish.' }
  const lostKo = ko.filter(m => m.status === 'finished' && m.winner_id && m.winner_id !== teamId).pop()
  const lastKo = ko.filter(m => m.status === 'finished').pop()
  if (lastKo) {
    if (lastKo.round === 'Final') return { state: 'out', head: lastKo.winner_id === teamId ? 'Champion 🏆' : 'Runner-up 🥈', sub: place }
    if (lastKo.round === 'Third place') return { state: 'out', head: lastKo.winner_id === teamId ? '3rd place 🥉' : '4th place', sub: place }
    if (lostKo) return { state: 'out', head: `Out in the ${stage(lostKo).toLowerCase()}`, sub: place }
  }
  const groupLeft = b.matches.some(m => !m.bracket_key && !m.tie_stage && m.status !== 'finished')
  const seeded = b.matches.some(m => m.bracket_key && m.team_a_id)
  if (!mine.length) return { state: 'waiting', head: 'No games yet', sub: 'The schedule is not out yet.' }
  if (groupLeft) return { state: 'waiting', head: 'Group games done', sub: `${place ? place + ' so far · ' : ''}waiting for the other groups to finish.` }
  if (!seeded) return { state: 'waiting', head: place || 'Group games done', sub: 'Waiting for the organiser to confirm the knockout draw.' }
  return { state: 'out', head: 'Group stage finished', sub: place ? `${place} · did not reach the knockout.` : 'Did not reach the knockout.' }
}
