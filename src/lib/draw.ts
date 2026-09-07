/** Draw generation. One implementation, used by both the demo backend and the
 *  Supabase path — the client builds the fixture list and the server just
 *  stores it, so a round robin means the same thing everywhere. */

export interface DraftTeam { name: string; pool: string }
export interface DraftMatch {
  aIdx: number          // index into the team array
  bIdx: number
  round: number         // matches sharing a round can run at the same time
  courtIdx: number
  sequence: number
  pool: string
  label?: string        // display override, e.g. "Pod 1" instead of "Round 1"
}

/** Circle method. Returns rounds of index pairs; a BYE is dropped. */
export function roundRobinPairs(n: number): Array<Array<[number, number]>> {
  if (n < 2) return []
  const idx = Array.from({ length: n }, (_, i) => i)
  if (n % 2) idx.push(-1)                       // -1 is the bye
  const m = idx.length
  const rounds: Array<Array<[number, number]>> = []

  for (let r = 0; r < m - 1; r++) {
    const pairs: Array<[number, number]> = []
    for (let i = 0; i < m / 2; i++) {
      const a = idx[i], b = idx[m - 1 - i]
      if (a !== -1 && b !== -1) pairs.push(r % 2 ? [b, a] : [a, b])
    }
    rounds.push(pairs)
    idx.splice(1, 0, idx.pop()!)                // rotate, holding idx[0]
  }
  return rounds
}

/** Build the full fixture list across pools and spread it over the courts. */
export function buildDraw(teams: DraftTeam[], courtCount: number): DraftMatch[] {
  const pools = [...new Set(teams.map(t => t.pool || 'A'))].sort()

  // per pool, rounds of [globalIdxA, globalIdxB]
  const perPool = pools.map(pool => {
    const members = teams
      .map((t, i) => ({ t, i }))
      .filter(x => (x.t.pool || 'A') === pool)
    return {
      pool,
      rounds: roundRobinPairs(members.length)
        .map(r => r.map(([a, b]) => [members[a].i, members[b].i] as [number, number])),
    }
  })

  // interleave pools round by round so every pool progresses together
  const maxRounds = Math.max(0, ...perPool.map(p => p.rounds.length))
  const out: DraftMatch[] = []
  let seq = 1

  for (let r = 0; r < maxRounds; r++) {
    // matches that can run simultaneously in this round, across all pools
    const slot: Array<{ a: number; b: number; pool: string }> = []
    for (const p of perPool) {
      for (const [a, b] of p.rounds[r] ?? []) slot.push({ a, b, pool: p.pool })
    }
    slot.forEach((s, i) => {
      out.push({
        aIdx: s.a, bIdx: s.b, round: r + 1,
        courtIdx: i % courtCount,
        sequence: seq++,
        pool: s.pool,
      })
    })
  }
  return out
}

// =====================================================================
// Duel format — two sides (countries, companies, colors...) face off.
// Each court hosts one pod: 2 teams from Side A vs 2 teams from Side B,
// playing the 4 cross-games where every Side-A team meets every Side-B
// team once (nobody plays a teammate from their own side). Each game's
// winner scores one point for their SIDE, not their team — the overall
// result is the total games won, summed across every pod.
// =====================================================================

export interface DuelTeam { name: string; side: 'A' | 'B' }

/** Squads must be equal and even so every team pairs into a clean 2v2 pod. */
export function validateDuelSquads(sideACount: number, sideBCount: number): string | null {
  if (sideACount < 2 || sideBCount < 2) return 'Each side needs at least 2 teams.'
  if (sideACount !== sideBCount) return 'Both sides need the same number of teams.'
  if (sideACount % 2 !== 0) return 'Team count per side must be even — 2 teams per court pod.'
  return null
}

/** One pod = 2 Side-A teams (a0, a1) vs 2 Side-B teams (b0, b1), which cross-play
 *  as a0-b0, a1-b1, a0-b1, a1-b0 — matching the standard printed dual-meet sheet. */
export function buildDuelDraw(teams: DuelTeam[], courtCount: number): DraftMatch[] {
  const withIdx = teams.map((t, i) => ({ ...t, i }))
  const aTeams = withIdx.filter(t => t.side === 'A')
  const bTeams = withIdx.filter(t => t.side === 'B')
  const pods = Math.min(Math.floor(aTeams.length / 2), Math.floor(bTeams.length / 2))

  const out: DraftMatch[] = []
  let seq = 1
  for (let p = 0; p < pods; p++) {
    const [a0, a1] = [aTeams[p * 2], aTeams[p * 2 + 1]]
    const [b0, b1] = [bTeams[p * 2], bTeams[p * 2 + 1]]
    const label = `Pod ${p + 1}`
    const games: Array<[typeof a0, typeof b0]> = [[a0, b0], [a1, b1], [a0, b1], [a1, b0]]
    for (const [a, b] of games) {
      out.push({
        aIdx: a.i, bIdx: b.i, round: p + 1,
        courtIdx: p % Math.max(courtCount, 1),
        sequence: seq++, pool: label, label,
      })
    }
  }
  return out
}

/** Side A wins / Side B wins / games tied so far, plus the running point
 *  differential used as the tiebreaker when game-wins are level. */
export interface DuelTally {
  sideAWins: number; sideBWins: number
  sideAPoints: number; sideBPoints: number
  gamesPlayed: number; gamesTotal: number
  leader: 'A' | 'B' | 'tie'
}

/** 11 -> 6, 15 -> 8, 21 -> 11. Players change ends at the halfway point. */
export const defaultSwitchAt = (target: number) => Math.floor(target / 2) + 1

/** Sanity-check a rule set before it reaches the courts. */
export function validateRules(r: {
  target_score: number; win_by: number; cap: number; switch_at: number
}): string | null {
  if (r.target_score < 1) return 'Winning score must be at least 1.'
  if (r.win_by < 1) return 'Win-by must be at least 1.'
  if (r.cap < r.target_score) return 'Cap cannot be lower than the winning score.'
  if (r.cap < r.target_score + r.win_by - 1)
    return `With win-by ${r.win_by}, the cap needs to be at least ${r.target_score + r.win_by - 1}.`
  // 0 means "off" — the organizer turned end-switching off entirely.
  if (r.switch_at !== 0 && (r.switch_at < 1 || r.switch_at > r.target_score))
    return 'Switch-ends score must be between 1 and the winning score.'
  return null
}

// =====================================================================
// Group stage -> knockout ("groups_ko"). FIFA-shaped: teams are drawn at
// random into small groups, every group plays a round robin, and the top
// finishers advance into a single-elimination bracket that ends with a
// third-place playoff and a final.
//
// Deliberately split into two phases in time:
//   1. At creation the teams are known, so we build the group fixtures AND
//      an EMPTY bracket skeleton of the right size, already wired together
//      (winner of KO-8-0 -> slot a of KO-4-0, and so on).
//   2. After the last group match the organizer locks the groups, and the
//      real qualifiers are dropped into the round-one slots.
//
// Nothing below is reachable from the round_robin or duel code paths.
// =====================================================================

export interface GroupKoOptions {
  groupSize?: number         // teams per group (default 4)
  advancePerGroup?: number   // qualifiers per group (default 2)
  thirdPlacePlayoff?: boolean// default true
  rng?: () => number         // injectable for deterministic tests
}

/** A knockout slot is empty at creation; it is filled either by seeding the
 *  bracket from the group tables, or by the winner of an earlier match. */
export interface DraftKoMatch {
  key: string                    // stable handle used to wire links, e.g. 'KO-8-0'
  round: string                  // display label, e.g. 'Quarter-final'
  teamsInRound: number           // 16, 8, 4, 2 — 0 for the third-place playoff
  nextKey: string | null         // where the WINNER goes
  nextSlot: 'a' | 'b' | null
  loserNextKey: string | null    // where the LOSER goes (semi-finals only)
  loserNextSlot: 'a' | 'b' | null
  courtIdx: number
  sequence: number
}

export interface GroupKoDraw {
  teams: DraftTeam[]        // input order preserved, each tagged with its group
  groupMatches: DraftMatch[]
  bracket: DraftKoMatch[]
  groupCount: number
  qualifiers: number        // groupCount * advancePerGroup
  bracketSize: number       // next power of two >= qualifiers
  byes: number              // bracketSize - qualifiers
}

const GROUP_LETTERS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'

export function nextPowerOfTwo(n: number): number {
  let p = 1
  while (p < n) p *= 2
  return p
}

/** 2 -> Final, 4 -> Semi-final, 8 -> Quarter-final, 16+ -> Round of N. */
export function koRoundName(teamsInRound: number): string {
  if (teamsInRound === 2) return 'Final'
  if (teamsInRound === 4) return 'Semi-final'
  if (teamsInRound === 8) return 'Quarter-final'
  return `Round of ${teamsInRound}`
}

/** Fisher-Yates over a copy. rng defaults to Math.random. */
export function shuffled<T>(items: T[], rng: () => number = Math.random): T[] {
  const out = items.slice()
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    ;[out[i], out[j]] = [out[j], out[i]]
  }
  return out
}

/** Reject rule sets that cannot produce a sane bracket, before anyone books a court. */
export function validateGroupKo(
  teamCount: number, groupSize: number, advancePerGroup: number,
): string | null {
  if (groupSize < 3) return 'Groups need at least 3 teams.'
  if (teamCount < groupSize * 2) return `Need at least ${groupSize * 2} teams to fill two groups.`
  const groupCount = Math.ceil(teamCount / groupSize)
  if (groupCount > GROUP_LETTERS.length) return 'Too many groups — 26 is the maximum.'
  const smallest = Math.floor(teamCount / groupCount)
  if (advancePerGroup < 1) return 'At least one team per group must advance.'
  if (advancePerGroup >= smallest)
    return `Only ${smallest} teams in the smallest group — advancing ${advancePerGroup} would qualify everyone.`
  if (groupCount * advancePerGroup < 2) return 'The bracket needs at least 2 qualifiers.'
  return null
}

/** Random draw into balanced groups. Teams are dealt round-robin across the
 *  groups after shuffling, so group sizes never differ by more than one —
 *  chunking instead would leave a stunted last group. */
export function drawGroups(
  names: string[], groupSize: number, rng: () => number = Math.random,
): DraftTeam[] {
  const groupCount = Math.ceil(names.length / groupSize)
  const order = shuffled(names.map((name, i) => ({ name, i })), rng)
  const out: DraftTeam[] = names.map(name => ({ name, pool: 'A' }))
  order.forEach((t, dealt) => {
    out[t.i] = { name: t.name, pool: GROUP_LETTERS[dealt % groupCount] }
  })
  return out
}

/** The empty bracket. Round one has `bracketSize / 2` matches; every later
 *  round halves. Match j feeds slot (j % 2) of match floor(j / 2) above it. */
export function buildBracketSkeleton(
  bracketSize: number, courtCount: number, startSequence: number,
  thirdPlacePlayoff = true,
): DraftKoMatch[] {
  const out: DraftKoMatch[] = []
  let seq = startSequence
  const courts = Math.max(courtCount, 1)

  for (let size = bracketSize; size >= 2; size /= 2) {
    const games = size / 2
    for (let j = 0; j < games; j++) {
      const isFinal = size === 2
      out.push({
        key: `KO-${size}-${j}`,
        round: koRoundName(size),
        teamsInRound: size,
        nextKey: isFinal ? null : `KO-${size / 2}-${Math.floor(j / 2)}`,
        nextSlot: isFinal ? null : (j % 2 === 0 ? 'a' : 'b'),
        // only the semi-finals feed the third-place playoff
        loserNextKey: size === 4 && thirdPlacePlayoff ? 'KO-3P' : null,
        loserNextSlot: size === 4 && thirdPlacePlayoff ? (j === 0 ? 'a' : 'b') : null,
        courtIdx: j % courts,
        sequence: seq++,
      })
    }
  }

  // Played before the final in real tournaments, so it sits earlier in sequence
  // only by convention; the organizer can move it between courts either way.
  if (thirdPlacePlayoff && bracketSize >= 4) {
    out.push({
      key: 'KO-3P', round: 'Third place', teamsInRound: 0,
      nextKey: null, nextSlot: null, loserNextKey: null, loserNextSlot: null,
      courtIdx: 0, sequence: seq++,
    })
  }
  return out
}

/** Full groups_ko draw: random groups, their round-robin fixtures, and the
 *  empty bracket those groups will feed. */
export function buildGroupKoDraw(
  names: string[], courtCount: number, opts: GroupKoOptions = {},
): GroupKoDraw {
  const groupSize = opts.groupSize ?? 4
  const advancePerGroup = opts.advancePerGroup ?? 2
  const thirdPlacePlayoff = opts.thirdPlacePlayoff ?? true

  const teams = drawGroups(names, groupSize, opts.rng ?? Math.random)
  const groupCount = new Set(teams.map(t => t.pool)).size
  const groupMatches = buildDraw(teams, courtCount)

  const qualifiers = groupCount * advancePerGroup
  const bracketSize = nextPowerOfTwo(qualifiers)
  const bracket = buildBracketSkeleton(
    bracketSize, courtCount, groupMatches.length + 1, thirdPlacePlayoff,
  )

  return {
    teams, groupMatches, bracket, groupCount, qualifiers, bracketSize,
    byes: bracketSize - qualifiers,
  }
}

/** Seeding order for the filled bracket: all group winners first (in group
 *  order), then all runners-up, and so on down the qualifying places. The
 *  better group record seeds higher within a place, so the caller passes each
 *  group's qualifiers already sorted. */
export function seedOrder(qualifiersByGroup: string[][]): string[] {
  const places = Math.max(0, ...qualifiersByGroup.map(g => g.length))
  const out: string[] = []
  for (let place = 0; place < places; place++) {
    for (const group of qualifiersByGroup) {
      const id = group[place]
      if (id) out.push(id)
    }
  }
  return out
}

/** Standard bracket seeding positions, built the way every tournament bracket
 *  is: order(1) = [1], and each doubling mirrors the previous round so that
 *  seed 1 and seed 2 sit in opposite halves and can only meet in the final.
 *  size 8 -> [1,8,4,5,2,7,3,6]. Returns 1-indexed seed numbers. */
export function standardSeedOrder(size: number): number[] {
  let order = [1]
  while (order.length < size) {
    const n = order.length * 2
    const next: number[] = []
    for (const s of order) next.push(s, n + 1 - s)
    order = next
  }
  return order
}

/** Round-one pairings. Seeds are placed at their standard bracket positions,
 *  so a short qualifier list leaves the BOTTOM seeds' opponents empty — which
 *  is exactly right: the byes fall to the top seeds. */
export function bracketPositions(
  seeds: string[], bracketSize: number,
): Array<[string | null, string | null]> {
  const order = standardSeedOrder(bracketSize)
  const at = (pos: number) => seeds[order[pos] - 1] ?? null
  const pairs: Array<[string | null, string | null]> = []
  for (let j = 0; j < bracketSize; j += 2) pairs.push([at(j), at(j + 1)])
  return pairs
}

/** Two teams from the same group should not meet again in round one — they
 *  have just played each other. Reversing the seed list already avoids this
 *  for an even number of groups; an odd number leaves exactly one clash in the
 *  middle, which this swaps out against a neighbouring match. */
export function repairGroupClashes(
  pairs: Array<[string | null, string | null]>,
  groupOf: (teamId: string) => string | undefined,
): Array<[string | null, string | null]> {
  const out = pairs.map(p => [...p] as [string | null, string | null])
  const clash = (p: [string | null, string | null]) =>
    p[0] != null && p[1] != null && groupOf(p[0]) === groupOf(p[1])

  for (let i = 0; i < out.length; i++) {
    if (!clash(out[i])) continue
    for (let k = 0; k < out.length; k++) {
      if (k === i) continue
      const trial = [...out[i]] as [string | null, string | null]
      const other = [...out[k]] as [string | null, string | null]
      ;[trial[1], other[1]] = [other[1], trial[1]]
      if (!clash(trial) && !clash(other)) { out[i] = trial; out[k] = other; break }
    }
  }
  return out
}

/** Convenience: group tables in, round-one pairings out. */
export function seedBracket(
  qualifiersByGroup: string[][], bracketSize: number,
): Array<[string | null, string | null]> {
  const groupOfTeam = new Map<string, string>()
  qualifiersByGroup.forEach((g, i) => g.forEach(id => groupOfTeam.set(id, GROUP_LETTERS[i] ?? String(i))))
  const pairs = bracketPositions(seedOrder(qualifiersByGroup), bracketSize)
  return repairGroupClashes(pairs, id => groupOfTeam.get(id))
}
