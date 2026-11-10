// Full-picture flow for the 6-team format (2 groups of 3):
//   Groups -> places -> Playoff 1/2 -> Semi-final 1/2 -> Final + 3rd place.
// Works for both pickleball/badminton (groups_ko) and captain ball. No scores,
// only who goes where; names fill in as results come in.
import type { Bundle, Match } from './types.ts'
import { cbKo } from './captainball.ts'
import { seedBracket } from './draw.ts'
import { koPlanOf, planDraw, tokenLabel } from './koplan.ts'
import { finalSeries, isFinalKey, type FinalSeries } from './finals.ts'

export type FlowKey = 'P1' | 'P2' | 'SF1' | 'SF2' | 'F' | '3P'
export interface FlowSlot { label: string; id: string | null; prov: boolean }
export interface FlowGame { key: string; title: string; a: FlowSlot; b: FlowSlot; winner: string | null; live: boolean; icon?: string
  /** best-of-3 Final: winner of each game played so far */
  series?: Array<string | null> }
export interface FlowStage { title: string; tone: 'playoff' | 'qf' | 'semi' | 'medal'; games: FlowGame[] }
export interface FlowPlace { label: string; to: string; id: string | null; prov: boolean }
export interface FlowGroup {
  pool: string; ids: string[]
  /** 6-team format: the three places and where each goes */
  places?: FlowPlace[]
  /** other formats: ids in table order, with where the qualifiers go */
  ranked?: Array<{ id: string; to: string | null; prov: boolean }>
}
export interface Flow {
  groups: FlowGroup[]
  stages: FlowStage[]
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
    stages: [
      { title: 'Playoff', tone: 'playoff', games: [P1, P2] },
      { title: 'Semi-finals', tone: 'semi', games: [SF1, SF2] },
      { title: 'Medals', tone: 'medal', games: [{ ...F, icon: '🏆' }, { ...T, icon: '🥉' }] },
    ],
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
    if (!pools) return genericKo(b, ko.id, ko.advance_per_group ?? 2, groupStandings(b, ko.id), groupStageComplete(b, ko.id))
    const st = groupStandings(b, ko.id)
    const tables = Object.fromEntries(Object.entries(st).map(([g, rows]) => [g, rows.map(r => r.team.id)]))
    const own = b.matches.filter(m => m.event_id === ko.id)
    const byKey = (k: string) => own.find(m => m.bracket_key === k)
    return withSeries(buildFlow(pools, tables, groupStageComplete(b, ko.id),
      own.some(m => !m.bracket_key && m.status === 'finished'),
      { P1: byKey('KO-8-1'), P2: byKey('KO-8-3'), SF1: byKey('KO-4-0'), SF2: byKey('KO-4-1'), F: byKey('KO-2-0'), '3P': byKey('KO-3P') }),
      finalSeries(b, ko.id))
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

// ------------------------------------------------- any other groups_ko code
const ORD = ['winner', '2nd', '3rd', '4th', '5th', '6th', '7th', '8th']

/** Groups -> knockout rounds -> Final + 3rd place, for any group/knockout code
 *  (13 teams in 4 groups, 8 teams in 2 groups of 4, 4 teams in one group...). */
function genericKo(b: Bundle, evId: string, adv: number,
  st: Record<string, Array<{ team: { id: string } }>>, done: boolean): Flow | null {
  const own = b.matches.filter(m => m.event_id === evId)
  const played = own.some(m => !m.bracket_key && m.status === 'finished')
  // Final games 2 / 3 (best of 3) are shown inside the Final card, not as extra games
  const ko = own.filter(m => m.bracket_key && (!isFinalKey(m.bracket_key) || m.bracket_key === 'KO-2-0')).sort((x, y) => x.sequence - y.sequence)
  if (!ko.length) return null
  const pools = Object.keys(st).sort()
  const tables = Object.fromEntries(pools.map(g => [g, st[g].map(r => r.team.id)]))
  const single = pools.length === 1
  const label = (g: string, i: number) => single ? `${ORD[i] === 'winner' ? '1st' : ORD[i]} place` : `${g} ${ORD[i] ?? `#${i + 1}`}`
  const idOf = new Map<string, string | null>()
  pools.forEach(g => (tables[g] ?? []).forEach((id, i) => idOf.set(label(g, i), done || played ? id : null)))
  const prov = !done

  // rounds in play order, 3rd place kept apart
  const order: string[] = []
  const byRound = new Map<string, Match[]>()
  for (const m of ko) {
    const r = m.round ?? 'Knockout'
    if (!byRound.has(r)) { byRound.set(r, []); order.push(r) }
    byRound.get(r)!.push(m)
  }
  const main = order.filter(r => r !== 'Third place' && r !== 'Final')
  const short = (m: Match) => {
    if (m.round === 'Final') return 'Final'
    if (m.round === 'Third place') return '3rd place'
    const i = (byRound.get(m.round ?? '') ?? []).indexOf(m) + 1
    const rn = /^Round of (\d+)$/.exec(m.round ?? '')
    return m.round === 'Semi-final' ? `Semi ${i}` : m.round === 'Quarter-final' ? `QF ${i}` : m.round === 'Playoff' ? `Playoff ${i}` : rn ? `R${rn[1]}-${i}` : `${m.round} ${i}`
  }
  const longTitle = (m: Match) => m.round === 'Final' ? 'Final' : m.round === 'Third place' ? '3rd place'
    : `${m.round} ${(byRound.get(m.round ?? '') ?? []).indexOf(m) + 1}`

  // first round: the exact draw seeding will write, as group-place labels
  const first = main[0] ? byRound.get(main[0])! : []
  const firstLabels = new Map<string, [string, string]>()
  const qualId = new Map<string, string>()   // printed plan: team id -> its cross-pool label
  const rrFinal = single && main.length === 0
  if (rrFinal) {
    const f = ko.find(m => m.round === 'Final'), t = ko.find(m => m.round === 'Third place')
    if (f) firstLabels.set(f.id, [label(pools[0], 0), label(pools[0], 1)])
    if (t) firstLabels.set(t.id, [label(pools[0], 2), label(pools[0], 3)])
  } else if (first.length && koPlanOf(b.competition?.code)) {
    // printed plan (MCMD / MCXD fundraiser): fixed pairings, cross-pool places
    const pd = planDraw(koPlanOf(b.competition.code)!, st as any)
    first.forEach(m => {
      const j = Number(/-(\d+)$/.exec(m.bracket_key ?? '')?.[1] ?? -1)
      // before any result the printed labels; the same-pool swap only once teams are known
      const tk = (done || played ? pd.tokens : koPlanOf(b.competition.code)!.pairs)[j], ids = pd.pairs[j]
      if (!tk) return
      const lbs = tk.map(t => /^[WR]\d/.test(t) ? tokenLabel(t) : label(t[0], Number(t[1]) - 1)) as [string, string]
      firstLabels.set(m.id, lbs)
      lbs.forEach((lb, s) => { if (!idOf.has(lb)) idOf.set(lb, done || played ? ids?.[s] ?? null : null) })
      lbs.forEach((lb, s) => { const id = ids?.[s]; if (id && (done || played)) qualId.set(id, lb) })
    })
  } else if (first.length) {
    const grid = pools.map(g => Array.from({ length: adv }, (_, i) => label(g, i)))
    const pairs = seedBracket(grid, first.length * 2)
    first.forEach((m, j) => firstLabels.set(m.id, [pairs[j]?.[0] ?? 'Bye', pairs[j]?.[1] ?? 'Bye']))
  }
  const qualTo = new Map<string, string>()
  const game = (m: Match): FlowGame => {
    const slot = (s: 'a' | 'b'): FlowSlot => {
      const fl = firstLabels.get(m.id)
      if (fl) {
        const lb = fl[s === 'a' ? 0 : 1]
        const id = idOf.get(lb) ?? null
        if (lb !== 'Bye') qualTo.set(lb, longTitle(m))
        return { label: lb, id, prov: prov && !!id }
      }
      const wf = ko.find(x => x.next_match_id === m.id && x.next_slot === s)
      if (wf) return { label: `Winner ${short(wf)}`, id: winOf(wf), prov: false }
      const lf = ko.find(x => x.loser_match_id === m.id && x.loser_slot === s)
      if (lf) return { label: `Loser ${short(lf)}`, id: loseOf(lf), prov: false }
      return { label: 'TBD', id: null, prov: false }
    }
    let a = slot('a'), bb = slot('b')
    if (m.team_a_id && m.team_b_id) { a = { ...a, id: m.team_a_id, prov: false }; bb = { ...bb, id: m.team_b_id, prov: false } }
    // a bye: the team goes straight through, nothing to play
    return { key: m.id, title: longTitle(m), a, b: bb, winner: m.team_b_id || m.status !== 'finished' ? winOf(m) : null,
      live: m.status === 'live' && !!m.started_at }
  }
  const stages: FlowStage[] = main.map(r => ({
    title: r === 'Semi-final' ? 'Semi-finals' : r === 'Quarter-final' ? 'Quarter-finals' : r,
    tone: r === 'Semi-final' ? 'semi' : r === 'Playoff' ? 'playoff' : 'qf',
    games: byRound.get(r)!.map(game),
  }))
  const fin = ko.find(m => m.round === 'Final'), third = ko.find(m => m.round === 'Third place')
  const medals: FlowGame[] = []
  if (fin) medals.push({ ...game(fin), icon: '🏆' })
  if (third) medals.push({ ...game(third), icon: '🥉' })
  stages.push({ title: 'Medals', tone: 'medal', games: medals })

  const groups: FlowGroup[] = pools.map(g => ({
    pool: g, ids: tables[g] ?? [],
    ranked: (tables[g] ?? []).map((id, i) => ({ id, to: qualTo.get(label(g, i)) ?? (qualId.has(id) ? qualTo.get(qualId.get(id)!) ?? null : null), prov })),
  }))
  return withSeries({ groups, stages, champion: fin ? winOf(fin) : null }, finalSeries(b, evId))
}

/** Best-of-3 Final: the card's winner / live / title follow the whole series. */
function withSeries(f: Flow, fs: FinalSeries | null): Flow {
  if (!fs || fs.bestOf < 2) return f
  for (const st of f.stages) for (const g of st.games) {
    if (g.key !== 'F' && g.title !== 'Final') continue
    g.title = `Final · best of ${fs.bestOf}`
    g.winner = fs.winner
    g.live = fs.live
    g.series = fs.games.filter(x => x.status === 'finished').map(x =>
      x.winner_id ?? (x.score_a > x.score_b ? x.team_a_id : x.team_b_id))
  }
  return { ...f, champion: fs.winner }
}
