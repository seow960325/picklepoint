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
export type TieStage = 'SF1' | 'SF2' | '3P' | 'F'
export const STAGE_LABEL: Record<TieStage, string> = {
  SF1: 'Semi-final 1', SF2: 'Semi-final 2', '3P': 'Third place', F: 'Final',
}

/** One discipline of a tie (MD1 / MD2 / XD). A group or semi-final
 *  discipline is a single game; a Final discipline is best of 3 games. */
export interface TieUnit {
  label: string
  sets: Match[]
  aSets: number; bSets: number
  winner: 'a' | 'b' | null
}

export interface Tie {
  id: string; pool: string
  stage: TieStage | null              // null = group-stage tie
  a: string | null; b: string | null
  games: Match[]                      // every match row, in play order
  units: TieUnit[]                    // disciplines
  aGames: number; bGames: number      // disciplines won
  done: boolean                       // every discipline decided
  aPts: number; bPts: number          // group points: disciplines won + sweep bonus (once done)
  winner: string | null               // knockout winner (majority, then points if level)
}

function unitsOf(games: Match[]): TieUnit[] {
  const order: string[] = []
  const map = new Map<string, Match[]>()
  for (const g of games) {
    const k = g.set_no != null ? `L:${g.game_label ?? ''}` : `G:${g.id}`
    if (!map.has(k)) { map.set(k, []); order.push(k) }
    map.get(k)!.push(g)
  }
  return order.map(k => {
    const sets = map.get(k)!.sort((x, y) => (x.set_no ?? 0) - (y.set_no ?? 0) || x.sequence - y.sequence)
    let a = 0, b = 0
    for (const s of sets) {
      if (s.status !== 'finished') continue
      if (s.score_a > s.score_b) a++; else b++
    }
    const bo3 = sets[0].set_no != null
    const winner: 'a' | 'b' | null = bo3
      ? (a >= 2 ? 'a' : b >= 2 ? 'b' : null)
      : (sets[0].status === 'finished' ? (a > b ? 'a' : 'b') : null)
    return { label: sets[0].game_label ?? '', sets, aSets: a, bSets: b, winner }
  })
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
    const units = unitsOf(games)
    const aG = units.filter(u => u.winner === 'a').length
    const bG = units.filter(u => u.winner === 'b').length
    const done = units.every(u => u.winner != null)
    const need = Math.floor(units.length / 2) + 1
    let winner: string | null = aG >= need ? a : bG >= need ? bb : null
    if (!winner && done) {
      // level on disciplines (e.g. 1-1 in a 2-game knockout tie): more points wins
      let pa = 0, pb = 0
      for (const g of games) if (g.status === 'finished') { pa += g.score_a; pb += g.score_b }
      winner = pa > pb ? a : pb > pa ? bb : null
    }
    out.push({
      id, a, b: bb, games, units,
      stage: (games[0].tie_stage ?? null) as TieStage | null,
      pool: b.teams.find(t => t.id === a)?.pool ?? 'A',
      aGames: aG, bGames: bG, done, winner,
      aPts: aG + (done && aG === units.length ? 1 : 0),
      bPts: bG + (done && bG === units.length ? 1 : 0),
    })
  })
  return out.sort((x, y) => x.games[0].sequence - y.games[0].sequence)
}

/** Every tie of a (sport) bundle, group and knockout, across its events. */
export const allTies = (b: Bundle): Tie[] => b.events.flatMap(e => tiesOf(b, e.id))

/** The sport's group-stage event(s) — excludes the Final's rules-only event. */
export const groupEvents = (b: Bundle): EventCfg[] => b.events.filter(e => !e.stage)
export const finalEventOf = (b: Bundle, sport: Sport): EventCfg | undefined =>
  b.events.find(e => e.stage === 'final' && sportOf(e) === sport)

export interface TieRow {
  team: Team
  ties: number; tieW: number; tieL: number
  gw: number; gl: number; bonus: number; pts: number
  pf: number; pa: number
}

/** Pool table: points, then tie wins, then game difference, then point difference.
 *  Knockout ties never count here. */
export function tieStandings(b: Bundle, eventId: string): Record<string, TieRow[]> {
  const rows = new Map<string, TieRow>()
  b.teams.filter(t => t.event_id === eventId).forEach(team => rows.set(team.id, {
    team, ties: 0, tieW: 0, tieL: 0, gw: 0, gl: 0, bonus: 0, pts: 0, pf: 0, pa: 0,
  }))

  for (const t of tiesOf(b, eventId)) {
    if (t.stage) continue
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
      if (t.aGames === t.units.length) { A.bonus++; A.pts++ }
      if (t.bGames === t.units.length) { B.bonus++; B.pts++ }
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

// ------------------------------------------------------------ knockout
/** Group stage finished = every group tie of the event decided. */
export function groupStageDone(b: Bundle, eventId: string): boolean {
  const g = tiesOf(b, eventId).filter(t => !t.stage)
  return g.length > 0 && g.every(t => t.done)
}

export interface SemiSlot { team: Team | null; seed: string }
export interface SemiPlan {
  supported: boolean
  ready: boolean                      // group stage complete -> semis can be drawn
  sf: Array<{ stage: 'SF1' | 'SF2'; a: SemiSlot; b: SemiSlot }>
}

/** Two groups: A1 v B2 and B1 v A2. One group: 1 v 4 and 2 v 3.
 *  Before the groups finish the names are the CURRENT leaders (provisional). */
export function semiPlan(b: Bundle, eventId: string): SemiPlan {
  const pools = tieStandings(b, eventId)
  const keys = Object.keys(pools).sort()
  const at = (k: string, i: number): SemiSlot => ({ team: pools[k]?.[i]?.team ?? null, seed: `${k}${i + 1}` })
  const ready = groupStageDone(b, eventId)
  if (keys.length === 2 && keys.every(k => pools[k].length >= 2)) {
    const [A, B] = keys
    return { supported: true, ready, sf: [
      { stage: 'SF1', a: at(A, 0), b: at(B, 1) },
      { stage: 'SF2', a: at(B, 0), b: at(A, 1) },
    ] }
  }
  if (keys.length === 1 && pools[keys[0]].length >= 4) {
    const k = keys[0]
    const s = (i: number): SemiSlot => ({ team: pools[k][i].team, seed: `#${i + 1}` })
    return { supported: true, ready, sf: [
      { stage: 'SF1', a: s(0), b: s(3) },
      { stage: 'SF2', a: s(1), b: s(2) },
    ] }
  }
  return { supported: false, ready: false, sf: [] }
}

/** Rules the Final is scored with (organiser's sheet): pickleball side-out to
 *  11, badminton to 15; every discipline best of 3. Editable in Settings. */
export const FINAL_PRESETS: Record<Sport, {
  target_score: number; win_by: number; cap: number; switch_at: number
  serve_mode: 'winner' | 'alternate'
}> = {
  pickleball: { target_score: 11, win_by: 2, cap: 21, switch_at: 6, serve_mode: 'alternate' },
  badminton: { target_score: 15, win_by: 2, cap: 21, switch_at: 8, serve_mode: 'winner' },
}

export interface KoGame {
  a: string; b: string; court: string; seq: number
  game: string; set: number | null; round: string
}

/** Every game of one knockout tie, placed on the least-busy court of its
 *  game group (MD1 / MD2 / XD courts; any sport court if none is tagged).
 *  bestOf3 = each discipline is up to 3 games on the same court. */
export function koGames(
  sb: Bundle, stage: TieStage, a: Team, b: Team, opts: { bestOf3?: boolean } = {},
): KoGame[] {
  const courts = [...sb.courts].sort((x, y) => x.number - y.number)
  const load = new Map<string, number>()
  for (const c of courts) load.set(c.id, 0)
  for (const m of sb.matches) {
    if (m.court_id && m.status !== 'finished' && load.has(m.court_id)) {
      load.set(m.court_id, load.get(m.court_id)! + 1)
    }
  }
  const out: KoGame[] = []
  let seq = 0
  for (const g of tieGames(a, b)) {
    const mine = courts.filter(c => c.game_group === gameGroup(g))
    const pool = mine.length ? mine : courts
    if (!pool.length) continue
    const court = pool.reduce((best, c) => (load.get(c.id)! < load.get(best.id)! ? c : best), pool[0])
    const sets = opts.bestOf3 ? [1, 2, 3] : [null]
    for (const s of sets) {
      out.push({
        a: a.id, b: b.id, court: court.id, seq: ++seq, game: g, set: s,
        round: `${STAGE_LABEL[stage]} · ${g}${s ? ` · G${s}` : ''}`,
      })
      load.set(court.id, load.get(court.id)! + 1)
    }
  }
  return out
}

export type SportPhase = 'groups' | 'semis' | 'finals' | 'done'
export interface KoState {
  phase: SportPhase
  sf1?: Tie; sf2?: Tie; third?: Tie; final?: Tie
  champion: string | null; runnerUp: string | null; thirdPlace: string | null
}

/** Where one sport's competition stands, from its own sport bundle. */
export function koState(sb: Bundle): KoState {
  const ties = allTies(sb)
  const pick = (s: TieStage) => ties.find(t => t.stage === s)
  const sf1 = pick('SF1'), sf2 = pick('SF2'), third = pick('3P'), final = pick('F')
  const champion = final?.winner ?? null
  const runnerUp = champion ? (final!.a === champion ? final!.b : final!.a) : null
  const thirdPlace = third?.winner ?? null
  const phase: SportPhase = champion && (!third || thirdPlace) ? 'done'
    : final || third ? 'finals'
    : sf1 || sf2 ? 'semis'
    : 'groups'
  return { phase, sf1, sf2, third, final, champion, runnerUp, thirdPlace }
}

/** Semis decided -> who goes to the Final and who to the 3rd-place tie. */
export function finalsPlan(sb: Bundle): { ready: boolean; final: [string, string] | null; third: [string, string] | null } {
  const k = koState(sb)
  if (!k.sf1?.winner || !k.sf2?.winner) return { ready: false, final: null, third: null }
  const lose = (t: Tie) => (t.winner === t.a ? t.b : t.a)!
  return {
    ready: true,
    final: [k.sf1.winner, k.sf2.winner],
    third: [lose(k.sf1), lose(k.sf2)],
  }
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

/** Heading of a tie card: "Semi-final 1" / "Final" / "Group A · Round 2". */
export const tieTitle = (t: Tie): string => t.stage ? STAGE_LABEL[t.stage] : tieStage(t.games[0]?.round)

/** Court-art label for a knockout game, e.g. "FINAL · MD1 · G2"; undefined otherwise. */
export function koCourtLabel(m: Match): string | undefined {
  if (!m.tie_stage) return undefined
  const st = m.tie_stage === 'F' ? 'FINAL' : m.tie_stage === '3P' ? '3RD' : m.tie_stage
  return [st, m.game_label, m.set_no ? `G${m.set_no}` : null].filter(Boolean).join(' · ')
}

export type { EventCfg }
