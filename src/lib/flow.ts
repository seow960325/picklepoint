// Full-picture flow for the 6-team format (2 groups of 3):
//   Groups -> places -> Playoff 1/2 -> Semi-final 1/2 -> Final + 3rd place.
// Works for both pickleball/badminton (groups_ko) and captain ball. No scores,
// only who goes where; names fill in as results come in.
import type { Bundle, Match } from './types.ts'
import { cbKo } from './captainball.ts'

export type FlowKey = 'P1' | 'P2' | 'SF1' | 'SF2' | 'F' | '3P'
export interface FlowSlot { label: string; id: string | null; prov: boolean }
export interface FlowGame { key: FlowKey; title: string; a: FlowSlot; b: FlowSlot; winner: string | null; live: boolean }
export interface FlowPlace { label: string; to: string; id: string | null; prov: boolean }
export interface Flow {
  groups: Array<{ pool: string; ids: string[]; places: FlowPlace[] }>
  games: Record<FlowKey, FlowGame>
  champion: string | null
}

const winOf = (m?: Match): string | null => {
  if (!m || m.status !== 'finished') return null
  if (m.winner_id) return m.winner_id
  return m.score_a > m.score_b ? m.team_a_id : m.score_b > m.score_a ? m.team_b_id : null
}
const loseOf = (m?: Match): string | null => {
  const w = winOf(m)
  if (!w || !m || !m.team_b_id) return null
  return m.team_a_id === w ? m.team_b_id : m.team_a_id
}

export function buildFlow(pools: [string, string], tables: Record<string, string[]>, groupsDone: boolean,
  anyGroupPlayed: boolean, games: Partial<Record<FlowKey, Match>>): Flow {
  const [P, Q] = pools
  const prov = !groupsDone
  const at = (g: string, i: number): FlowSlot['id'] => (groupsDone || anyGroupPlayed ? tables[g]?.[i] ?? null : null)
  const slot = (label: string, id: string | null, p = false): FlowSlot => ({ label, id, prov: p && !!id })
  const w = (k: FlowKey) => winOf(games[k]), l = (k: FlowKey) => loseOf(games[k])
  const game = (key: FlowKey, title: string, a: FlowSlot, b: FlowSlot): FlowGame => {
    const m = games[key]
    // the real teams of the match win over the prediction (admin may have changed them)
    const real = [m?.team_a_id, m?.team_b_id].filter((x): x is string => !!x)
    if (real.length === 2) {
      const [x, y] = real.includes(a.id ?? '') && a.id === real[1] ? [real[1], real[0]] : real
      a = { ...a, id: x, prov: false }; b = { ...b, id: y, prov: false }
    }
    return { key, title, a, b, winner: winOf(m), live: m?.status === 'live' && !!m.started_at }
  }
  const P1 = game('P1', 'Playoff 1', slot(`${P} 3rd`, at(P, 2), prov), slot(`${Q} 2nd`, at(Q, 1), prov))
  const P2 = game('P2', 'Playoff 2', slot(`${Q} 3rd`, at(Q, 2), prov), slot(`${P} 2nd`, at(P, 1), prov))
  const SF1 = game('SF1', 'Semi-final 1', slot(`${P} winner`, at(P, 0), prov), slot('Winner Playoff 1', w('P1')))
  const SF2 = game('SF2', 'Semi-final 2', slot(`${Q} winner`, at(Q, 0), prov), slot('Winner Playoff 2', w('P2')))
  const F = game('F', 'Final', slot('Winner Semi 1', w('SF1')), slot('Winner Semi 2', w('SF2')))
  const T = game('3P', '3rd place', slot('Loser Semi 1', l('SF1')), slot('Loser Semi 2', l('SF2')))
  const places = (g: string, other: string): FlowPlace[] => [
    { label: `${g} winner`, to: 'Semi-final', id: at(g, 0), prov },
    { label: `${g} 2nd`, to: `Playoff v ${other} 3rd`, id: at(g, 1), prov },
    { label: `${g} 3rd`, to: `Playoff v ${other} 2nd`, id: at(g, 2), prov },
  ]
  return {
    groups: [
      { pool: P, ids: tables[P] ?? [], places: places(P, Q) },
      { pool: Q, ids: tables[Q] ?? [], places: places(Q, P) },
    ],
    games: { P1, P2, SF1, SF2, F, '3P': T },
    champion: F.winner,
  }
}

/** Two groups of exactly three teams? */
const twoByThree = (b: Bundle, evId: string): [string, string] | null => {
  const ts = b.teams.filter(t => t.event_id === evId)
  const pools = [...new Set(ts.map(t => t.pool ?? 'A'))].sort()
  return pools.length === 2 && pools.every(p => ts.filter(t => (t.pool ?? 'A') === p).length === 3)
    ? [pools[0], pools[1]] : null
}

/** Flow for a code, or null when it isn't the 6-team format. */
/** store.ts helpers are passed in (store.ts can't load outside the browser). */
export interface FlowHelpers {
  groupStandings: (b: Bundle, evId: string) => Record<string, Array<{ team: { id: string } }>>
  groupStageComplete: (b: Bundle, evId: string) => boolean
}
export function flowOf(b: Bundle, h?: FlowHelpers): Flow | null {
  const ko = b.events.find(e => e.format === 'groups_ko')
  if (ko) {
    if (!h) return null
    const { groupStandings, groupStageComplete } = h
    const pools = twoByThree(b, ko.id)
    if (!pools) return null
    const st = groupStandings(b, ko.id)
    const tables = Object.fromEntries(Object.entries(st).map(([g, rows]) => [g, rows.map(r => r.team.id)]))
    const own = b.matches.filter(m => m.event_id === ko.id)
    const byKey = (k: string) => own.find(m => m.bracket_key === k)
    return buildFlow(pools, tables, groupStageComplete(b, ko.id),
      own.some(m => !m.bracket_key && m.status === 'finished'),
      { P1: byKey('KO-8-1'), P2: byKey('KO-8-3'), SF1: byKey('KO-4-0'), SF2: byKey('KO-4-1'), F: byKey('KO-2-0'), '3P': byKey('KO-3P') })
  }
  const cb = b.events.find(e => e.sport === 'captainball')
  if (cb) {
    const pools = twoByThree(b, cb.id)
    if (!pools) return null
    const k = cbKo(b, cb)
    const tables = Object.fromEntries(Object.entries(k.groups).map(([g, rows]) => [g, rows.map(r => r.team.id)]))
    const played = b.matches.some(m => m.event_id === cb.id && !m.tie_stage && m.status === 'finished')
    return buildFlow(pools, tables, k.groupsDone, played, k.games)
  }
  return null
}
