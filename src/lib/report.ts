/** "Download full results": the whole competition as a PDF, or one team's own report
 *  (same design), built in the browser from the data the
 *  front page already has. No server, no cost. Used by the results announcement. */
import type { Bundle, EventCfg, Match, Team } from './types'
import type { Hub } from './hub'
import { hubTitle, catHue } from './hub'
import { groupStandings } from './store'
import { cbStandings } from './captainball'
import { categoryResult, medalTable, needsFourth } from './medals'
import { finalSeries } from './finals'
import { gameTitle, stageName } from './pool'
import { plannedTime, plannedCourt, slotOf } from './timetable'

const dur = (s?: number | null) => (s ? `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}` : '')

export interface Cat { code: string; label: string; b: Bundle }

/** the events of a category that hold its games (YC26 itself: captain ball only) */
const evsOf = (c: Cat, hub: Hub): EventCfg[] =>
  c.b.events.filter(e => (c.code === hub.code && hub.onlySport ? e.sport === hub.onlySport : true) && e.format !== 'duel' && e.stage !== 'final')

const tName = (b: Bundle, id: string | null) => b.teams.find(t => t.id === id)?.name ?? 'TBD'
const players = (t?: Team) => [t?.player1, t?.player2].filter(Boolean).join(' / ')

export interface Row {
  cat: string; time: string; court: string; stage: string; a: string; sa: number; sb: number; bName: string
  winner: string; status: string; secs: number | null; isKo: boolean; m: Match
}

function rowsOf(c: Cat, hub: Hub): Row[] {
  const ids = new Set(evsOf(c, hub).map(e => e.id))
  return c.b.matches.filter(m => ids.has(m.event_id) && (m.team_a_id || m.team_b_id))
    .map(m => {
      const court = plannedCourt(c.b, m)
      return {
        cat: c.label, time: plannedTime(c.b, m), court: court != null ? String(court) : '',
        stage: m.bracket_key != null || m.tie_stage ? stageName(c.b, m) : gameTitle(c.b, m).replace(/ · Slot \d+$/, ''),
        a: tName(c.b, m.team_a_id), sa: m.score_a, sb: m.score_b, bName: tName(c.b, m.team_b_id),
        winner: m.status === 'finished' ? tName(c.b, m.winner_id) : '',
        status: m.status === 'finished' ? 'Finished' : m.status === 'live' ? 'Live' : 'Not played',
        secs: m.duration_seconds ?? null, isKo: m.bracket_key != null || !!m.tie_stage, m,
      }
    })
    // the day in timetable order (slot, then court); games with no slot follow in the order they were played
    .sort((x, y) => (slotOf(c.b, x.m) ?? 999) - (slotOf(c.b, y.m) ?? 999) || (x.m.started_at ?? '9').localeCompare(y.m.started_at ?? '9') || x.m.sequence - y.m.sequence)
}

interface Rec { name: string; pl: string; p: number; w: number; l: number; d: number; pf: number; pa: number; best: number }
function records(c: Cat, rows: Row[]): Rec[] {
  const r = new Map<string, Rec>()
  const get = (id: string) => {
    const t = c.b.teams.find(x => x.id === id)
    if (!r.has(id)) r.set(id, { name: t?.name ?? 'TBD', pl: players(t), p: 0, w: 0, l: 0, d: 0, pf: 0, pa: 0, best: 0 })
    return r.get(id)!
  }
  for (const x of rows) {
    const m = x.m
    if (m.status !== 'finished' || !m.team_a_id || !m.team_b_id) continue
    const A = get(m.team_a_id), B = get(m.team_b_id)
    A.p++; B.p++; A.pf += m.score_a; A.pa += m.score_b; B.pf += m.score_b; B.pa += m.score_a
    A.best = Math.max(A.best, m.score_a); B.best = Math.max(B.best, m.score_b)
    if (m.winner_id === m.team_a_id) { A.w++; B.l++ } else if (m.winner_id === m.team_b_id) { B.w++; A.l++ } else { A.d++; B.d++ }
  }
  return [...r.values()].sort((a, z) => z.w - a.w || (z.pf - z.pa) - (a.pf - a.pa) || z.pf - a.pf || a.name.localeCompare(z.name))
}

/** the report as plain blocks: drawn as a PDF (reportPdf). Column widths are fixed per
 *  kind of table (0 = shares the space left), so every table of a kind lines up exactly. */
type Al = 'right' | 'center'
type Art = 'pickleball' | 'badminton' | 'captainball' | 'star'
/** one game of the bracket: two rows, scores as text (a best-of-3 Final shows games won) */
export interface BoxM {
  code: string; meta: string; a: string; b: string; sa: string; sb: string
  win: 'a' | 'b' | null; ids: Array<string | null>; winId: string | null; note?: string
}
export type Block =
  | { k: 'h1'; t: string; sub: string; arts: Art[] }
  | { k: 'h2'; t: string; sub: string; hue?: 0 | 1 | null; art: Art } | { k: 'h3'; t: string } | { k: 'p'; t: string }
  | { k: 'podium'; items: Array<[string, string, string]> }   // [label, name, small line]: 1st is the hero card
  | { k: 'tiles'; items: Array<[string, string]> }
  | { k: 'bracket'; champion: string | null; final: BoxM; rows: BoxM[][]; third: BoxM | null; /** team marked in the bracket */ hl?: string | null }
  | { k: 'hero'; label: string; name: string; line: string; rank: number | null }
  | { k: 'table'; head: string[]; body: Array<Array<string | number>>; w: number[]; al?: Record<number, Al>
      kv?: boolean; bold?: number[]; /** column holding the winner: drawn in green (red when it says "Lost") */ win?: number
      /** body row to highlight (the team of a team report) */ hl?: number }
const plus = (n: number) => (n > 0 ? `+${n}` : String(n))
const R = (...i: number[]): Record<number, Al> => Object.fromEntries(i.map(x => [x, 'right' as Al]))
const sportOf = (c: Cat, hub: Hub): Art => hub.cats.find(x => x.code === c.code)?.sport ?? 'pickleball'
const SPORT_NAME: Record<Art, string> = { pickleball: 'Pickleball', badminton: 'Badminton', captainball: 'Captain Ball', star: '' }
/** a game length the clock really measured (a court left open for an hour is not a game length) */
const realSecs = (r: Row) => !!r.secs && r.secs > 60 && r.secs <= 2400

/** The knockout as a pyramid (champion on top, then Final, semi-finals, quarter-finals / playoffs); null = no bracket to draw. */
function bracketOf(c: Cat, ev: EventCfg): Block | null {
  const b = c.b
  const bm = (m: Match, code: string): BoxM => {
    const court = plannedCourt(b, m), fin = m.status === 'finished', on = fin || m.status === 'live'
    return {
      code, meta: [plannedTime(b, m), court != null ? `Court ${court}` : ''].filter(Boolean).join('  |  '),
      a: tName(b, m.team_a_id), b: tName(b, m.team_b_id), sa: on ? String(m.score_a) : '', sb: on ? String(m.score_b) : '',
      win: fin ? (m.winner_id === m.team_a_id ? 'a' : m.winner_id === m.team_b_id ? 'b' : null) : null,
      ids: [m.team_a_id, m.team_b_id], winId: fin ? m.winner_id : null,
    }
  }
  const own = b.matches.filter(m => m.event_id === ev.id)
  let final: BoxM | null = null, third: BoxM | null = null, rows: BoxM[][] = []
  if (ev.sport === 'captainball') {
    const st = (k: string) => own.find(m => m.tie_stage === k)
    const f = st('F'); if (!f) return null
    final = bm(f, 'FINAL')
    rows = [[['SF1', 'SEMI-FINAL 1'], ['SF2', 'SEMI-FINAL 2']], [['P1', 'PLAYOFF 1'], ['P2', 'PLAYOFF 2']]]
      .map(r => r.map(([k, n]) => [st(k), n] as const).filter(x => x[0]).map(([m, n]) => bm(m!, n)))
    const p3 = st('3P'); third = p3 ? bm(p3, '3RD PLACE') : null
  } else {
    const ko = own.filter(m => m.bracket_key != null)
    if (ko.some(m => /^KO-(16|32|64)-/.test(m.bracket_key!))) return null
    const fs = finalSeries(b, ev.id); if (!fs) return null
    final = bm(fs.games[0], fs.bestOf > 1 ? `FINAL  ·  BEST OF ${fs.bestOf}` : 'FINAL')
    if (fs.bestOf > 1) {
      const played = fs.games.filter(g => g.status === 'finished')
      final = { ...final, sa: String(fs.aWins), sb: String(fs.bWins), win: fs.winner ? (fs.winner === fs.a ? 'a' : 'b') : null, winId: fs.winner,
        note: played.length ? `Games:  ${played.map(g => `${g.score_a}-${g.score_b}`).join('   ')}` : undefined }
    }
    const round = (n: number, tag: string) => ko.filter(m => new RegExp(`^KO-${n}-\\d+$`).test(m.bracket_key!))
      .sort((x, y) => x.bracket_key!.localeCompare(y.bracket_key!)).map((m, i) => bm(m, `${tag}${i + 1}`))
    rows = [round(4, 'SF'), round(8, 'QF')]
    const p3 = ko.find(m => m.bracket_key === 'KO-3P'); third = p3 ? bm(p3, '3RD PLACE') : null
  }
  rows = rows.filter(r => r.length)
  return { k: 'bracket', champion: final.win ? (final.win === 'a' ? final.a : final.b) : null, final, rows, third }
}

const banner = (c: Cat, hub: Hub): Block => {
  const art = sportOf(c, hub)
  return { k: 'h2', t: c.label.replace(new RegExp(`^${SPORT_NAME[art]}\\s+`, 'i'), '') || c.label, sub: SPORT_NAME[art].toLowerCase() === c.label.toLowerCase() ? '' : SPORT_NAME[art], hue: catHue(c.label), art }
}
const bracketFor = (c: Cat, hub: Hub): Extract<Block, { k: 'bracket' }> | null => {
  for (const ev of evsOf(c, hub)) { const b = bracketOf(c, ev); if (b) return b as Extract<Block, { k: 'bracket' }> }
  return null
}

function catBlocks(c: Cat, hub: Hub, out: Block[]) {
  const rows = rowsOf(c, hub)
  const done = rows.filter(r => r.m.status === 'finished')
  const p = categoryResult(c.b).podium
  out.push(banner(c, hub))
  const pod = [['Champion', p.first], ['Runner-up', p.second], ['3rd place', p.third], ['4th place', p.fourth ?? null]]
    .filter(([, n]) => n) as Array<[string, string]>
  if (pod.length) out.push({ k: 'podium', items: pod.map(([k, n]) => {
    const pl = players(c.b.teams.find(x => x.name === n))
    return [k, n, pl && pl !== n ? pl : '']
  }) })
  else out.push({ k: 'p', t: 'Final placings not decided yet.' })
  // how the podium came about: the knockout sits right under it
  const bracket = bracketFor(c, hub)
  if (bracket) out.push(bracket)

  const pts = done.reduce((s, r) => s + r.sa + r.sb, 0)
  const margin = (r: Row) => Math.abs(r.sa - r.sb)
  // every game that shares the top value is listed (e.g. all the 15-14 games), not just one
  const top = (list: Row[], val: (r: Row) => number): Row[] => {
    if (!list.length) return []
    const best = Math.max(...list.map(val))
    return list.filter(r => val(r) === best)
  }
  const big = top(done, margin), close = top(done, r => -margin(r)), high = top(done, r => r.sa + r.sb)
  const timed = done.filter(realSecs)
  const avg = timed.length ? Math.round(timed.reduce((s, r) => s + r.secs!, 0) / timed.length) : 0
  const long = top(timed, r => r.secs!)
  const st = (r?: Row) => r?.stage ?? ''
  const fig = (label: string, list: Row[]): string[][] =>
    list.map((r, i) => [i === 0 ? label : '', r.a, `${r.sa} - ${r.sb}`, r.bName, st(r)])
  out.push({ k: 'h3', t: 'Key figures' }, { k: 'tiles', items: [
    ['Teams', String(c.b.teams.filter(t => evsOf(c, hub).some(e => e.id === t.event_id)).length)],
    ['Games played', `${done.length} / ${rows.length}`],
    ['Total points', String(pts)],
    ['Avg points / game', done.length ? (pts / done.length).toFixed(1) : '-'],
    ...(avg ? [['Avg game length', dur(avg)] as [string, string]] : []),
  ] }, { k: 'table', kv: true, head: ['', '', '', '', ''], w: [116, 0, 46, 0, 112], al: { 1: 'right', 2: 'center' }, bold: [2], body: [
    ...fig(`Biggest win${big[0] ? ` (by ${margin(big[0])})` : ''}`, big),
    ...fig(`Closest game${close[0] ? ` (by ${margin(close[0])})` : ''}`, close),
    ...fig(`Highest-scoring${high[0] ? ` (${high[0].sa + high[0].sb} pts)` : ''}`, high),
    ...fig(`Longest game${long[0] ? ` (${dur(long[0].secs)})` : ''}`, long),
  ] })

  for (const ev of evsOf(c, hub)) {
    if (ev.sport === 'captainball') {
      const pools = [...new Set(c.b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
      for (const pl of pools) {
        const t = cbStandings(c.b, ev.id, pl)
        if (t.length) out.push({ k: 'h3', t: `Group ${pl}` }, { k: 'table', head: ['#', 'Team', 'Played', 'Won', 'Drawn', 'Lost', 'Scored', 'Conceded', '+/-', 'Points'],
          w: [24, 0, 40, 34, 38, 34, 42, 52, 36, 42], al: R(0, 2, 3, 4, 5, 6, 7, 8, 9), bold: [1, 9],
          body: t.map((r, i) => [i + 1, r.team.name, r.p, r.w, r.d, r.l, r.pf, r.pa, plus(r.diff), r.pts]) })
      }
    } else if (ev.format === 'groups_ko') {
      const gt = groupStandings(c.b, ev.id)
      // the Players column only when teams carry player names of their own (else the team name already is the pair)
      const withPl = Object.values(gt).flat().some(r => players(r.team) && players(r.team) !== r.team.name)
      for (const k of Object.keys(gt).sort())
        out.push({ k: 'h3', t: `Group ${k}` }, withPl
          ? { k: 'table', head: ['#', 'Team', 'Players', 'Played', 'Won', 'Lost', 'Scored', 'Conceded', '+/-'],
            w: [24, 130, 0, 40, 34, 34, 42, 52, 36], al: R(0, 3, 4, 5, 6, 7, 8), bold: [1],
            body: gt[k].map((r, i) => [i + 1, r.team.name, players(r.team) || r.team.name, r.played, r.won, r.lost, r.pf, r.pa, plus(r.diff)]) }
          : { k: 'table', head: ['#', 'Team', 'Played', 'Won', 'Lost', 'Scored', 'Conceded', '+/-'],
            w: [24, 0, 40, 34, 34, 42, 52, 36], al: R(0, 2, 3, 4, 5, 6, 7), bold: [1],
            body: gt[k].map((r, i) => [i + 1, r.team.name, r.played, r.won, r.lost, r.pf, r.pa, plus(r.diff)]) })
    }
  }
  const sc = (r: Row) => (r.m.status === 'scheduled' ? '-' : `${r.sa} - ${r.sb}`)
  const stg = (r: Row) => r.stage.replace(/^Round robin · /, '')
  const GW = [82, 50, 36, 0, 50, 0, 0], GA: Record<number, Al> = { 2: 'center', 3: 'right', 4: 'center' }
  const GH = ['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Winner']
  const game = (r: Row) => [stg(r), r.time, r.court, r.a, sc(r), r.bName, r.winner || (r.m.status === 'finished' ? 'Draw' : r.status)]
  const ko = rows.filter(r => r.isKo).sort((x, y) => x.m.sequence - y.m.sequence)
  if (!bracket && ko.length) out.push({ k: 'h3', t: 'Knockout' }, { k: 'table', head: GH, w: GW, al: GA, bold: [4], win: 6, body: ko.map(game) })
  const rec = records(c, rows)
  out.push({ k: 'h3', t: 'Team records (all games)' }, { k: 'table', head: ['#', 'Team', 'Played', 'Won', 'Lost', 'Scored', 'Conceded', '+/-', 'Win %'],
    w: [24, 0, 40, 34, 34, 42, 52, 36, 40], al: R(0, 2, 3, 4, 5, 6, 7, 8), bold: [1],
    body: rec.map((r, i) => [i + 1, r.name, r.p, r.w, r.l, r.pf, r.pa, plus(r.pf - r.pa), r.p ? `${Math.round((r.w / r.p) * 100)}%` : '-']) })
  out.push({ k: 'h3', t: 'All games' }, { k: 'table', head: GH, w: GW, al: GA, bold: [4], win: 6, body: rows.map(game) })
}

const dateOf = (cats: Cat[]) => cats.find(c => c.b.competition.event_date)?.b.competition.event_date ?? ''

export function reportBlocks(hub: Hub, cats: Cat[]): Block[] {
  const title = hubTitle(hub, cats.map(c => c.b.competition.name))
  const when = dateOf(cats)
  const out: Block[] = [{ k: 'h1', t: title, arts: [...new Set(cats.map(c => sportOf(c, hub)))],
    sub: `Full results & analysis${when ? `  |  ${new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` }]
  if (!hub.noChurch) {
    const res = cats.map(c => categoryResult(c.b))
    const mt = medalTable(res, cats.map(c => c.b))
    const four = needsFourth(mt)
    const top3 = mt.filter(r => r.gold + r.silver + r.bronze > 0).slice(0, 3)
    out.push({ k: 'h2', t: 'Total Champion', sub: 'Church v church', art: 'star' })
    if (top3.length) out.push({ k: 'podium', items: top3.map((r, i) =>
      [['Total Champion', '2nd overall', '3rd overall'][i], r.name, `${r.gold} gold · ${r.silver} silver · ${r.bronze} bronze`] as [string, string, string]) },
      { k: 'h3', t: 'Medal table' })
    out.push({ k: 'table', head: ['#', 'Church', 'Gold', 'Silver', 'Bronze', ...(four ? ['4th'] : [])],
      w: [24, 0, 60, 60, 60, ...(four ? [60] : [])], al: R(0, 2, 3, 4, 5), bold: [1],
      body: mt.map((r, i) => [i + 1, r.name, r.gold, r.silver, r.bronze, ...(four ? [r.fourth] : [])]) },
    { k: 'h3', t: 'Category winners' }, { k: 'table', head: ['Category', 'Champion', 'Runner-up', '3rd place'], w: [120, 0, 0, 0], bold: [1],
      body: res.map((r, i) => [cats[i].label, r.podium.first ?? '-', r.podium.second ?? '-', r.podium.third ?? '-']) })
  }
  for (const c of cats) catBlocks(c, hub, out)
  return out
}

/** The teams of a category, for the "My team" picker. */
export const teamsOf = (c: Cat, hub: Hub): Team[] => {
  const ids = new Set(evsOf(c, hub).map(e => e.id))
  return c.b.teams.filter(t => ids.has(t.event_id)).sort((a, z) => (a.pool ?? '').localeCompare(z.pool ?? '') || a.name.localeCompare(z.name))
}

const ord = (n: number) => `${n}${n % 10 === 1 && n % 100 !== 11 ? 'st' : n % 10 === 2 && n % 100 !== 12 ? 'nd' : n % 10 === 3 && n % 100 !== 13 ? 'rd' : 'th'}`

/** One team's own report: where it finished, its numbers, the bracket with it marked, its group, every game it played and the teams it met. */
export function teamBlocks(hub: Hub, c: Cat, teamId: string): Block[] {
  const team = c.b.teams.find(t => t.id === teamId)
  if (!team) return []
  const title = hubTitle(hub, [c.b.competition.name])
  const when = c.b.competition.event_date ?? ''
  const out: Block[] = [{ k: 'h1', t: title, arts: [sportOf(c, hub)],
    sub: `Team report${when ? `  |  ${new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` }]
  out.push(banner(c, hub))
  const all = rowsOf(c, hub)
  const mine = all.filter(r => r.m.team_a_id === teamId || r.m.team_b_id === teamId)
  const sideA = (r: Row) => r.m.team_a_id === teamId
  const us = (r: Row) => (sideA(r) ? r.sa : r.sb), them = (r: Row) => (sideA(r) ? r.sb : r.sa)
  const oppId = (r: Row) => (sideA(r) ? r.m.team_b_id : r.m.team_a_id)
  const oppName = (r: Row) => (sideA(r) ? r.bName : r.a)
  const done = mine.filter(r => r.m.status === 'finished')
  const res = (r: Row) => r.m.status !== 'finished' ? (r.m.status === 'live' ? 'Live' : 'Not played')
    : r.m.winner_id === teamId ? 'Won' : r.m.winner_id ? 'Lost' : 'Draw'

  // where the team finished
  const evs = evsOf(c, hub)
  const groupOf = (id: string | null): { pool: string; pos: number; rows: Array<{ team: Team; cells: Array<string | number> }>; cb: boolean } | null => {
    for (const ev of evs) {
      if (ev.sport === 'captainball') {
        const pools = [...new Set(c.b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
        for (const pl of pools) {
          const t = cbStandings(c.b, ev.id, pl), i = t.findIndex(r => r.team.id === id)
          if (i >= 0) return { pool: pl, pos: i + 1, cb: true, rows: t.map((r, j) => ({ team: r.team, cells: [j + 1, r.team.name, r.p, r.w, r.d, r.l, r.pf, r.pa, plus(r.diff), r.pts] })) }
        }
      } else if (ev.format === 'groups_ko') {
        const gt = groupStandings(c.b, ev.id)
        for (const k of Object.keys(gt)) {
          const i = gt[k].findIndex(r => r.team.id === id)
          if (i >= 0) return { pool: k, pos: i + 1, cb: false, rows: gt[k].map((r, j) => ({ team: r.team, cells: [j + 1, r.team.name, players(r.team) || r.team.name, r.played, r.won, r.lost, r.pf, r.pa, plus(r.diff)] })) }
        }
      }
    }
    return null
  }
  const pod = categoryResult(c.b).podium
  const KO_ORDER = ['Final', 'Third place', '3rd place', 'Semi-final', 'Playoff', 'Quarter-final']
  const finishOf = (id: string | null, name: string): { label: string; rank: number | null } => {
    const place = [pod.first, pod.second, pod.third, pod.fourth ?? null].indexOf(name)
    if (place >= 0) return { label: ['Champion', 'Runner-up', '3rd place', '4th place'][place], rank: place + 1 }
    const ko = all.filter(r => r.isKo && (r.m.team_a_id === id || r.m.team_b_id === id))
    const lastKo = ko.map(r => r.stage.replace(/\s*\d+$/, '').replace(/ ·.*$/, '')).sort((x, y) => {
      const ix = KO_ORDER.findIndex(k => x.startsWith(k)), iy = KO_ORDER.findIndex(k => y.startsWith(k))
      return (ix < 0 ? 99 : ix) - (iy < 0 ? 99 : iy)
    })[0]
    if (lastKo) return { label: `${lastKo}`, rank: null }
    const g = groupOf(id)
    return { label: g ? `${ord(g.pos)} in Group ${g.pool}` : '-', rank: null }
  }
  const fin = finishOf(teamId, team.name)
  const pl = players(team)
  const grp = groupOf(teamId)
  out.push({ k: 'hero', label: fin.rank ? fin.label : fin.label.includes('Group') ? `Finished ${fin.label}` : `Reached the ${fin.label}`,
    name: team.name, line: [pl && pl !== team.name ? pl : '', grp ? `Group ${grp.pool}` : ''].filter(Boolean).join('   |   '), rank: fin.rank })

  const W_ = done.filter(r => r.m.winner_id === teamId).length, D_ = done.filter(r => !r.m.winner_id).length
  const pf = done.reduce((s, r) => s + us(r), 0), pa = done.reduce((s, r) => s + them(r), 0)
  out.push({ k: 'tiles', items: [
    ['Played', String(done.length)], ['Won', String(W_)], ['Lost', String(done.length - W_ - D_)],
    ['Scored', String(pf)], ['Conceded', String(pa)], ['+/-', plus(pf - pa)],
    ['Win %', done.length ? `${Math.round((W_ / done.length) * 100)}%` : '-'],
  ] })

  const br = bracketFor(c, hub)
  const inKo = (x: BoxM) => x.ids.includes(teamId)
  if (br && (inKo(br.final) || (br.third && inKo(br.third)) || br.rows.flat().some(inKo))) out.push({ ...br, hl: teamId })

  if (grp) out.push({ k: 'h3', t: `Group ${grp.pool}` }, grp.cb
    ? { k: 'table', head: ['#', 'Team', 'Played', 'Won', 'Drawn', 'Lost', 'Scored', 'Conceded', '+/-', 'Points'], w: [24, 0, 40, 34, 38, 34, 42, 52, 36, 42],
        al: R(0, 2, 3, 4, 5, 6, 7, 8, 9), bold: [1, 9], hl: grp.pos - 1, body: grp.rows.map(r => r.cells) }
    : { k: 'table', head: ['#', 'Team', 'Players', 'Played', 'Won', 'Lost', 'Scored', 'Conceded', '+/-'], w: [24, 130, 0, 40, 34, 34, 42, 52, 36],
        al: R(0, 3, 4, 5, 6, 7, 8), bold: [1], hl: grp.pos - 1, body: grp.rows.map(r => r.cells) })

  const stg = (r: Row) => r.stage.replace(/^Round robin · /, '')
  const sorted = [...mine].sort((x, y) => x.m.sequence - y.m.sequence)
  out.push({ k: 'h3', t: 'Every game' }, { k: 'table', head: ['Stage', 'Time', 'Court', 'Opponent', 'Score', 'Result', 'Length'],
    w: [82, 50, 36, 0, 50, 54, 44], al: { 2: 'center', 4: 'center', 6: 'right' }, bold: [4], win: 5,
    body: sorted.map(r => [stg(r), r.time, r.court, oppName(r), r.m.status === 'scheduled' ? '-' : `${us(r)} - ${them(r)}`, res(r), realSecs(r) ? dur(r.secs) : '']) })

  // the team's own key games
  const mg = (r: Row) => us(r) - them(r)
  const pick = (list: Row[], val: (r: Row) => number) => { if (!list.length) return []; const b = Math.max(...list.map(val)); return list.filter(r => val(r) === b) }
  const wins = done.filter(r => mg(r) > 0), losses = done.filter(r => mg(r) < 0)
  const fig = (label: string, list: Row[]) => list.map((r, i) => [i === 0 ? label : '', `${us(r)} - ${them(r)}`, 'v', oppName(r), stg(r)])
  const kv = [
    ...fig(`Biggest win${wins.length ? ` (by ${Math.max(...wins.map(mg))})` : ''}`, pick(wins, mg)),
    ...fig(`Closest game${done.length ? ` (by ${Math.min(...done.map(r => Math.abs(mg(r))))})` : ''}`, pick(done, r => -Math.abs(mg(r)))),
    ...fig(`Heaviest loss${losses.length ? ` (by ${Math.max(...losses.map(r => -mg(r)))})` : ''}`, pick(losses, r => -mg(r))),
    ...fig(`Longest game${done.some(realSecs) ? ` (${dur(Math.max(...done.filter(realSecs).map(r => r.secs!)))})` : ''}`, pick(done.filter(realSecs), r => r.secs!)),
  ]
  if (kv.length) out.push({ k: 'h3', t: 'Key games' }, { k: 'table', kv: true, head: ['', '', '', '', ''], w: [116, 46, 16, 0, 112], al: { 1: 'center', 2: 'center' }, bold: [1], body: kv })

  // the teams it met: how each of them did over the whole day
  const recs = records(c, all)
  const opp = [...new Map(sorted.filter(r => oppId(r)).map(r => [oppId(r)!, r])).values()]
  const withPl = opp.some(r => { const t = c.b.teams.find(x => x.id === oppId(r)); return !!players(t) && players(t) !== t?.name })
  if (opp.length) out.push({ k: 'h3', t: 'Teams met' }, { k: 'table', head: ['Opponent', 'Players', 'Finished', 'Played', 'Won', 'Lost', '+/-', 'Head to head'].filter((_, i) => withPl || i !== 1),
    w: (withPl ? [100, 0, 86, 40, 32, 32, 36, 72] : [0, 110, 40, 34, 34, 40, 84]), al: withPl ? R(3, 4, 5, 6) : R(2, 3, 4, 5), bold: [0],
    body: opp.map(r => {
      const id = oppId(r)!, t = c.b.teams.find(x => x.id === id), rc = recs.find(x => x.name === t?.name)
      const h2h = done.filter(g => oppId(g) === id)
      const hw = h2h.filter(g => g.m.winner_id === teamId).length, hl = h2h.filter(g => g.m.winner_id === id).length
      return [t?.name ?? 'TBD', players(t) || (t?.name ?? ''), finishOf(id, t?.name ?? '').label, rc?.p ?? 0, rc?.w ?? 0, rc?.l ?? 0, plus((rc?.pf ?? 0) - (rc?.pa ?? 0)),
        h2h.length ? `Won ${hw} - Lost ${hl}` : '-'].filter((_, i) => withPl || i !== 1)
    }) })
  return out
}

export interface Logo { data: string; w: number; h: number }
/** The event logo as a PNG for the PDF header (browser only). */
export function loadLogo(url?: string): Promise<Logo | null> {
  if (!url || typeof Image === 'undefined' || typeof document === 'undefined') return Promise.resolve(null)
  return new Promise(res => {
    const im = new Image()
    im.onload = () => {
      try {
        const k = Math.min(1, 400 / im.naturalHeight)
        const c = document.createElement('canvas')
        c.width = Math.round(im.naturalWidth * k); c.height = Math.round(im.naturalHeight * k)
        c.getContext('2d')!.drawImage(im, 0, 0, c.width, c.height)
        res({ data: c.toDataURL('image/png'), w: c.width, h: c.height })
      } catch { res(null) }
    }
    im.onerror = () => res(null)
    im.src = url
  })
}

/** The report as a real PDF (A4). jsPDF is loaded only when someone taps the button. */
export async function reportPdf(hub: Hub, cats: Cat[], logoIn?: Logo | null, team?: { code: string; id: string }): Promise<Blob> {
  const logo = logoIn === undefined ? await loadLogo(hub.logo) : logoIn
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = ((at as any).autoTable ?? (at as any).default?.default ?? at.default) as typeof at.default
  const doc = new jsPDF({ unit: 'pt', format: 'a4', compress: true })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, U = W - 2 * M
  type RGB = [number, number, number]
  interface Theme { main: RGB; dark: RGB; tint: RGB; soft: RGB; art: Art }
  const INK: RGB = [15, 23, 42], SLATE: RGB = [30, 41, 59], MUTE: RGB = [100, 116, 139], LINE: RGB = [214, 222, 233], WHITE: RGB = [255, 255, 255]
  const GOLD: RGB = [202, 138, 4], WIN: RGB = [21, 128, 61]
  // [rim, face] of each medal: gold, silver, bronze, 4th
  const MEDALS: Array<[RGB, RGB]> = [[[180, 130, 20], [250, 204, 21]], [[120, 130, 145], [226, 232, 240]], [[150, 90, 45], [222, 160, 110]], [[100, 116, 139], [241, 245, 249]]]
  // one colour family per category: pickleball men's blue / mixed pink, badminton men's teal / mixed purple, captain ball orange
  const PAL: Record<string, [RGB, RGB, RGB, RGB]> = {
    blue: [[29, 78, 216], [23, 37, 84], [239, 246, 255], [219, 234, 254]], pink: [[190, 24, 93], [80, 7, 36], [253, 242, 248], [252, 231, 243]],
    teal: [[13, 148, 136], [4, 47, 46], [240, 253, 250], [204, 251, 241]], purple: [[126, 34, 206], [59, 7, 100], [250, 245, 255], [243, 232, 255]],
    orange: [[234, 88, 12], [67, 20, 7], [255, 247, 237], [255, 237, 213]], gold: [[161, 98, 7], [66, 32, 6], [254, 252, 232], [254, 249, 195]],
  }
  const themeOf = (art: Art, hue?: 0 | 1 | null): Theme => {
    const k = art === 'captainball' ? 'orange' : art === 'star' ? 'gold' : art === 'badminton' ? (hue === 1 ? 'purple' : 'teal') : hue === 1 ? 'pink' : 'blue'
    const [main, dark, tint, soft] = PAL[k]
    return { main, dark, tint, soft, art }
  }
  const op = (o: number) => (doc as any).setGState(new (doc as any).GState({ opacity: o, 'stroke-opacity': o }))
  /** the sport of a category as a line drawing (used as a faint picture behind the pages and on the banners) */
  const drawArt = (art: Art, cx: number, cy: number, r: number, col: RGB) => {
    doc.setDrawColor(...col).setFillColor(...col).setLineWidth(Math.max(0.6, r * 0.07))
    if (art === 'pickleball') {
      doc.circle(cx, cy, r, 'S')
      doc.circle(cx, cy, r * 0.09, 'F')
      for (let i = 0; i < 6; i++) doc.circle(cx + Math.cos(i * Math.PI / 3) * r * 0.4, cy + Math.sin(i * Math.PI / 3) * r * 0.4, r * 0.09, 'F')
      for (let i = 0; i < 10; i++) doc.circle(cx + Math.cos(i * Math.PI / 5 + 0.3) * r * 0.74, cy + Math.sin(i * Math.PI / 5 + 0.3) * r * 0.74, r * 0.085, 'F')
    } else if (art === 'badminton') {
      const by = cy + r * 0.55, ty = cy - r * 0.85
      doc.circle(cx, by + r * 0.2, r * 0.26, 'F')
      const xs = [-0.78, -0.39, 0, 0.39, 0.78]
      xs.forEach(k => doc.line(cx + k * r * 0.28, by, cx + k * r, ty))
      for (const f of [1, 0.55]) { const yy = by + (ty - by) * f, half = r * (0.28 * 0.78 + (0.78 - 0.28 * 0.78) * f); doc.line(cx - half, yy, cx + half, yy) }
    } else if (art === 'captainball') {
      doc.circle(cx, cy, r, 'S')
      for (let k = 0; k < 3; k++) {
        const a = k * 2.0944 - 1.5708, pt = (ang: number, rr: number): [number, number] => [Math.cos(ang) * r * rr, Math.sin(ang) * r * rr]
        const [c1x, c1y] = pt(a + 0.9, 0.5), [c2x, c2y] = pt(a + 0.6, 0.95), [ex, ey] = pt(a, 1)
        doc.lines([[c1x, c1y, c2x, c2y, ex, ey]], cx, cy, [1, 1], 'S')
        const [sx, sy] = pt(a + 1.05, 1), [d1x, d1y] = pt(a + 0.75, 0.8), [d2x, d2y] = pt(a + 0.45, 0.62), [fx, fy] = pt(a + 0.2, 0.52)
        doc.lines([[d1x - sx, d1y - sy, d2x - sx, d2y - sy, fx - sx, fy - sy]], cx + sx, cy + sy, [1, 1], 'S')
      }
    } else {
      const pts: Array<[number, number]> = []
      for (let i = 0; i < 10; i++) { const rr = i % 2 ? r * 0.42 : r, a = -Math.PI / 2 + i * Math.PI / 5; pts.push([cx + Math.cos(a) * rr, cy + Math.sin(a) * rr]) }
      doc.lines(pts.slice(1).map((p2, i) => [p2[0] - pts[i][0], p2[1] - pts[i][1]]), pts[0][0], pts[0][1], [1, 1], 'F', true)
    }
  }
  const pageTheme: Theme[] = []
  let theme: Theme = themeOf('star')
  /** page background: a light tint of the category colour and its colour strip on top */
  const bg = () => {
    pageTheme[doc.getNumberOfPages()] = theme
    doc.setFillColor(...theme.tint).rect(0, 0, W, H, 'F')
    doc.setFillColor(...theme.main).rect(0, 0, W, 6, 'F')
    doc.setFillColor(...theme.dark).rect(0, 6, W, 1.5, 'F')
  }
  let y = M + 6, title = ''
  const newPage = () => { doc.addPage(); bg(); y = M + 6 }
  const room = (h: number) => { if (y + h > H - M - 14) newPage() }
  // standard PDF fonts cannot draw emoji or symbols outside Latin-1: keep text plain
  const clean = (v: unknown) => String(v ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  const fit = (t: string, w: number) => { let x = clean(t); while (x.length > 3 && doc.getTextWidth(x) > w) x = x.slice(0, -2); return x === clean(t) ? x : x.trimEnd() + '...' }
  const medal = (cx: number, cy: number, r: number, i: number, dark: boolean) => {
    const [rim, face] = MEDALS[Math.min(i, 3)]
    doc.setFillColor(...rim).circle(cx, cy, r, 'F')
    doc.setFillColor(...face).circle(cx, cy, r - r * 0.2, 'F')
    doc.setDrawColor(...rim).setLineWidth(0.7).circle(cx, cy, r - r * 0.34, 'S')
    doc.setFont('helvetica', 'bold').setFontSize(r * 0.95).setTextColor(...(dark ? INK : rim))
    doc.text(String(i + 1), cx, cy + r * 0.33, { align: 'center' })
  }
  /** one game of the bracket; returns where its edges are */
  const gameBox = (x: number, by: number, w: number, m: BoxM, big = false) => {
    const slim = w < 130, rh = big ? 25 : 21, h = rh * 2, sw = big ? 36 : slim ? 22 : 28, fs = big ? 10 : slim ? 7.6 : 8.5, pad = slim ? 7 : 9
    doc.setFont('helvetica', 'bold').setFontSize(6.5).setTextColor(253, 224, 71); doc.text(clean(m.code), x, by - 5, { charSpace: 0.8 })
    doc.setFont('helvetica', 'normal').setTextColor(203, 213, 225); if (m.meta) doc.text(clean(m.meta), x + w, by - 5, { align: 'right' })
    doc.setFillColor(...WHITE).roundedRect(x, by, w, h, 3, 3, 'F')
    ;([['a', m.a, m.sa], ['b', m.b, m.sb]] as const).forEach(([s, name, score], i) => {
      const ry = by + i * rh, win = m.win === s, me = !!hlId && m.ids[i] === hlId
      if (win || me) doc.setFillColor(...(me ? [254, 240, 138] as RGB : theme.soft)).rect(x + 1, ry + 0.5, w - sw - 1, rh - 1, 'F')
      if (win) doc.setFillColor(...GOLD).rect(x, ry + 1.5, 3.5, rh - 3, 'F')
      doc.setFillColor(...(win ? theme.main : [241, 245, 249] as RGB)).rect(x + w - sw, ry + (i ? 0 : 1.5), sw - 1.5, rh - 1.5, 'F')
      doc.setFont('helvetica', win || me ? 'bold' : 'normal').setFontSize(fs).setTextColor(...(win || me ? INK : MUTE))
      doc.text(fit(name, w - sw - pad - 3), x + pad, ry + rh / 2 + fs * 0.35)
      doc.setFont('helvetica', 'bold').setTextColor(...(win ? WHITE : MUTE))
      doc.text(clean(score), x + w - sw / 2 - 0.7, ry + rh / 2 + fs * 0.35, { align: 'center' })
      if (me) {
        // the team of a team report: yellow row, thick frame and a pointer, easy to spot on the whole bracket
        doc.setDrawColor(250, 204, 21).setLineWidth(2.4).roundedRect(x - 2, ry - 1 + (i ? 0 : 0.5), w + 4, rh + 2, 2, 2, 'S')
        doc.setFillColor(250, 204, 21).triangle(x - 11, ry + rh / 2 - 5, x - 11, ry + rh / 2 + 5, x - 4, ry + rh / 2, 'F')
      }
    })
    doc.setDrawColor(...LINE).setLineWidth(0.5).line(x + 2, by + rh, x + w - sw, by + rh)
    return { top: by, bot: by + h, cx: x + w / 2, m }
  }
  const tc = team ? cats.find(c => c.code === team.code) : undefined
  const blocks = tc ? teamBlocks(hub, tc, team!.id) : reportBlocks(hub, cats)
  const footer = tc ? `Team report  |  ${clean(tc.b.teams.find(t => t.id === team!.id)?.name)}` : 'Full results'
  let hlId: string | null = null
  /** height a table will take (rows of one line; header row unless key-value) */
  const widthsOf = (b: Extract<Block, { k: 'table' }>) => {
    const fixed = b.w.reduce((s, x) => s + x, 0), flexN = b.w.filter(x => !x).length
    return b.w.map(x => x || (U - fixed) / Math.max(1, flexN))
  }
  /** lines each row will need: long names wrap inside their column */
  const linesOf = (b: Extract<Block, { k: 'table' }>, fs = 8.5) => {
    const ws = widthsOf(b)
    doc.setFont('helvetica', 'bold').setFontSize(fs)
    return b.body.map(r => Math.max(1, ...r.map((v, i) => Math.ceil((doc.getTextWidth(clean(v)) + 1) / Math.max(10, ws[i] - 10)))))
  }
  // a table that would spill onto the next page is drawn a little tighter (smaller type, less padding) when that keeps it on one page
  const SIZES = [{ fs: 8.5, pad: 4.5 }, { fs: 7.6, pad: 3 }, { fs: 7, pad: 2.4 }]
  const fullH = (b: Extract<Block, { k: 'table' }>, z: { fs: number; pad: number }) =>
    (b.kv ? 0 : 19) + linesOf(b, z.fs).reduce((s, n) => s + z.fs * 1.15 + 2 * z.pad + (n - 1) * z.fs * 1.15, 0) + 10
  const sizeMemo = new Map<object, { fs: number; pad: number }>()
  const sizeOf = (b: Extract<Block, { k: 'table' }>) => {
    if (!sizeMemo.has(b)) sizeMemo.set(b, SIZES.find(z => fullH(b, z) <= PAGE - 28) ?? SIZES[0])
    return sizeMemo.get(b)!
  }
  const tableH = (b: Extract<Block, { k: 'table' }>) => fullH(b, sizeOf(b))
  const PAGE = H - M - 14 - (M + 6)
  /** height of a block, to keep a section (its title and what follows) on one page */
  const heightOf = (b: Block | undefined): number => !b ? 0 : b.k === 'table' ? tableH(b) : b.k === 'tiles' ? 56 : b.k === 'hero' ? 86 : b.k === 'podium' ? 150 : b.k === 'bracket' ? 500 : 30
  const firstH2 = blocks.find(b => b.k === 'h2')
  if (firstH2 && firstH2.k === 'h2') theme = themeOf(firstH2.art, firstH2.hue)
  bg()
  blocks.forEach((b, bi) => {
    if (b.k === 'h1') {
      title = clean(b.t)
      doc.setFillColor(...INK).rect(0, 0, W, 100, 'F')
      doc.setFillColor(...theme.main).rect(0, 100, W, 5, 'F')
      doc.setFillColor(...GOLD).rect(0, 105, W, 2, 'F')
      op(0.18); b.arts.slice(0, 3).forEach((a, i) => drawArt(a, W - 52 - i * 58, 50 + (i % 2 ? 10 : -6), b.arts.length > 1 ? 21 : 30, WHITE)); op(1)
      let tx = M
      if (logo) {
        const lh = 62, lw = Math.min(92, (logo.w / logo.h) * lh)
        try { doc.addImage(logo.data, 'PNG', M, 19, lw, lh, undefined, 'FAST'); tx = M + lw + 14 } catch { /* no logo */ }
      }
      doc.setFont('helvetica', 'bold').setFontSize(23).setTextColor(255); doc.text(fit(b.t, W - M - tx - (b.arts.length > 1 ? 150 : 70)), tx, 52)
      doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(253, 224, 71); doc.text(clean(b.sub).toUpperCase(), tx, 71, { charSpace: 0.6 })
      y = 124
    } else if (b.k === 'p') {
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTE); doc.text(clean(b.t), M, y + 10); y += 18
    } else if (b.k === 'h2') {
      theme = themeOf(b.art, b.hue)
      if (bi > 0 && blocks[bi - 1].k !== 'h1') newPage()          // every category starts on its own page, in its own colour
      const bh = 54
      doc.setFillColor(...theme.main).roundedRect(M, y, U, bh, 6, 6, 'F')
      doc.setFillColor(...theme.dark).roundedRect(M + U - 150, y, 150, bh, 6, 6, 'F')
      doc.setFillColor(...theme.main).triangle(M + U - 152, y, M + U - 96, y, M + U - 152, y + bh, 'F')
      doc.setFillColor(...GOLD).rect(M + 14, y + bh - 9, 46, 2.5, 'F')
      op(0.9); drawArt(b.art, M + U - 44, y + bh / 2, 19, WHITE); op(0.35); drawArt(b.art, M + U - 98, y + bh / 2 + 10, 11, WHITE); op(1)
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(255); if (b.sub) doc.text(clean(b.sub).toUpperCase(), M + 14, y + 17, { charSpace: 1.6 })
      doc.setFontSize(18); doc.text(clean(b.t).toUpperCase(), M + 14, y + (b.sub ? 37 : 33))
      y += bh + 12
    } else if (b.k === 'h3') {
      // keep the title with its whole section; a section longer than a page starts on a fresh page
      let need = 28
      for (let j = bi + 1; j < blocks.length && !['h1', 'h2', 'h3'].includes(blocks[j].k); j++) need += heightOf(blocks[j])
      if (need <= PAGE) room(need)
      else if (y > M + 6 + PAGE * 0.35) newPage()
      else room(96)
      y += 6
      doc.setFillColor(...theme.main).roundedRect(M, y, 4, 14, 2, 2, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(11.5).setTextColor(...theme.dark); doc.text(clean(b.t), M + 11, y + 11.5)
      y += 22
    } else if (b.k === 'podium') {
      const [first, ...rest] = b.items
      const hh = 78
      room(hh + (rest.length ? 64 : 0) + 12)
      // champion: dark card, gold frame
      doc.setFillColor(...INK).roundedRect(M, y, U, hh, 6, 6, 'F')
      doc.setDrawColor(...MEDALS[0][0]).setLineWidth(1.2).roundedRect(M + 3, y + 3, U - 6, hh - 6, 4, 4, 'S')
      op(0.12); drawArt(theme.art, M + U - 58, y + hh / 2, 27, MEDALS[0][1]); op(1)
      medal(M + 46, y + hh / 2, 24, 0, true)
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MEDALS[0][1]); doc.text(clean(first[0]).toUpperCase(), M + 86, y + 25, { charSpace: 1.6 })
      doc.setFontSize(19).setTextColor(255); doc.text(fit(first[1], U - 180), M + 86, y + (first[2] ? 47 : 52))
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(203, 213, 225); if (first[2]) doc.text(fit(first[2], U - 180), M + 86, y + 63)
      y += hh + 8
      if (rest.length) {
        const gap = 8, n = rest.length, cw = (U - gap * (n - 1)) / n, ch = 54
        rest.forEach(([place, team, pl], j) => {
          const i = j + 1, x = M + j * (cw + gap)
          doc.setFillColor(...WHITE).setDrawColor(...LINE).setLineWidth(0.8).roundedRect(x, y, cw, ch, 5, 5, 'FD')
          doc.setFillColor(...MEDALS[Math.min(i, 3)][0]).roundedRect(x, y, 4, ch, 2, 2, 'F')
          medal(x + 30, y + ch / 2, 15, i, false)
          doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...MUTE); doc.text(clean(place).toUpperCase(), x + 54, y + (pl ? 17 : 22), { charSpace: 1.2 })
          doc.setFontSize(n > 2 ? 8.6 : 11.5).setTextColor(...INK); doc.text(fit(team, cw - 60), x + 54, y + (pl ? 32 : 37))
          doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTE); if (pl) doc.text(fit(pl, cw - 60), x + 54, y + 44)
        })
        y += ch + 8
      }
      y += 4
    } else if (b.k === 'hero') {
      const hh = 78
      room(hh + 8)
      doc.setFillColor(...INK).roundedRect(M, y, U, hh, 6, 6, 'F')
      const rim = b.rank ? MEDALS[Math.min(b.rank - 1, 3)][0] : theme.main, face = b.rank ? MEDALS[Math.min(b.rank - 1, 3)][1] : theme.soft
      doc.setDrawColor(...rim).setLineWidth(1.2).roundedRect(M + 3, y + 3, U - 6, hh - 6, 4, 4, 'S')
      op(0.12); drawArt(theme.art, M + U - 58, y + hh / 2, 27, face); op(1)
      if (b.rank) medal(M + 46, y + hh / 2, 24, b.rank - 1, true)
      else { doc.setFillColor(...theme.main).circle(M + 46, y + hh / 2, 24, 'F'); drawArt(theme.art, M + 46, y + hh / 2, 15, WHITE) }
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...face); doc.text(clean(b.label).toUpperCase(), M + 86, y + 25, { charSpace: 1.6 })
      doc.setFontSize(19).setTextColor(255); doc.text(fit(b.name, U - 180), M + 86, y + (b.line ? 47 : 52))
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(203, 213, 225); if (b.line) doc.text(fit(b.line, U - 180), M + 86, y + 63)
      y += hh + 12
    } else if (b.k === 'tiles') {
      const gap = 8, n = b.items.length, cw = (U - gap * (n - 1)) / n, ch = 48
      room(ch + 8)
      b.items.forEach(([label, val], i) => {
        const x = M + i * (cw + gap)
        doc.setFillColor(...WHITE).setDrawColor(...theme.soft).setLineWidth(0.8).roundedRect(x, y, cw, ch, 5, 5, 'FD')
        doc.setFillColor(...theme.main).roundedRect(x + 12, y, cw - 24, 3, 1.5, 1.5, 'F')
        doc.setFont('helvetica', 'bold').setFontSize(16).setTextColor(...theme.main); doc.text(clean(val), x + cw / 2, y + 25, { align: 'center' })
        doc.setFont('helvetica', 'bold').setFontSize(6.8).setTextColor(...MUTE); doc.text(clean(label).toUpperCase(), x + cw / 2, y + 38, { align: 'center', charSpace: 0.5 })
      })
      y += ch + 8
    } else if (b.k === 'bracket') {
      hlId = b.hl ?? null
      // pyramid on a dark court: champion on top, the Final under it, then each earlier round
      const hasNote = !!b.final.note, CH = b.champion ? 52 : 0
      const levels: BoxM[][] = [[b.final], ...b.rows]
      // gap between rounds: roomy when there is space, tighter so the bracket still fits under the podium on this page
      const lay = (g: number, top: number) => {
        const tops: number[] = []
        let cur = 40 + (CH ? CH + top : 12)
        levels.forEach((_, i) => { tops.push(cur); cur += (i === 0 ? 50 + (hasNote ? 16 : 0) : 42) + g })
        const thirdTop = cur - g + 50
        return { tops, thirdTop, PH: (b.third ? thirdTop + 42 : cur - g) + 20 }
      }
      const left = H - M - 14 - y - 12
      let L = lay(58, 34)
      for (const [g, t] of [[50, 30], [42, 26], [36, 22]] as const) if (L.PH > left) L = lay(g, t)
      if (L.PH > left) { newPage(); L = lay(58, 34) }
      const { tops, thirdTop, PH } = L
      const y0 = y
      doc.setFillColor(...INK).roundedRect(M, y0, U, PH, 8, 8, 'F')
      doc.setFillColor(...theme.main).roundedRect(M, y0, U, 5, 2.5, 2.5, 'F')
      // court lines and the sport, very faint
      op(0.07); doc.setDrawColor(...WHITE).setLineWidth(1.4).roundedRect(M + 10, y0 + 14, U - 20, PH - 24, 4, 4, 'S')
      doc.line(M + 10, y0 + PH / 2, M + U - 10, y0 + PH / 2)
      op(0.1); drawArt(theme.art, M + U - 66, y0 + 74, 44, WHITE); drawArt(theme.art, M + 62, y0 + PH - 66, 40, WHITE); op(1)
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(253, 224, 71); doc.text('ROAD TO THE FINAL', M + 20, y0 + 30, { charSpace: 1.6 })
      const CONN: RGB = [234, 179, 8]
      const drawn = levels.map((lv, li) => {
        const n = lv.length, slotW = (U - 28) / n
        const w = li === 0 ? 250 : Math.min(200, slotW - 9)
        return lv.map((m, i) => gameBox(M + 14 + i * slotW + (slotW - w) / 2, y0 + tops[li], w, m, li === 0))
      })
      const fin = drawn[0][0]
      if (hasNote) { doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(203, 213, 225); doc.text(clean(b.final.note), fin.cx, fin.bot + 11, { align: 'center' }) }
      if (b.champion) {
        const cw = 250, cx0 = W / 2 - cw / 2, cy0 = y0 + 40
        doc.setFillColor(...MEDALS[0][1]).roundedRect(cx0, cy0, cw, CH, 6, 6, 'F')
        doc.setDrawColor(...MEDALS[0][0]).setLineWidth(1.2).roundedRect(cx0 + 3, cy0 + 3, cw - 6, CH - 6, 4, 4, 'S')
        medal(cx0 + 30, cy0 + CH / 2, 16, 0, true)
        doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(113, 63, 18); doc.text('CHAMPION', cx0 + 56, cy0 + 20, { charSpace: 1.6 })
        doc.setFontSize(12.5).setTextColor(...INK); doc.text(fit(b.champion, cw - 66), cx0 + 56, cy0 + 37)
        doc.setDrawColor(...CONN).setLineWidth(1.2).line(fin.cx, cy0 + CH, fin.cx, fin.top - 14)
      }
      // each game joins the game above it that its winner went to
      for (let li = 1; li < drawn.length; li++) {
        const up = drawn[li - 1], kids = new Map<number, typeof up>()
        drawn[li].forEach((d, j) => {
          let pi = up.findIndex(u => !!d.m.winId && u.m.ids.includes(d.m.winId))
          if (pi < 0) pi = Math.min(up.length - 1, Math.floor(j * up.length / drawn[li].length))
          kids.set(pi, [...(kids.get(pi) ?? []), d])
        })
        doc.setDrawColor(...CONN).setLineWidth(1.2)
        kids.forEach((ks, pi) => {
          const par = up[pi], from = par.bot + (li === 1 && hasNote ? 16 : 0), ym = (from + ks[0].top - 13) / 2
          const xs = [par.cx, ...ks.map(k => k.cx)]
          doc.line(par.cx, from, par.cx, ym); doc.line(Math.min(...xs), ym, Math.max(...xs), ym)
          ks.forEach(k => doc.line(k.cx, ym, k.cx, k.top - 13))
        })
      }
      if (b.third) gameBox(W / 2 - 100, y0 + thirdTop, 200, b.third)
      hlId = null
      y = y0 + PH + 12
    } else {
      const widths = widthsOf(b)
      const bold = new Set(b.bold ?? [])
      const th = theme
      autoTable(doc, {
        startY: y, margin: { left: M, right: M, top: M + 6, bottom: M + 14 }, tableWidth: U,
        head: b.kv ? undefined : [b.head.map(clean)], body: b.body.map(r => r.map(clean)),
        theme: 'plain', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: sizeOf(b).fs, cellPadding: { top: sizeOf(b).pad, bottom: sizeOf(b).pad, left: 5, right: 5 }, overflow: 'linebreak', textColor: SLATE, fillColor: WHITE, lineColor: th.soft, lineWidth: { bottom: 0.6 } as any, valign: 'middle' },
        headStyles: { fillColor: th.main, textColor: 255, fontStyle: 'bold', fontSize: 8, lineWidth: 0 },
        alternateRowStyles: { fillColor: th.tint },
        columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w, halign: b.al?.[i] ?? 'left' }])) as any,
        willDrawPage: d => { if (d.pageNumber > 1) bg() },
        didParseCell: d => {
          const i = d.column.index
          if (d.section === 'head') d.cell.styles.halign = b.al?.[i] ?? 'left'
          if (d.section === 'body') {
            if (b.kv && i === 0) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = th.dark }
            if (b.kv && i === b.w.length - 1) d.cell.styles.textColor = MUTE
            if (bold.has(i)) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = INK }
            if (b.win === i) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = /^Lost/.test(String(d.cell.raw)) ? [185, 28, 28] : WIN }
            if (b.hl === d.row.index) { d.cell.styles.fillColor = th.soft; d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = th.dark }
          }
        },
      })
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 10
    }
  })
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    const th = pageTheme[i] ?? theme
    // the sport as a faint picture over the page: light enough that every number stays readable
    op(0.06); drawArt(th.art, W - 60, H - 150, 150, th.main); drawArt(th.art, 34, H * 0.36, 78, th.main); op(1)
    doc.setDrawColor(...th.main).setLineWidth(0.8).line(M, H - 30, W - M, H - 30)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTE)
    doc.text(`${title}  |  ${footer}`, M, H - 18)
    doc.text(`Page ${i} of ${n}`, W - M, H - 18, { align: 'right' })
  }
  return doc.output('blob')
}

export function saveFile(name: string, data: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** marker an organiser puts in an announcement to show the download buttons (hidden from the text) */
export const DOWNLOAD_MARK = /\s*\[download\]\s*/i
