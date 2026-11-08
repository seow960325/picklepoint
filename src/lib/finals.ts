// The Final of a group+knockout event can be a series (best of 3): game 1 is
// bracket_key 'KO-2-0', games 2 and 3 are 'KO-2-0-2' / 'KO-2-0-3'
// (migration 0037). With final_best_of 1 (default) it is the one game.
import type { Bundle, Match } from './types.ts'

export const isFinalKey = (k?: string | null): boolean => !!k && (k === 'KO-2-0' || k.startsWith('KO-2-0-'))
export const finalGameNo = (m: Pick<Match, 'bracket_key'>): number =>
  m.bracket_key === 'KO-2-0' ? 1 : Number((m.bracket_key ?? '').split('-')[3]) || 1

export interface FinalSeries {
  games: Match[]; bestOf: number
  a: string | null; b: string | null; aWins: number; bWins: number
  winner: string | null; loser: string | null; live: boolean
}

const won = (m: Match): string | null =>
  m.status !== 'finished' ? null : m.winner_id ?? (m.score_a > m.score_b ? m.team_a_id : m.score_b > m.score_a ? m.team_b_id : null)

export function finalSeries(b: Bundle, eventId: string): FinalSeries | null {
  const ev = b.events.find(e => e.id === eventId)
  const games = b.matches.filter(m => m.event_id === eventId && isFinalKey(m.bracket_key))
    .sort((x, y) => finalGameNo(x) - finalGameNo(y))
  if (!games.length) return null
  const bestOf = Math.max(1, ev?.final_best_of ?? 1)
  const a = games[0].team_a_id, bb = games[0].team_b_id
  let aWins = 0, bWins = 0
  for (const g of games) { const w = won(g); if (w && w === a) aWins++; else if (w && w === bb) bWins++ }
  const need = Math.floor(bestOf / 2) + 1
  const winner = aWins >= need ? a : bWins >= need ? bb : null
  return {
    games, bestOf, a, b: bb, aWins, bWins, winner,
    loser: winner ? (winner === a ? bb : a) : null,
    live: games.some(g => g.status === 'live' && !!g.started_at),
  }
}
