/** Opt-in extras for groups_ko events (migration 0026). Every helper here is
 *  a no-op unless the event carries the matching flag, so competitions that
 *  never set them (TEST01, YC2626, MCMC26 …) behave exactly as before.
 *
 *   legs = 2             each pair inside a group meets twice
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

/** Global play order for the shared court queue. Built slot by slot (one slot
 *  = one game on every court): each pick is the fixture whose two teams have
 *  waited longest, so rests stay as even as the numbers allow and nobody plays
 *  twice in a row. A team starts its second leg only after finishing its
 *  first. The first `courtCount` games are placed on courts; the rest stay
 *  off-court (courtIdx -1) for the dispatcher. */
export function buildPoolSchedule(teams: DraftTeam[], courtCount: number, legs = 2): DraftMatch[] {
  const C = Math.max(1, courtCount)
  const left = groupFixtures(teams, legs)
  const last = new Map<number, number>()        // team -> last slot played
  const played = new Map<number, number>()      // team -> games played
  const perLeg = new Map<number, number>()      // team -> games per leg
  teams.forEach((t, i) => perLeg.set(i, teams.filter(x => (x.pool || 'A') === (t.pool || 'A')).length - 1))

  const out: DraftMatch[] = []
  let slot = 0, seq = 1
  while (left.length) {
    const inSlot = new Set<number>()
    for (let c = 0; c < C && left.length; c++) {
      let best = -1, bestKey: number[] | null = null
      left.forEach((f, idx) => {
        if (inSlot.has(f.a) || inSlot.has(f.b)) return
        const done = (t: number) => played.get(t) ?? 0
        // second leg only once both teams have finished their first
        if (f.leg > 1 && (done(f.a) < perLeg.get(f.a)! * (f.leg - 1) || done(f.b) < perLeg.get(f.b)! * (f.leg - 1))) return
        const rest = (t: number) => slot - (last.get(t) ?? -99)
        const minRest = Math.min(rest(f.a), rest(f.b))
        // higher is better: avoid back-to-back, longest-waiting first,
        // fewer games played first, then the natural fixture order
        const key = [minRest >= 2 ? 1 : 0, Math.min(minRest, 50), -(done(f.a) + done(f.b)), -f.leg, -f.round, -idx]
        if (!bestKey || cmp(key, bestKey) > 0) { best = idx; bestKey = key }
      })
      if (best < 0) break
      const f = left.splice(best, 1)[0]
      inSlot.add(f.a); inSlot.add(f.b)
      last.set(f.a, slot); last.set(f.b, slot)
      played.set(f.a, (played.get(f.a) ?? 0) + 1); played.set(f.b, (played.get(f.b) ?? 0) + 1)
      out.push({
        aIdx: f.a, bIdx: f.b, round: f.leg, pool: f.pool,
        courtIdx: seq <= C ? seq - 1 : -1,
        sequence: seq++,
        label: `Group ${f.pool} · Leg ${f.leg}`,
      })
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

/** Fill every idle court with the next queued match whose two teams are both
 *  free. Mutates the bundle. Twin of _pool_dispatch() in migration 0026. */
export function poolDispatch(b: Bundle, eventId: string): Match[] {
  const placed: Match[] = []
  const courts = b.courts.slice().sort((x, y) => x.number - y.number)
  for (const c of courts) {
    const occupied = b.matches.some(m => m.court_id === c.id
      && (BUSY.has(m.status) || m.status === 'scheduled' || m.status === 'on_deck'))
    if (occupied) continue
    const next = poolQueue(b, eventId).find(m => !teamsBusy(b, m))
    if (!next) break
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
  const tag = m.round === 'Quarter-final' ? 'QF' : m.round === 'Semi-final' ? 'SF' : (m.round ?? 'R')
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
