/** Opt-in extras for groups_ko events (migration 0026). Every helper here is
 *  a no-op unless the event carries the matching flag, so competitions that
 *  never set them (TEST01, YC2626, MCMC26 …) behave exactly as before.
 *
 *   legs = 1             each pair inside a group meets once (round robin); 2 = twice
 *   court_dispatch=pool  group matches wait OFF-court in one shared queue; a
 *                        court that frees up takes the next match whose two
 *                        teams are both idle (keeps waiting time even)
 *   tiebreak = 'diff'    wins → point difference → head-to-head → coin toss
 *   ko_*                 knockout games use their own scoring rules
 *   play_clock           game time = first point → last point
 *   bracket_preview      the fixed bracket is shown before the groups finish
 *   tv_partner           code of the sister category for the combined TV
 */
import type { Bundle, EventCfg, Match, Team } from './types'
import { roundRobinPairs, standardSeedOrder, type DraftMatch, type DraftTeam } from './draw.ts'

export const isPoolDispatch = (ev?: EventCfg | null) => ev?.court_dispatch === 'pool'

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
          label: legs > 1 ? `Group ${f.pool} · Leg ${f.leg}` : `Group ${f.pool} · Round Robin`,
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
    const free = poolQueue(b, eventId)
      .filter(m => (m.home_court == null || m.home_court === c.id) && !teamsBusy(b, m))
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
const LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

/** Short names for knockout slots: QF1…, SF1…, 'Final', '3rd'. */
export function koShort(b: Bundle, m: Match): string {
  if (m.round === 'Final') return 'Final'
  if (m.round === 'Third place') return '3rd place'
  const same = b.matches.filter(x => x.event_id === m.event_id && x.bracket_key != null && x.round === m.round)
    .sort((x, y) => x.sequence - y.sequence)
  const i = same.findIndex(x => x.id === m.id) + 1
  const rn = /^Round of (\d+)$/.exec(m.round ?? '')
  const tag = m.round === 'Quarter-final' ? 'QF' : m.round === 'Semi-final' ? 'SF' : rn ? `R${rn[1]}-` : (m.round ?? 'R')
  return `${tag}${i}`
}

/** What goes in an empty slot before its team is known: "Group A winner",
 *  "Winner QF1", "Loser SF2". Only used when bracket_preview is on. Matches
 *  the fixed draw seedBracket() writes when one team per group advances. */
export function koSlotLabel(b: Bundle, ev: EventCfg, m: Match, slot: 'a' | 'b'): string {
  const ko = b.matches.filter(x => x.event_id === ev.id && x.bracket_key != null)
  const winFeed = ko.find(x => x.next_match_id === m.id && x.next_slot === slot)
  if (winFeed) return `Winner ${koShort(b, winFeed)}`
  const loseFeed = ko.find(x => x.loser_match_id === m.id && x.loser_slot === slot)
  if (loseFeed) return `Loser ${koShort(b, loseFeed)}`
  // first round: seeded straight from the groups
  const first = /^KO-(\d+)-(\d+)$/.exec(m.bracket_key ?? '')
  if (!first) return 'TBD'
  const size = Number(first[1]), j = Number(first[2])
  const groups = [...new Set(b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
  const adv = ev.advance_per_group ?? 1
  const seedNo = standardSeedOrder(size)[j * 2 + (slot === 'a' ? 0 : 1)]
  if (adv === 1) {
    const g = groups[seedNo - 1]
    return g ? `Group ${g} winner` : 'Bye'
  }
  const place = Math.ceil(seedNo / groups.length)
  const g = groups[(seedNo - 1) % groups.length] ?? LETTERS[(seedNo - 1) % 26]
  return `Group ${g} #${place}`
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
export interface RankRow { team: Team; won: number; diff: number; tieGroup?: number | null }

/** tiebreak = 'diff' (migration 0026): wins → point difference (points won
 *  minus points lost, all group games) → head-to-head wins among the teams
 *  still level → coin toss. Teams level after head-to-head get the same
 *  `tieGroup` number so the admin can settle it with a toss. */
export function rankByDiff<S extends RankRow>(rows: S[], done: Match[]): S[] {
  const sorted = rows.slice().sort((a, z) => z.won - a.won || z.diff - a.diff)
  const out: S[] = []
  let tieNo = 0
  for (let i = 0; i < sorted.length;) {
    let j = i
    while (j < sorted.length && sorted[j].won === sorted[i].won && sorted[j].diff === sorted[i].diff) j++
    const level = sorted.slice(i, j)
    if (level.length === 1) { out.push({ ...level[0], tieGroup: null }); i = j; continue }
    const ids = new Set(level.map(r => r.team.id))
    const h2hWins = new Map<string, number>(level.map(r => [r.team.id, 0]))
    for (const m of done) {
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

/** Status for a court card header: "ROUND ROBIN", "QF 2", "SF 1",
 *  "3RD PLACE", "FINAL". `kind` picks the glow colour. */
export function stageLabel(b: Bundle, m: Match): { text: string; kind: 'group' | 'ko' | 'final' } {
  if (m.bracket_key != null) {
    if (m.round === 'Final') return { text: 'FINAL', kind: 'final' }
    if (m.round === 'Third place') return { text: '3RD PLACE', kind: 'ko' }
    if (m.round === 'Semi-final') return { text: 'SEMI FINAL', kind: 'ko' }
    return { text: koShort(b, m).replace(/(\D+)(\d+)/, '$1 $2'), kind: 'ko' }   // "QF 4"
  }
  // "Group B · Leg 2" -> "LEG 2" (group name is on the game row, not the header)
  const r = (m.round ?? '').replace(/\s+/g, ' ').trim()
  const leg = /leg\s*(\d+)/i.exec(r)
  if (/round\s*robin/i.test(r)) return { text: 'ROUND ROBIN', kind: 'group' }
  return { text: leg ? `LEG ${leg[1]}` : (r.replace(/^group\s+/i, '') || 'GROUP').toUpperCase(), kind: 'group' }
}
