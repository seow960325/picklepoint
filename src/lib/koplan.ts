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
  /** a winner drawn against the runner-up of its own pool: swap that runner-up
   *  with another one (R1/R2, then R2/R3, then R1/R3 — the first swap that works) */
  swapSamePool?: boolean
}

export const KO_PLANS: Record<string, KoPlan> = {
  // Men's Doubles, 15 teams, 5 pools of 3: 5 winners + 3 best runners-up
  // QF1 A winner v E winner · QF2 B winner v Best runner-up 1 · QF3 C winner v Best runner-up 2 · QF4 D winner v Best runner-up 3
  // (Derek, 13 Nov 2026); semi-finals: QF1 v QF2, QF3 v QF4
  MCMD: { pairs: [['A1', 'E1'], ['B1', 'R1'], ['C1', 'R2'], ['D1', 'R3']], swapSamePool: true },
  // Mixed Doubles, 24 teams, 6 pools of 4: 6 winners + 2 best runners-up
  // QF1 A winner v E winner · QF2 B winner v F winner · QF3 C winner v Best runner-up 1 · QF4 D winner v Best runner-up 2
  // (13 Nov 2026); semi-finals: QF1 v QF2, QF3 v QF4
  MCXD: { pairs: [['A1', 'E1'], ['B1', 'F1'], ['C1', 'R1'], ['D1', 'R2']], swapSamePool: true },
}

// hidden test copy of MC26 (hub TESTMC) uses the same plans
KO_PLANS.TESTMD = KO_PLANS.MCMD
KO_PLANS.TESTXD = KO_PLANS.MCXD

export const koPlanOf = (code?: string | null): KoPlan | null => KO_PLANS[(code ?? '').toUpperCase()] ?? null

const ORD = ['winner', '2nd', '3rd', '4th']
/** "A winner", "C 2nd", "Best group winner 3", "Best runner-up 1" */
export function tokenLabel(t: string): string {
  const pool = /^([A-Z])(\d)$/.exec(t)
  if (pool && !/^[WR]$/.test(pool[1])) return `${pool[1]} ${ORD[Number(pool[2]) - 1] ?? `#${pool[2]}`}`
  const x = /^([WR])(\d+)$/.exec(t)
  if (x) return `Best ${x[1] === 'W' ? 'group winner' : 'runner-up'} ${x[2]}`
  return t
}

/** Bracket wording: "Group A winner", "Group C runner-up", "Best group winner 3", "Best runner-up 1" */
export function slotName(t: string): string {
  const pool = /^([A-Z])(\d)$/.exec(t)
  if (pool && !/^[WR]$/.test(pool[1])) return `Group ${pool[1]} ${pool[2] === '1' ? 'winner' : pool[2] === '2' ? 'runner-up' : `#${pool[2]}`}`
  return tokenLabel(t)
}

export interface PlanRow { team: { id: string; pool?: string | null }; won: number; diff: number; pf?: number }

/** Rows from different pools ranked by wins, then point difference, then points scored.
 *  level[i] = row i is level with row i + 1 (needs a coin toss). An `order`
 *  (team ids, from the organiser's coin tosses) wins over the computed order. */
export function crossRank<R extends PlanRow>(rows: R[], order?: string[]): { ranked: R[]; level: boolean[] } {
  let ranked = rows.slice().sort((a, z) => z.won - a.won || z.diff - a.diff || (z.pf ?? 0) - (a.pf ?? 0)
    || String(a.team.pool ?? '').localeCompare(String(z.team.pool ?? '')))
  if (order?.length && order.length === ranked.length && ranked.every(r => order.includes(r.team.id)))
    ranked = order.map(id => ranked.find(r => r.team.id === id)!)
  const level = ranked.map((r, i) => i + 1 < ranked.length && r.won === ranked[i + 1].won && r.diff === ranked[i + 1].diff && (r.pf ?? 0) === (ranked[i + 1].pf ?? 0))
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
    const has = (t: string) => plan.pairs.flat().includes(t)
    // one swap first (R1/R2, R2/R3, R1/R3); when all three runners-up sit against their own
    // pool winner no single swap can fix it, so the three move round (R1 -> R2 -> R3 -> R1, or back)
    const moves: Array<Record<string, string>> = [
      { R1: 'R2', R2: 'R1' }, { R2: 'R3', R3: 'R2' }, { R1: 'R3', R3: 'R1' },
      { R1: 'R2', R2: 'R3', R3: 'R1' }, { R1: 'R3', R3: 'R2', R2: 'R1' },
    ]
    for (const mv of moves) {
      if (!Object.keys(mv).every(has)) continue
      const sw = (t: string) => mv[t] ?? t
      const trial = tokens.map(([a, b]) => [sw(a), sw(b)] as [string, string])
      if (!samePool(trial)) { tokens = trial; swapped = true; break }
    }
  }
  const pairs = tokens.map(([a, b]) => [resolve(a)?.team.id ?? null, resolve(b)?.team.id ?? null] as [string | null, string | null])
  const nR = Math.max(0, ...plan.pairs.flat().map(t => /^R(\d+)$/.exec(t)).map(m => m ? Number(m[1]) : 0))
  return {
    pairs, tokens, winners, swapped,
    runners: { ranked: runAll.ranked, level: runAll.level.map((l, i) => l && i < nR) },
  }
}

/** In words, why each best runner-up is ahead of the next one: "R3 X is ahead of R4 Y on point difference (+5 v +2)". */
export function cutReasons(run: Array<{ team: { name: string }; won: number; diff: number; pf: number; played: number }>, cut: number): string[] {
  const out: string[] = []
  const sg = (n: number) => (n > 0 ? `+${n}` : `${n}`)
  for (let i = 0; i < Math.min(cut, run.length - 1); i++) {
    const x = run[i], y = run[i + 1]
    if (!x.played && !y.played) continue
    const head = `R${i + 1} ${x.team.name} is ahead of R${i + 2} ${y.team.name}`
    const tail = i === cut - 1 ? `, so R${i + 1} takes the last quarter-final place` : ''
    if (x.won !== y.won) out.push(`${head} on wins (${x.won} v ${y.won})${tail}.`)
    else if (x.diff !== y.diff) out.push(`${head}: same wins (${x.won}), better point difference (${sg(x.diff)} v ${sg(y.diff)})${tail}.`)
    else if (x.pf !== y.pf) out.push(`${head}: same wins (${x.won}) and point difference (${sg(x.diff)}), more points scored (${x.pf} v ${y.pf})${tail}.`)
    else out.push(`R${i + 1} ${x.team.name} and R${i + 2} ${y.team.name} are level on wins, point difference and points scored: coin toss.`)
  }
  return out
}
