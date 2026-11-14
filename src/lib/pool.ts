/** Opt-in extras for groups_ko events (migration 0026). Every helper here is
 *  a no-op unless the event carries the matching flag, so competitions that
 *  never set them (TEST01, YC26, MCMC26 …) behave exactly as before.
 *
 *   legs = 1             each pair inside a group meets once (round robin); 2 = twice
 *   court_dispatch=pool  group matches wait OFF-court in one shared queue; a
 *                        court that frees up takes the next match whose two
 *                        teams are both idle (keeps waiting time even)
 *   tiebreak = 'diff'    wins → point difference → head-to-head → coin toss
 *   tiebreak = 'diff_only'  wins → point difference → points scored → coin toss (no head-to-head)
 *   pool_strict          shared queue: each court plays its home games in the
 *                        printed order, waiting while a team is still on court
 *   ko_*                 knockout games use their own scoring rules
 *   play_clock           game time = first point → last point
 *   bracket_preview      the fixed bracket is shown before the groups finish
 *   tv_partner           code of the sister category for the combined TV
 */
import type { Bundle, EventCfg, Match, Team } from './types'
import { finalGameNo } from './finals.ts'
import { koPlanOf, slotName, planDraw, type KoPlan } from './koplan.ts'
import { roundRobinPairs, standardSeedOrder, seedBracket, type DraftMatch, type DraftTeam } from './draw.ts'

export const isPoolDispatch = (ev?: EventCfg | null) => ev?.court_dispatch === 'pool'
/** wins → point difference ranking (with or without head-to-head after it) */
export const isDiffTiebreak = (ev?: EventCfg | null) => ev?.tiebreak === 'diff' || ev?.tiebreak === 'diff_only'

const BUSY = new Set(['live', 'awaiting_confirm'])

// ------------------------------------------------------------ scheduling
/** Every fixture of every group, `legs` times (leg 2 swaps ends). */
function groupFixtures(teams: DraftTeam[], legs: number) {
  const pools = [...new Set(teams.map(t => t.pool || 'A'))].sort()
  const out: Array<{ a: number; b: number; pool: string; leg: number; round: number }> = []
  for (const pool of pools) {
    const members = teams.map((t, i) => ({ t, i })).filter(x => (x.t.pool || 'A') === pool)
    const rounds = roundRobinPairs(members.length)
    for (let leg = 1; leg <= legs; leg++) {
      rounds.forEach((r, ri) => r.forEach(([x, y]) => {
        const [a, b] = leg % 2 ? [members[x].i, members[y].i] : [members[y].i, members[x].i]
        out.push({ a, b, pool, leg, round: ri + 1 })
      }))
    }
  }
  return out
}

/** Home courts: fixtures are dealt to courts group by group (leg 1 then
 *  leg 2) until each court holds its fair share. Most groups live on one
 *  court all day; a group that straddles two courts moves once — its last
 *  games are on the next court — so no team ever uses more than two courts. */
export function homeCourts(fx: Array<{ pool: string }>, courtCount: number): number[] {
  const C = Math.max(1, courtCount)
  const cap = Math.ceil(fx.length / C)
  return fx.map((_, i) => Math.min(C - 1, Math.floor(i / cap)))
}

/** Play order for the shared court queue, court by court. Built slot by slot
 *  (one slot = one game on every court): each court picks, from its own home
 *  games, the one whose two teams have waited longest, so rests stay as even
 *  as the numbers allow and nobody plays twice in a row. A team starts its
 *  second leg only after finishing its first. The first game of each court is
 *  placed on it; the rest wait off-court (courtIdx -1) with their homeCourt. */
export function buildPoolSchedule(teams: DraftTeam[], courtCount: number, legs = 2, iterations = 120000): DraftMatch[] {
  const C = Math.max(1, courtCount)
  const start = greedyPoolSchedule(teams, C, legs, () => 0)
  // per-court lists, then hill-climb by swapping two games on one court
  const lanes: DraftMatch[][] = Array.from({ length: C }, () => [])
  for (const m of start) lanes[m.homeCourt ?? 0].push(m)
  let seed = 20261006
  const rng = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 2 ** 32)
  let cost = laneCost(lanes, teams.length)
  let bestCost = cost, best = lanes.map(l => l.slice())
  for (let it = 0; it < iterations; it++) {
    const c = Math.floor(rng() * C), L = lanes[c]
    if (L.length < 2) continue
    const i = Math.floor(rng() * L.length), j = Math.floor(rng() * L.length)
    if (i === j) continue
    // move: swap two games, or lift one game out and slot it in elsewhere
    const swap = rng() < 0.5
    const undo = L.slice()
    if (swap) [L[i], L[j]] = [L[j], L[i]]
    else L.splice(j, 0, L.splice(i, 1)[0])
    const next = laneCost(lanes, teams.length)
    // hill-climb (equal moves allowed, so it can drift across plateaus)
    if (next <= cost) {
      cost = next
      if (cost < bestCost) { bestCost = cost; best = lanes.map(l => l.slice()) }
    } else lanes[c] = undo
  }
  lanes.splice(0, lanes.length, ...best)
  // emit in time order: slot by slot, court by court
  const out: DraftMatch[] = []
  const len = Math.max(...lanes.map(l => l.length))
  let seq = 1
  for (let k = 0; k < len; k++) {
    for (let c = 0; c < C; c++) {
      const m = lanes[c][k]
      if (m) out.push({ ...m, courtIdx: k === 0 ? c : -1, sequence: seq++ })
    }
  }
  return out
}

/** Cost of a set of court lanes (position on a lane ≈ time). Hard rules are
 *  heavily penalised: a team twice in one slot, back-to-back games, second
 *  leg before the first is done, coming back to a court it already left.
 *  Then: the longest rest, the shortest rest, and how uneven rests are. */
function laneCost(lanes: DraftMatch[][], teamCount: number): number {
  const games: Array<Array<{ k: number; c: number; leg: number }>> = Array.from({ length: teamCount }, () => [])
  lanes.forEach((L, c) => L.forEach((m, k) => {
    games[m.aIdx].push({ k, c, leg: m.round }); games[m.bIdx].push({ k, c, leg: m.round })
  }))
  let pen = 0, maxGap = 0, minGap = 99, sum = 0, sq = 0, n = 0
  for (const g of games) {
    g.sort((x, y) => x.k - y.k || x.c - y.c)
    for (let i = 1; i < g.length; i++) {
      const gap = g[i].k - g[i - 1].k
      if (gap === 0) pen += 100                    // two courts at once
      else if (gap === 1) pen += 20                // back-to-back
      if (g[i].leg < g[i - 1].leg) pen += 50       // leg 2 before leg 1 finished
      if (g[i].c < g[i - 1].c) pen += 50           // went back to an earlier court
      maxGap = Math.max(maxGap, gap); minGap = Math.min(minGap, gap)
      sum += gap; sq += gap * gap; n++
    }
    // only one move between courts
    let moves = 0
    for (let i = 1; i < g.length; i++) if (g[i].c !== g[i - 1].c) moves++
    if (moves > 1) pen += 50 * (moves - 1)
  }
  const varc = n ? sq / n - (sum / n) ** 2 : 0
  return pen * 100000 + maxGap * 1000 - minGap * 800 + varc * 50
}

/** Rest quality of an order, higher is better: [-worst gap, best-worst
 *  minimum gap, -spread], gaps counted in games played on that court
 *  between a team's games. */
export function restScore(order: DraftMatch[], teamCount: number): number[] {
  const posOnCourt = new Map<number, number>()
  const n: number[] = []
  for (const m of order) { const c = m.homeCourt ?? 0; n[c] = (n[c] ?? 0) + 1; posOnCourt.set(m.sequence, n[c]) }
  let maxGap = 0, minGap = Infinity, sum = 0, sq = 0, k = 0
  for (let t = 0; t < teamCount; t++) {
    const mine = order.filter(m => m.aIdx === t || m.bIdx === t)
    for (let i = 1; i < mine.length; i++) {
      if ((mine[i].homeCourt ?? 0) !== (mine[i - 1].homeCourt ?? 0)) continue
      const g = posOnCourt.get(mine[i].sequence)! - posOnCourt.get(mine[i - 1].sequence)!
      maxGap = Math.max(maxGap, g); minGap = Math.min(minGap, g); sum += g; sq += g * g; k++
    }
  }
  const varc = k ? sq / k - (sum / k) ** 2 : 0
  return [-maxGap, minGap, -Math.round(varc * 100)]
}

export function greedyPoolSchedule(teams: DraftTeam[], courtCount: number, legs: number, rng: () => number): DraftMatch[] {
  const C = Math.max(1, courtCount)
  const all = groupFixtures(teams, legs)
  const home = homeCourts(all, C)
  const left = all.map((f, i) => ({ ...f, home: home[i] }))
  const last = new Map<number, number>()        // team -> last slot played
  const played = new Map<number, number>()      // team -> games played
  const perLeg = new Map<number, number>()      // team -> games per leg
  teams.forEach((t, i) => perLeg.set(i, teams.filter(x => (x.pool || 'A') === (t.pool || 'A')).length - 1))

  const out: DraftMatch[] = []
  const opened = new Set<number>()
  let slot = 0, seq = 1
  while (left.length) {
    const inSlot = new Set<number>()
    let picked = 0
    for (let c = 0; c < C && left.length; c++) {
      for (const strictLegs of [true, false]) {
        let best = -1, bestKey: number[] | null = null
        left.forEach((f, idx) => {
          if (f.home !== c || inSlot.has(f.a) || inSlot.has(f.b)) return
          const done = (t: number) => played.get(t) ?? 0
          // second leg only once both teams have finished their first
          if (strictLegs && f.leg > 1 && (done(f.a) < perLeg.get(f.a)! * (f.leg - 1) || done(f.b) < perLeg.get(f.b)! * (f.leg - 1))) return
          // a team whose group straddles two courts finishes on its first
          // court before moving — it changes court once, never back
          if (left.some(o => o.home < f.home && (o.a === f.a || o.b === f.a || o.a === f.b || o.b === f.b))) return
          const rest = (t: number) => slot - (last.get(t) ?? -99)
          const minRest = Math.min(rest(f.a), rest(f.b))
          // higher is better: avoid back-to-back, longest-waiting first,
          // fewer games played first, then the natural fixture order
          const key = [minRest >= 4 ? 2 : minRest >= 2 ? 1 : 0, Math.min(minRest, 50) + rng() * 2.5, -(done(f.a) + done(f.b)), rng(), -f.leg, -f.round, -idx]
          if (!bestKey || cmp(key, bestKey) > 0) { best = idx; bestKey = key }
        })
        if (best < 0) { if (strictLegs && picked === 0 && c === C - 1) continue; break }
        const f = left.splice(best, 1)[0]
        inSlot.add(f.a); inSlot.add(f.b)
        last.set(f.a, slot); last.set(f.b, slot)
        played.set(f.a, (played.get(f.a) ?? 0) + 1); played.set(f.b, (played.get(f.b) ?? 0) + 1)
        const first = !opened.has(f.home); opened.add(f.home)
        out.push({
          aIdx: f.a, bIdx: f.b, round: f.leg, pool: f.pool,
          courtIdx: first ? f.home : -1,
          homeCourt: f.home,
          sequence: seq++,
          label: `Group ${f.pool} · Round robin`,
        })
        picked++
        break
      }
    }
    slot++
  }
  return out
}

function cmp(x: number[], y: number[]): number {
  for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return x[i] - y[i]
  return 0
}

// ------------------------------------------------------------ dispatch
/** The shared queue: group matches not yet on a court, in play order. */
export const poolQueue = (b: Bundle, eventId: string): Match[] =>
  b.matches
    .filter(m => m.event_id === eventId && m.court_id == null && m.bracket_key == null && m.status === 'scheduled')
    .sort((x, y) => x.sequence - y.sequence)

/** Is either team of `m` on a court right now? */
export const teamsBusy = (b: Bundle, m: Match): boolean => {
  const ids = [m.team_a_id, m.team_b_id]
  return b.matches.some(x => x.id !== m.id && BUSY.has(x.status)
    && (ids.includes(x.team_a_id) || ids.includes(x.team_b_id)))
}

/** A team needs this long off court before its next game, whenever the
 *  queue allows it (only bites when courts drift apart). */
export const MIN_REST_MS = 15 * 60 * 1000

/** When did this team last finish a game? (ms, -Infinity = not yet) */
function lastFinish(b: Bundle, teamId: string | null): number {
  let t = -Infinity
  for (const x of b.matches) {
    if (x.status === 'finished' && x.finished_at && (x.team_a_id === teamId || x.team_b_id === teamId)) {
      t = Math.max(t, Date.parse(x.finished_at))
    }
  }
  return t
}

/** Fill every idle court with its next queued game (home court only) whose
 *  two teams are both free — preferring, in queue order, one whose teams have
 *  rested MIN_REST; failing that, the free game with the most-rested teams.
 *  Mutates the bundle. Twin of _pool_dispatch() in migration 0026. */
export function poolDispatch(b: Bundle, eventId: string, now = Date.now()): Match[] {
  const placed: Match[] = []
  const courts = b.courts.slice().sort((x, y) => x.number - y.number)
  for (const c of courts) {
    const occupied = b.matches.some(m => m.court_id === c.id
      && (BUSY.has(m.status) || m.status === 'scheduled' || m.status === 'on_deck'))
    if (occupied) continue
    const mine = poolQueue(b, eventId).filter(m => m.home_court == null || m.home_court === c.id)
    // pool_strict (migration 0038): the printed order — the court's next game
    // only, and it waits while one of its teams is still on another court
    if (b.events.find(e => e.id === eventId)?.pool_strict) {
      const first = mine[0]
      if (!first || teamsBusy(b, first)) continue
      // migration 0039: and every group game of the earlier slots is finished
      if (first.slot != null && b.matches.some(x => x.event_id === eventId && x.bracket_key == null
        && x.slot != null && x.slot < first.slot! && x.status !== 'finished')) continue
      first.court_id = c.id
      first.status = 'live'
      placed.push(first)
      continue
    }
    const free = mine.filter(m => !teamsBusy(b, m))
    if (!free.length) continue
    const rest = (m: Match) => now - Math.max(lastFinish(b, m.team_a_id), lastFinish(b, m.team_b_id))
    const next = free.find(m => rest(m) >= MIN_REST_MS)
      ?? free.reduce((best, m) => rest(m) > rest(best) ? m : best, free[0])
    next.court_id = c.id
    next.status = 'live'
    placed.push(next)
  }
  return placed
}

/** Queue preview for the board: the next n matches, with the teams that are
 *  still on court flagged so viewers know why a match is "waiting". */
export function upNext(b: Bundle, eventId: string, n = 6): Array<{ m: Match; waiting: boolean }> {
  return poolQueue(b, eventId).slice(0, n).map(m => ({ m, waiting: teamsBusy(b, m) }))
}

// ------------------------------------------------------------ bracket preview

/** Position of a knockout game inside its round: the j of 'KO-<size>-<j>' (QF1 = KO-8-0 ...). */
export const koIndex = (m: Pick<Match, 'bracket_key'>): number | null => {
  const x = /^KO-\d+-(\d+)$/.exec(m.bracket_key ?? '')
  return x ? Number(x[1]) : null
}
/** Games of one knockout round in bracket order (QF1, QF2 ...): by the slot in the key, so the
 *  numbering always matches the printed plan even if a game's play order (sequence) was changed. */
export const koOrder = (x: Pick<Match, 'bracket_key' | 'sequence'>, y: Pick<Match, 'bracket_key' | 'sequence'>): number => {
  const i = koIndex(x), j = koIndex(y)
  return i != null && j != null && i !== j ? i - j : x.sequence - y.sequence
}

/** Short names for knockout slots: QF1…, SF1…, 'Final', '3rd'. */
export function koShort(b: Bundle, m: Match): string {
  if (m.round === 'Final') return (b.events.find(e => e.id === m.event_id)?.final_best_of ?? 1) > 1 ? `Final G${finalGameNo(m)}` : 'Final'
  if (m.round === 'Third place') return '3rd place'
  const same = b.matches.filter(x => x.event_id === m.event_id && x.bracket_key != null && x.round === m.round)
    .sort(koOrder)
  const i = same.findIndex(x => x.id === m.id) + 1
  const rn = /^Round of (\d+)$/.exec(m.round ?? '')
  const tag = m.round === 'Quarter-final' ? 'QF' : m.round === 'Semi-final' ? 'SF' : m.round === 'Playoff' ? 'PO' : rn ? `R${rn[1]}-` : (m.round ?? 'R')
  return `${tag}${i}`
}

type GroupTables = (b: Bundle, eventId: string) => Record<string, Array<{ team: { id: string } }>>

/** The printed pairs of a knockout plan. Once every group game is finished and the groups tables
 *  are given, this is the draw as it was really made (after the same-pool runner-up swap), so a
 *  bracket label never disagrees with who actually plays. Labels only: no team or score is touched. */
export function drawnPairs(b: Bundle, eventId: string, plan: KoPlan, tables?: GroupTables): Array<[string, string]> {
  if (!tables) return plan.pairs
  const grp = b.matches.filter(x => x.event_id === eventId && x.bracket_key == null)
  if (!grp.length || grp.some(x => x.status !== 'finished')) return plan.pairs
  return planDraw(plan, tables(b, eventId) as any).tokens
}

/** What goes in an empty slot before its team is known: "Group A winner",
 *  "Winner QF1", "Loser SF2". Only used when bracket_preview is on. Matches
 *  the fixed draw seedBracket() writes when one team per group advances. */
export function koSlotLabel(b: Bundle, ev: EventCfg, m: Match, slot: 'a' | 'b', tables?: GroupTables): string {
  const ko = b.matches.filter(x => x.event_id === ev.id && x.bracket_key != null)
  const winFeed = ko.find(x => x.next_match_id === m.id && x.next_slot === slot)
  if (winFeed) return `Winner ${koShort(b, winFeed)}`
  const loseFeed = ko.find(x => x.loser_match_id === m.id && x.loser_slot === slot)
  if (loseFeed) return `Loser ${koShort(b, loseFeed)}`
  // first round: seeded straight from the groups
  const first = /^KO-(\d+)-(\d+)$/.exec(m.bracket_key ?? '')
  if (!first) return 'TBD'
  const size = Number(first[1]), j = Number(first[2])
  // printed knockout plan (MCMD / MCXD fundraiser)
  const plan = koPlanOf(b.competition?.code)
  if (plan) { const tk = drawnPairs(b, ev.id, plan, tables)[j]; return tk ? slotName(tk[slot === 'a' ? 0 : 1]) : 'TBD' }
  const groups = [...new Set(b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
  const adv = ev.advance_per_group ?? 1
  if (adv === 1) {
    const seedNo = standardSeedOrder(size)[j * 2 + (slot === 'a' ? 0 : 1)]
    const g = groups[seedNo - 1]
    return g ? `Group ${g} winner` : 'Advances'
  }
  // the exact draw seedBracket() will write, with "Group X #n" placeholders
  const placeholders = groups.map(g => Array.from({ length: adv }, (_, i) => `Group ${g} #${i + 1}`))
  const pair = seedBracket(placeholders, size)[j]
  return pair?.[slot === 'a' ? 0 : 1] ?? 'Advances'
}

// ------------------------------------------------------------ random groups
/** A random permutation of the event's teams: slot team -> team whose name,
 *  players and logo move into that slot. Fixtures stay put, so this is a
 *  fresh random group draw without rebuilding the schedule. */
export function shuffleMap(teamIds: string[], rng: () => number = Math.random): Array<{ slot: string; src: string }> {
  const src = teamIds.slice()
  for (let i = src.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[src[i], src[j]] = [src[j], src[i]]
  }
  return teamIds.map((slot, i) => ({ slot, src: src[i] }))
}

/** Allowed only while nothing in the event has been scored. */
export const eventUntouched = (b: Bundle, eventId: string): boolean =>
  !b.matches.some(m => m.event_id === eventId && (m.status === 'finished' || m.score_a > 0 || m.score_b > 0))

// ------------------------------------------------------------ play clock
export function fmtClock(sec: number | null | undefined): string {
  if (sec == null || sec < 0) return '–'
  const m = Math.floor(sec / 60), s = Math.floor(sec % 60)
  return `${m}:${String(s).padStart(2, '0')}`
}

// ------------------------------------------------------------ ranking
export interface RankRow { team: Team; won: number; diff: number; pf?: number; tieGroup?: number | null }

/** tiebreak = 'diff' (migration 0026): wins → point difference (points won
 *  minus points lost, all group games) → head-to-head wins among the teams
 *  still level → coin toss. Teams level after head-to-head get the same
 *  `tieGroup` number so the admin can settle it with a toss. */
export function rankByDiff<S extends RankRow>(rows: S[], done: Match[], h2h = true): S[] {
  // 'diff_only' (printed plan): points scored is the third criterion, before the coin toss
  const pf = (r: S) => (h2h ? 0 : r.pf ?? 0)
  // fully level teams: always the same order on every screen (by name) until the organiser settles it
  const sorted = rows.slice().sort((a, z) => z.won - a.won || z.diff - a.diff || pf(z) - pf(a)
    || String(a.team.name ?? '').localeCompare(String(z.team.name ?? '')) || String(a.team.id).localeCompare(String(z.team.id)))
  const out: S[] = []
  let tieNo = 0
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j < sorted.length && sorted[j].won === sorted[i].won && sorted[j].diff === sorted[i].diff && pf(sorted[j]) === pf(sorted[i])) j++
    const level = sorted.slice(i, j)
    if (level.length === 1) { out.push({ ...level[0], tieGroup: null }); i = j; continue }
    const ids = new Set(level.map(r => r.team.id))
    const h2hWins = new Map<string, number>(level.map(r => [r.team.id, 0]))
    for (const m of h2h ? done : []) {
      if (!ids.has(m.team_a_id!) || !ids.has(m.team_b_id!)) continue
      const w = m.score_a > m.score_b ? m.team_a_id! : m.team_b_id!
      h2hWins.set(w, (h2hWins.get(w) ?? 0) + 1)
    }
    level.sort((a, z) => h2hWins.get(z.team.id)! - h2hWins.get(a.team.id)!)
    for (let k = 0; k < level.length;) {
      let l = k
      while (l < level.length && h2hWins.get(level[l].team.id) === h2hWins.get(level[k].team.id)) l++
      const still = l - k > 1
      if (still) tieNo++
      for (let q = k; q < l; q++) out.push({ ...level[q], tieGroup: still ? tieNo : null })
      k = l
    }
    i = j
  }
  return out
}

/** One word for the group stage everywhere: "Group A · Leg 1" / "Round Robin" -> "Group A · Round robin". */
/** The group a round-robin game belongs to, from its teams (the stored label can be stale after games were swapped). */
export function groupRound(b: Bundle, m: Match): string {
  if (m.bracket_key != null || m.tie_stage || m.tie_id) return roundName(m.round)
  const pa = b.teams.find(t => t.id === m.team_a_id)?.pool, pb = b.teams.find(t => t.id === m.team_b_id)?.pool
  if (pa && pa === pb && pa !== '—' && /^group\s/i.test(m.round ?? '')) return `Group ${pa} · Round robin`
  return roundName(m.round)
}
export const roundName = (r?: string | null): string => (r ?? '').replace(/\bleg\s*\d+/i, 'Round robin').replace(/round\s*robin/i, 'Round robin')

/** Status for a court card header: "ROUND ROBIN", "QF 2", "SF 1",
 *  "3RD PLACE", "FINAL". `kind` picks the glow colour. */
export function stageLabel(b: Bundle, m: Match): { text: string; kind: 'group' | 'ko' | 'final' } {
  if (m.bracket_key != null) {
    if (m.round === 'Final') return { text: (b.events.find(e => e.id === m.event_id)?.final_best_of ?? 1) > 1 ? `FINAL · G${finalGameNo(m)}` : 'FINAL', kind: 'final' }
    if (m.round === 'Third place') return { text: '3RD PLACE', kind: 'ko' }
    if (m.round === 'Semi-final') return { text: 'SEMI FINAL', kind: 'ko' }
    const rn = /^Round of (\d+)$/.exec(m.round ?? '')
    if (rn) return { text: `R${rn[1]} · ${koShort(b, m).split('-').pop()}`, kind: 'ko' }   // "R16 · 3"
    return { text: koShort(b, m).replace(/(\D+)(\d+)/, '$1 $2'), kind: 'ko' }   // "QF 4"
  }
  // every group game reads "ROUND ROBIN" (old rows said "Group A · Leg 1")
  const r = (m.round ?? '').replace(/\s+/g, ' ').trim()
  if (/round\s*robin|leg\s*\d+/i.test(r)) return { text: 'ROUND ROBIN', kind: 'group' }
  return { text: (r.replace(/^group\s+/i, '') || 'GROUP').toUpperCase(), kind: 'group' }
}

// ------------------------------------------------- referee: pick another game
/** Games a court's referee may play instead of the one on court (migration
 *  0040): still waiting, both teams known, on this court's own list. `busy`
 *  = a team of that game is on another court right now (cannot be picked). */
export function courtChoices(b: Bundle, courtId: string, curId?: string | null): Array<{ m: Match; busy: string | null }> {
  const on = b.matches.filter(x => BUSY.has(x.status) && x.id !== curId)
  return b.matches
    .filter(m => m.status === 'scheduled' && m.id !== curId && m.team_a_id && m.team_b_id
      && (m.court_id === courtId || (m.court_id == null && m.home_court === courtId)))
    .sort((x, y) => x.sequence - y.sequence)
    .map(m => {
      const clash = on.find(x => [x.team_a_id, x.team_b_id].some(t => t === m.team_a_id || t === m.team_b_id))
      const t = clash ? [m.team_a_id, m.team_b_id].find(id => id === clash.team_a_id || id === clash.team_b_id) ?? null : null
      return { m, busy: t }
    })
}

/** "Group A · Slot 3", "QF 2", "Final": what a referee or player calls this game. */
/** Which stage a game is, in words: "Round robin", "Quarter-final 1", "Semi-final 2", "3rd place", "Final". */
export function stageName(b: Bundle, m: Match): string {
  if (m.bracket_key != null) {
    const k = koShort(b, m)
    const x = /^(QF|SF|PO)(\d+)$/.exec(k)
    if (x) return `${x[1] === 'QF' ? 'Quarter-final' : x[1] === 'SF' ? 'Semi-final' : 'Playoff'} ${x[2]}`
    const r = /^R(\d+)-(\d+)$/.exec(k)
    if (r) return `Round of ${r[1]} · ${r[2]}`
    return k
  }
  if (m.tie_stage) return m.game_label ?? m.round ?? 'Game'
  return 'Round robin'
}

/** Short code on the bracket: "QF1", "SF2", "Final", "3rd place". */
export const koCode = (b: Bundle, m: Match): string => koShort(b, m).replace(/^R(\d+)-/, 'R$1 · ')

/** A stage for a whole time slot (plural): "Round robin", "Quarter-finals", "Semi-finals", "Final". */
export function slotStage(b: Bundle, ms: Match[]): string {
  const words = ms.map(m => m.bracket_key == null && !m.tie_stage ? 'Round robin'
    : m.round === 'Quarter-final' ? 'Quarter-finals' : m.round === 'Semi-final' ? 'Semi-finals'
    : m.round === 'Playoff' ? 'Playoffs' : m.round === 'Third place' ? '3rd place' : m.round === 'Final' ? 'Final'
    : /^Round of \d+$/.test(m.round ?? '') ? m.round! : stageName(b, m))
  return [...new Set(words)].join(' · ')
}

export function gameTitle(b: Bundle, m: Match): string {
  if (m.bracket_key != null) return stageName(b, m)
  if (m.tie_stage) return m.game_label ?? m.round ?? 'Game'
  const pool = b.teams.find(t => t.id === m.team_a_id)?.pool
  const base = pool && pool !== '—' ? `Round robin · Group ${pool}` : (m.round ?? 'Round robin')
  return m.game_label ? `${base} · ${m.game_label}` : m.slot != null ? `${base} · Slot ${m.slot}` : base
}

/** Printed plan, first knockout round: the fixed slot, e.g. "Group A winner v Best runner-up 3". */
export function planCaption(b: Bundle, m: Match, tables?: GroupTables): string | null {
  const plan = koPlanOf(b.competition?.code)
  const j = plan ? new RegExp(`^KO-${plan.pairs.length * 2}-(\\d+)$`).exec(m.bracket_key ?? '') : null
  if (!plan || !j) return null
  const tk = drawnPairs(b, m.event_id, plan, tables)[Number(j[1])]
  return tk ? `${slotName(tk[0])} v ${slotName(tk[1])}` : null
}

/** Bracket box caption: the game code always, plus the printed slot for the first round. "QF1 · Group A winner v Best runner-up 3", "SF1". */
export function bracketCaption(b: Bundle, m: Match, tables?: GroupTables): string | null {
  if (m.bracket_key == null) return null
  const pc = planCaption(b, m, tables)
  return pc ? `${koCode(b, m)} · ${pc}` : koCode(b, m)
}

/** A group place already decided (that group has finished) before the whole draw is written:
 *  the bracket shows the team in its fixed slot straight away. Best runners-up wait for every group. */
export function provisionalTeam(b: Bundle, ev: EventCfg, m: Match, s: 'a' | 'b',
  tables: (b: Bundle, eventId: string) => Record<string, Array<{ team: { id: string } }>>): string | null {
  const plan = koPlanOf(b.competition?.code)
  const j = plan ? new RegExp(`^KO-${plan.pairs.length * 2}-(\\d+)$`).exec(m.bracket_key ?? '') : null
  if (!plan || !j || ev.format !== 'groups_ko') return null
  if ((s === 'a' ? m.team_a_id : m.team_b_id) != null) return null
  const tk = plan.pairs[Number(j[1])]?.[s === 'a' ? 0 : 1]
  const g = tk ? /^([A-VX-Z])(\d)$/.exec(tk) : null
  if (!g || g[1] === 'R' || g[1] === 'W') return null
  const pool = g[1]
  const games = b.matches.filter(x => x.event_id === ev.id && x.bracket_key == null && !x.tie_stage
    && b.teams.some(t => t.pool === pool && (t.id === x.team_a_id || t.id === x.team_b_id)))
  if (!games.length || games.some(x => x.status !== 'finished')) return null
  return tables(b, ev.id)[pool]?.[Number(g[2]) - 1]?.team.id ?? null
}

/** Where a "Winner QF1" place really comes from, so nobody has to trace the lines:
 *  from a quarter-final: "Group A winner v Best runner-up 3"; from a later round: "QF1 v QF2". */
export function feedHint(b: Bundle, m: Match, slot: 'a' | 'b', tables?: GroupTables): string | null {
  const ko = b.matches.filter(x => x.event_id === m.event_id && x.bracket_key != null)
  const f = ko.find(x => x.next_match_id === m.id && x.next_slot === slot) ?? ko.find(x => x.loser_match_id === m.id && x.loser_slot === slot)
  if (!f) return null
  const pc = planCaption(b, f, tables)
  if (pc) return pc
  const feeders = ko.filter(x => x.next_match_id === f.id).sort((x, y) => (x.next_slot ?? '').localeCompare(y.next_slot ?? ''))
  return feeders.length === 2 ? `${koCode(b, feeders[0])} v ${koCode(b, feeders[1])}` : null
}
