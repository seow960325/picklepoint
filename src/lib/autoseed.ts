/** Knockout seeding that needs no button: once every group game of a groups_ko event is
 *  finished, the first knockout round is the fixed draw (group winners kept apart, printed
 *  plan for MC26). Teams still level are settled by the table order. Pure — the caller
 *  writes the rows (api.courtSeedBracket / adminSeedBracket). */
import type { Bundle, EventCfg } from './types'
import { groupStandings, groupStageComplete, bracketSeeded, bracketRounds } from './store'
import { koPlanOf, planDraw } from './koplan'
import { seedBracket, nextPowerOfTwo } from './draw'

export interface SeedRow { key: string; a: string | null; b: string | null }

export function autoSeedRows(b: Bundle, ev: EventCfg): SeedRow[] | null {
  if (ev.format !== 'groups_ko') return null
  if (!groupStageComplete(b, ev.id) || bracketSeeded(b, ev.id)) return null
  const rounds = bracketRounds(b, ev.id)
  const first = rounds[0]
  if (!first) return null
  const advance = ev.advance_per_group ?? 2
  const tables = groupStandings(b, ev.id)
  const groupIds = Object.keys(tables).sort().map(g => tables[g].slice(0, advance).map(r => r.team.id))
  const plan = koPlanOf(b.competition.code)
  const pd = plan ? planDraw(plan, tables as any) : null
  const flat = pd ? pd.pairs.flat().filter((x): x is string => !!x) : groupIds.flat()
  const rrFinal = flat.length === 4 && groupIds.length === 1 && rounds.every(r => r.round === 'Final' || r.round === 'Third place')
  let rows: SeedRow[]
  if (rrFinal) rows = [{ key: 'KO-2-0', a: flat[0], b: flat[1] }, { key: 'KO-3P', a: flat[2], b: flat[3] }]
  else {
    const size = pd ? pd.pairs.length * 2 : nextPowerOfTwo(flat.length)
    const pairs = pd ? pd.pairs : seedBracket(groupIds, size)
    rows = pairs.map((pr, i) => ({ key: pd ? `KO-${size}-${i}` : first.matches[i]?.bracket_key ?? '', a: pr[0], b: pr[1] }))
  }
  return rows.some(r => !r.key) ? null : rows
}
