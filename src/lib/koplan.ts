/** Knockout draws printed by an organiser, per competition code (Christmas
 *  Outreach fundraiser, 14 Nov 2026). Codes not listed here keep the
 *  automatic seeding (seedBracket), so nothing else changes.
 *
 *  Tokens: 'A1' = pool A winner, 'C2' = pool C runner-up;
 *          'W1'..'W6' = pool winners ranked across pools,
 *          'R1', 'R2' = the best runners-up ranked across pools.
 *  Cross-pool ranking = wins, then point difference (the guidebook rule);
 *  teams still level are flagged so the organiser settles it by coin toss.
 *  Pair j is written into bracket slot KO-<size>-j (QF1 = KO-8-0 …). */

export interface KoPlan {
  pairs: Array<[string, string]>
  /** a winner drawn against the runner-up of its own pool: swap R1 and R2 */
  swapSamePool?: boolean
}

export const KO_PLANS: Record<string, KoPlan> = {
  // Men's Doubles, 14 teams, pools A/B of 4 and C/D of 3
  MCMD: { pairs: [['A1', 'C2'], ['C1', 'A2'], ['B1', 'D2'], ['D1', 'B2']] },
  // Mixed Doubles, 24 teams, 6 pools of 4: 6 winners + 2 best runners-up
  MCXD: { pairs: [['W1', 'R2'], ['W4', 'W5'], ['W3', 'W6'], ['W2', 'R1']], swapSamePool: true },
}

export const koPlanOf = (code?: string | null): KoPlan | null => KO_PLANS[(code ?? '').toUpperCase()] ?? null

const ORD = ['winner', '2nd', '3rd', '4th']
/** "A winner", "C 2nd", "Winner 3", "Runner-up 1" */
export function tokenLabel(t: string): string {
  const pool = /^([A-Z])(\d)$/.exec(t)
  if (pool && !/^[WR]$/.test(pool[1])) return `${pool[1]} ${ORD[Number(pool[2]) - 1] ?? `#${pool[2]}`}`
  const x = /^([WR])(\d+)$/.exec(t)
  if (x) return `${x[1] === 'W' ? 'Winner' : 'Runner-up'} ${x[2]}`
  return t
}

/** Bracket preview wording: "Group A winner", "Group C runner-up", "Winner 3", "Runner-up 1" */
export function slotName(t: string): string {
  const pool = /^([A-Z])(\d)$/.exec(t)
  if (pool && !/^[WR]$/.test(pool[1])) return `Group ${pool[1]} ${pool[2] === '1' ? 'winner' : pool[2] === '2' ? 'runner-up' : `#${pool[2]}`}`
  return tokenLabel(t)
}

export interface PlanRow { team: { id: string; pool?: string | null }; won: number; diff: number }

/** Rows from different pools ranked by wins, then point difference.
 *  level[i] = row i is level with row i + 1 (needs a coin toss). An `order`
 *  (team ids, from the organiser's coin tosses) wins over the computed order. */
export function crossRank<R extends PlanRow>(rows: R[], order?: string[]): { ranked: R[]; level: boolean[] } {
  let ranked = rows.slice().sort((a, z) => z.won - a.won || z.diff - a.diff
    || String(a.team.pool ?? '').localeCompare(String(z.team.pool ?? '')))
  if (order?.length && order.length === ranked.length && ranked.every(r => order.includes(r.team.id)))
    ranked = order.map(id => ranked.find(r => r.team.id === id)!)
  const level = ranked.map((r, i) => i + 1 < ranked.length && r.won === ranked[i + 1].won && r.diff === ranked[i + 1].diff)
  return { ranked, level }
}

export interface PlanDraw<R extends PlanRow> {
  /** team ids per bracket match (null = not known yet) */
  pairs: Array<[string | null, string | null]>
  /** the printed tokens per match, after any same-pool swap */
  tokens: Array<[string, string]>
  winners: { ranked: R[]; level: boolean[] }
  runners: { ranked: R[]; level: boolean[] }
  swapped: boolean
}

/** The draw a plan gives for these group tables (each pool already in final order). */
export function planDraw<R extends PlanRow>(plan: KoPlan, tables: Record<string, R[]>,
  order?: { W?: string[]; R?: string[] }): PlanDraw<R> {
  const pools = Object.keys(tables).sort()
  const winners = crossRank(pools.map(p => tables[p][0]).filter(Boolean), order?.W)
  const runAll = crossRank(pools.map(p => tables[p][1]).filter(Boolean), order?.R)
  const resolve = (t: string): R | null => {
    const x = /^([WR])(\d+)$/.exec(t)
    if (x) return (x[1] === 'W' ? winners : runAll).ranked[Number(x[2]) - 1] ?? null
    const p = /^([A-Z])(\d)$/.exec(t)
    return p ? tables[p[1]]?.[Number(p[2]) - 1] ?? null : null
  }
  let tokens = plan.pairs.map(p => [...p] as [string, string])
  const samePool = (tk: Array<[string, string]>) => tk.some(([a, b]) => {
    const x = resolve(a), y = resolve(b)
    return !!x && !!y && (x.team.pool ?? '') === (y.team.pool ?? '')
  })
  let swapped = false
  if (plan.swapSamePool && samePool(tokens)) {
    const sw = (t: string) => t === 'R1' ? 'R2' : t === 'R2' ? 'R1' : t
    const trial = tokens.map(([a, b]) => [sw(a), sw(b)] as [string, string])
    if (!samePool(trial)) { tokens = trial; swapped = true }
  }
  const pairs = tokens.map(([a, b]) => [resolve(a)?.team.id ?? null, resolve(b)?.team.id ?? null] as [string | null, string | null])
  const nR = Math.max(0, ...plan.pairs.flat().map(t => /^R(\d+)$/.exec(t)).map(m => m ? Number(m[1]) : 0))
  return {
    pairs, tokens, winners, swapped,
    runners: { ranked: runAll.ranked, level: runAll.level.map((l, i) => l && i < nR) },
  }
}
