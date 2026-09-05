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
  if (r.switch_at < 1 || r.switch_at > r.target_score)
    return 'Switch-ends score must be between 1 and the winning score.'
  return null
}
