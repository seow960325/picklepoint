// Church vs church: every category (pickleball MD / XD, badminton MD / XD,
// captain ball) is its own competition code. This reads them all and builds
// the overall medal table: most gold, then silver, then bronze.
import type { Bundle } from './types.ts'
import { cbStandings, cbKo } from './captainball.ts'

export interface Podium3 { first: string | null; second: string | null; third: string | null }
export interface CategoryResult {
  code: string; name: string; done: boolean
  /** team names (church), null until decided */
  podium: Podium3
  logos: Record<string, string | null>
}
export interface MedalRow { key: string; name: string; logo: string | null; gold: number; silver: number; bronze: number }

const nm = (b: Bundle, id: string | null) => (id ? b.teams.find(t => t.id === id)?.name ?? null : null)
const lg = (b: Bundle, id: string | null) => (id ? b.teams.find(t => t.id === id)?.logo ?? null : null)

/** Podium of one category. Group+knockout: Final + 3rd place. Captain ball:
 *  the round-robin table once every game is finished. */
export function categoryResult(b: Bundle): CategoryResult {
  const none: Podium3 = { first: null, second: null, third: null }
  const out: CategoryResult = { code: b.competition.code, name: b.competition.name, done: false, podium: none, logos: {} }
  const put = (id: string | null) => { const n = nm(b, id); if (n) out.logos[n] = lg(b, id); return n }

  const ko = b.events.find(e => e.format === 'groups_ko')
  if (ko) {
    const fin = b.matches.find(m => m.event_id === ko.id && m.bracket_key != null && m.round === 'Final')
    const thirdM = b.matches.find(m => m.event_id === ko.id && m.bracket_key != null && m.round === 'Third place')
    if (fin?.status === 'finished' && fin.winner_id) {
      const ru = fin.team_a_id === fin.winner_id ? fin.team_b_id : fin.team_a_id
      const third = thirdM ? (thirdM.status === 'finished' ? thirdM.winner_id : undefined) : null
      out.podium = { first: put(fin.winner_id), second: put(ru), third: third ? put(third) : null }
      out.done = third !== undefined
    }
    return out
  }
  const cb = b.events.find(e => e.sport === 'captainball')
  if (cb) {
    const k = cbKo(b, cb)
    if (k.supported) {
      if (k.podium) {
        out.podium = { first: put(k.podium.first.id), second: put(k.podium.second.id), third: put(k.podium.third?.id ?? null) }
        out.done = true
      }
      return out
    }
    const games = b.matches.filter(m => m.event_id === cb.id && !m.tie_stage)
    if (games.length && games.every(m => m.status === 'finished')) {
      const t = cbStandings(b, cb.id)
      out.podium = { first: put(t[0]?.team.id ?? null), second: put(t[1]?.team.id ?? null), third: put(t[2]?.team.id ?? null) }
      out.done = true
    }
  }
  return out
}

const keyOf = (s: string) => s.trim().toLowerCase().replace(/\s+/g, ' ')

/** Gold, then silver, then bronze, then name. Churches are matched by team name. */
export function medalTable(results: CategoryResult[]): MedalRow[] {
  const rows = new Map<string, MedalRow>()
  const add = (cr: CategoryResult, name: string | null, medal: 'gold' | 'silver' | 'bronze') => {
    if (!name) return
    const k = keyOf(name)
    const r = rows.get(k) ?? { key: k, name: name.trim(), logo: null, gold: 0, silver: 0, bronze: 0 }
    r[medal]++
    r.logo = r.logo ?? cr.logos[name] ?? null
    rows.set(k, r)
  }
  for (const cr of results) {
    add(cr, cr.podium.first, 'gold'); add(cr, cr.podium.second, 'silver'); add(cr, cr.podium.third, 'bronze')
  }
  return [...rows.values()].sort((a, z) =>
    z.gold - a.gold || z.silver - a.silver || z.bronze - a.bronze || a.name.localeCompare(z.name))
}
