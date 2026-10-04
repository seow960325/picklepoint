/** Multi-sport competitions (opt-in per competition — see migration 0023).
 *  Nothing in here runs for a competition whose `multi_sport` flag is off.
 *
 *  A "tie" is one team-vs-team meeting made of several games (MD1, MD2, XD
 *  for 6-player teams; MD, XD for 4-player teams). Every game is an ordinary
 *  match row scored by the normal engine; games of one tie share `tie_id`.
 *  Team points: +1 per game won, +1 bonus for winning every game of a tie. */
import type { Bundle, EventCfg, Match, Team } from './types'
import { buildDraw, type DraftMatch, type DraftTeam } from './draw.ts'

export type Sport = 'pickleball' | 'badminton'
export const SPORTS: Sport[] = ['pickleball', 'badminton']
export const SPORT_LABEL: Record<Sport, string> = { pickleball: 'Pickleball', badminton: 'Badminton' }
export const SPORT_ICON: Record<Sport, string> = { pickleball: '🏓', badminton: '🏸' }

export const sportOf = (e?: { sport?: string | null } | null): Sport =>
  e?.sport === 'badminton' ? 'badminton' : 'pickleball'
export const isMultiSport = (b: Bundle): boolean => !!b.competition.multi_sport

/** Group-stage rules from the organiser's sheet. */
export const SPORT_PRESETS: Record<Sport, {
  target_score: number; win_by: number; cap: number; switch_at: number
  serve_mode: 'winner' | 'alternate'
}> = {
  // 21 x 1 rally, first to 21 wins
  pickleball: { target_score: 21, win_by: 1, cap: 21, switch_at: 11, serve_mode: 'winner' },
  // 21 x 1 game, deuce: win by 2
  badminton: { target_score: 21, win_by: 2, cap: 30, switch_at: 11, serve_mode: 'winner' },
}

/** The slice of a bundle that belongs to one sport (events, courts, teams, matches). */
export function sportBundle(b: Bundle, sport: Sport): Bundle {
  const events = b.events.filter(e => sportOf(e) === sport)
  const ids = new Set(events.map(e => e.id))
  return {
    ...b,
    events,
    courts: b.courts.filter(c => sportOf(c) === sport),
    teams: b.teams.filter(t => ids.has(t.event_id)),
    matches: b.matches.filter(m => ids.has(m.event_id)),
  }
}

/** Sports that actually have an event, in display order. */
export const sportsPresent = (b: Bundle): Sport[] =>
  SPORTS.filter(s => b.events.some(e => sportOf(e) === s))

// ---------------------------------------------------------------- draw
export const tieGames = (a?: Team | null, b?: Team | null): string[] =>
  (a?.roster ?? 6) >= 6 && (b?.roster ?? 6) >= 6 ? ['MD1', 'MD2', 'XD'] : ['MD', 'XD']

export interface TieDraftMatch extends DraftMatch { tie: string; game: string }
export interface TieDraftTeam extends DraftTeam { roster: number }

/** Court group a game is played on: a 4-player tie's single MD uses the MD1 courts. */
export const gameGroup = (game: string): string => (game === 'MD' ? 'MD1' : game)

/** Round robin per pool, every fixture expanded into its games.
 *  `courts` is one entry per court (in courtIds order): the game group that
 *  court hosts (MD1 / MD2 / XD) or null for "any game". A game is placed only
 *  on courts of its own group; if no court carries that group it falls back to
 *  every court. A plain number means that many untagged courts. */
export function buildTieDraw(
  teams: TieDraftTeam[], courts: number | Array<string | null>,
): TieDraftMatch[] {
  const groups = typeof courts === 'number' ? Array<string | null>(courts).fill(null) : courts
  if (groups.length < 1) return []
  const fixtures = buildDraw(teams, groups.length)
  const all = groups.map((_, i) => i)
  const next: Record<string, number> = {}
  const out: TieDraftMatch[] = []
  let seq = 1
  fixtures.forEach((f, i) => {
    const games = tieGames(
      { roster: teams[f.aIdx].roster } as Team, { roster: teams[f.bIdx].roster } as Team)
    games.forEach(g => {
      const key = gameGroup(g)
      const mine = all.filter(ci => groups[ci] === key)
      const pool = mine.length ? mine : all
      const n = next[key] ?? 0
      next[key] = n + 1
      out.push({
        ...f, tie: String(i + 1), game: g,
        courtIdx: pool[n % pool.length], sequence: seq++,
        label: `${f.pool} · R${f.round} · ${g}`,
      })
    })
  })
  return out
}

// ------------------------------------------------------------ standings
export interface Tie {
  id: string; pool: string
  a: string | null; b: string | null
  games: Match[]
  aGames: number; bGames: number
  done: boolean
  aPts: number; bPts: number           // games won + sweep bonus (once done)
}

export function tiesOf(b: Bundle, eventId: string): Tie[] {
  const byId = new Map<string, Match[]>()
  for (const m of b.matches) {
    if (m.event_id !== eventId || !m.tie_id) continue
    const l = byId.get(m.tie_id) ?? []
    l.push(m); byId.set(m.tie_id, l)
  }
  const out: Tie[] = []
  byId.forEach((games, id) => {
    games.sort((x, y) => x.sequence - y.sequence)
    const a = games[0].team_a_id, bb = games[0].team_b_id
    let aG = 0, bG = 0
    for (const g of games) {
      if (g.status !== 'finished') continue
      if (g.score_a > g.score_b) aG++; else bG++
    }
    const done = games.every(g => g.status === 'finished')
    out.push({
      id, a, b: bb, games,
      pool: b.teams.find(t => t.id === a)?.pool ?? 'A',
      aGames: aG, bGames: bG, done,
      aPts: aG + (done && aG === games.length ? 1 : 0),
      bPts: bG + (done && bG === games.length ? 1 : 0),
    })
  })
  return out.sort((x, y) => x.games[0].sequence - y.games[0].sequence)
}

export interface TieRow {
  team: Team
  ties: number; tieW: number; tieL: number
  gw: number; gl: number; bonus: number; pts: number
  pf: number; pa: number
}

/** Pool table: points, then tie wins, then game difference, then point difference. */
export function tieStandings(b: Bundle, eventId: string): Record<string, TieRow[]> {
  const rows = new Map<string, TieRow>()
  b.teams.filter(t => t.event_id === eventId).forEach(team => rows.set(team.id, {
    team, ties: 0, tieW: 0, tieL: 0, gw: 0, gl: 0, bonus: 0, pts: 0, pf: 0, pa: 0,
  }))

  for (const t of tiesOf(b, eventId)) {
    const A = rows.get(t.a ?? ''), B = rows.get(t.b ?? '')
    if (!A || !B) continue
    for (const g of t.games) {
      if (g.status !== 'finished') continue
      A.pf += g.score_a; A.pa += g.score_b
      B.pf += g.score_b; B.pa += g.score_a
    }
    A.gw += t.aGames; A.gl += t.bGames
    B.gw += t.bGames; B.gl += t.aGames
    A.pts += t.aGames; B.pts += t.bGames
    if (t.done) {
      A.ties++; B.ties++
      if (t.aGames === t.games.length) { A.bonus++; A.pts++ }
      if (t.bGames === t.games.length) { B.bonus++; B.pts++ }
      if (t.aPts > t.bPts) { A.tieW++; B.tieL++ } else if (t.bPts > t.aPts) { B.tieW++; A.tieL++ }
    }
  }

  const byPool: Record<string, TieRow[]> = {}
  rows.forEach(r => { (byPool[r.team.pool ?? '—'] ??= []).push(r) })
  for (const list of Object.values(byPool)) {
    list.sort((x, y) =>
      y.pts - x.pts || y.tieW - x.tieW ||
      (y.gw - y.gl) - (x.gw - x.gl) || (y.pf - y.pa) - (x.pf - x.pa) ||
      x.team.name.localeCompare(y.team.name))
  }
  return byPool
}

// ------------------------------------------------------ board presentation
/** Which slice of a multi-sport board a viewer is following. */
export type SportView = Sport | 'all'

/** Each sport keeps one colour everywhere on the board, matching its court
 *  art (blue = pickleball court, green = badminton court), so the two crowds
 *  sharing one code can tell at a glance whose courts they are looking at. */
export const SPORT_TONE: Record<Sport, {
  solid: string; text: string; border: string; soft: string; bar: string
}> = {
  pickleball: {
    solid: 'bg-[#5aa9ff] text-[#0a0e17]',
    text: 'text-[#1d5fbf] dark:text-[#7cbcff]',
    border: 'border-[#3b8ff0] dark:border-[#5aa9ff]',
    soft: 'bg-[#5aa9ff]/[0.08]',
    bar: 'bg-[#5aa9ff]',
  },
  badminton: {
    solid: 'bg-[#34d399] text-[#0a0e17]',
    text: 'text-[#047857] dark:text-[#4ee0a8]',
    border: 'border-[#10b981] dark:border-[#34d399]',
    soft: 'bg-[#34d399]/[0.08]',
    bar: 'bg-[#34d399]',
  },
}

const ALIAS: Record<string, SportView> = {
  pickleball: 'pickleball', pickle: 'pickleball', pb: 'pickleball',
  badminton: 'badminton', bm: 'badminton', bd: 'badminton',
  all: 'all', both: 'all',
}
/** `?s=badminton` / `?s=pb` / `?s=all` deep links (one QR per hall). */
export const parseSportView = (v?: string | null): SportView | null =>
  (v && ALIAS[v.trim().toLowerCase()]) || null

const viewKey = (code: string) => `pp.sport.${code.toUpperCase()}`
export function readSportView(code: string): SportView | null {
  try { return parseSportView(localStorage.getItem(viewKey(code))) } catch { return null }
}
export function saveSportView(code: string, v: SportView) {
  try { localStorage.setItem(viewKey(code), v) } catch { /* private mode */ }
}

/** "A · R1 · MD1" -> "Group A · Round 1" */
export function tieStage(round?: string | null): string {
  const p = (round ?? '').split(' · ')
  if (p.length >= 2 && /^R\d+$/.test(p[1])) return `Group ${p[0]} · Round ${p[1].slice(1)}`
  return round ?? ''
}

export type { EventCfg }
