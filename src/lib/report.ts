/** "Download full results": a PDF report and a
 *  CSV of every game (opens in Excel), built in the browser from the data the
 *  front page already has. No server, no cost. Used by the results announcement. */
import type { Bundle, EventCfg, Match, Team } from './types'
import type { Hub } from './hub'
import { hubTitle, catHue } from './hub'
import { groupStandings } from './store'
import { cbStandings } from './captainball'
import { categoryResult, medalTable, needsFourth } from './medals'
import { gameTitle, stageName } from './pool'
import { plannedTime, plannedCourt } from './timetable'

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
    .sort((x, y) => (x.m.started_at ?? '9').localeCompare(y.m.started_at ?? '9') || x.m.sequence - y.m.sequence)
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
export type Block =
  | { k: 'h1'; t: string; sub: string; note: string }
  | { k: 'h2'; t: string; hue?: 0 | 1 | null } | { k: 'h3'; t: string } | { k: 'p'; t: string }
  | { k: 'podium'; items: Array<[string, string, string]> }   // [label, name, small line]: 1st is the hero card
  | { k: 'tiles'; items: Array<[string, string]> }
  | { k: 'table'; head: string[]; body: Array<Array<string | number>>; w: number[]; al?: Record<number, Al>
      kv?: boolean; bold?: number[]; /** column holding the winner: drawn in green */ win?: number }
const plus = (n: number) => (n > 0 ? `+${n}` : String(n))
const R = (...i: number[]): Record<number, Al> => Object.fromEntries(i.map(x => [x, 'right' as Al]))

function catBlocks(c: Cat, hub: Hub, out: Block[]) {
  const rows = rowsOf(c, hub)
  const done = rows.filter(r => r.m.status === 'finished')
  const p = categoryResult(c.b).podium
  out.push({ k: 'h2', t: c.label, hue: catHue(c.label) })
  const pod = [['Champion', p.first], ['Runner-up', p.second], ['3rd place', p.third], ['4th place', p.fourth ?? null]]
    .filter(([, n]) => n) as Array<[string, string]>
  if (pod.length) out.push({ k: 'podium', items: pod.map(([k, n]) => {
    const pl = players(c.b.teams.find(x => x.name === n))
    return [k, n, pl && pl !== n ? pl : '']
  }) })
  else out.push({ k: 'p', t: 'Final placings not decided yet.' })

  const pts = done.reduce((s, r) => s + r.sa + r.sb, 0)
  const margin = (r: Row) => Math.abs(r.sa - r.sb)
  // every game that shares the top value is listed (e.g. all the 15-14 games), not just one
  const top = (list: Row[], val: (r: Row) => number): Row[] => {
    if (!list.length) return []
    const best = Math.max(...list.map(val))
    return list.filter(r => val(r) === best)
  }
  const big = top(done, margin), close = top(done, r => -margin(r)), high = top(done, r => r.sa + r.sb)
  const timed = done.filter(r => r.secs && r.secs > 60)
  const avg = timed.length ? Math.round(timed.reduce((s, r) => s + r.secs!, 0) / timed.length) : 0
  const long = top(timed, r => r.secs!)
  const g = (r?: Row) => (r ? `${r.a}  ${r.sa} - ${r.sb}  ${r.bName}` : '-')
  const st = (r?: Row) => r?.stage ?? ''
  const fig = (label: string, list: Row[]): string[][] =>
    list.map((r, i) => [i === 0 ? label : '', g(r), st(r)])
  out.push({ k: 'h3', t: 'Key figures' }, { k: 'tiles', items: [
    ['Teams', String(c.b.teams.filter(t => evsOf(c, hub).some(e => e.id === t.event_id)).length)],
    ['Games played', `${done.length} / ${rows.length}`],
    ['Total points', String(pts)],
    ['Avg points / game', done.length ? (pts / done.length).toFixed(1) : '-'],
    ...(avg ? [['Avg game length', dur(avg)] as [string, string]] : []),
  ] }, { k: 'table', kv: true, head: ['', '', ''], w: [140, 0, 140], body: [
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
        if (t.length) out.push({ k: 'h3', t: `Group ${pl}` }, { k: 'table', head: ['#', 'Team', 'P', 'W', 'D', 'L', 'PF', 'PA', '+/-', 'Pts'],
          w: [24, 0, 32, 32, 32, 32, 36, 36, 40, 36], al: R(0, 2, 3, 4, 5, 6, 7, 8, 9), bold: [1, 9],
          body: t.map((r, i) => [i + 1, r.team.name, r.p, r.w, r.d, r.l, r.pf, r.pa, plus(r.diff), r.pts]) })
      }
    } else if (ev.format === 'groups_ko') {
      const gt = groupStandings(c.b, ev.id)
      for (const k of Object.keys(gt).sort())
        out.push({ k: 'h3', t: `Group ${k}` }, { k: 'table', head: ['#', 'Team', 'Players', 'P', 'W', 'L', 'PF', 'PA', '+/-'],
          w: [24, 150, 0, 32, 32, 32, 36, 36, 40], al: R(0, 3, 4, 5, 6, 7, 8), bold: [1],
          body: gt[k].map((r, i) => [i + 1, r.team.name, players(r.team), r.played, r.won, r.lost, r.pf, r.pa, plus(r.diff)]) })
    }
  }
  const sc = (r: Row) => (r.m.status === 'scheduled' ? '-' : `${r.sa} - ${r.sb}`)
  const stg = (r: Row) => r.stage.replace(/^Round robin \u00b7 /, '')
  const GW = [82, 50, 36, 0, 50, 0, 0], GA: Record<number, Al> = { 2: 'center', 3: 'right', 4: 'center' }
  const GH = ['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Winner']
  const game = (r: Row) => [stg(r), r.time, r.court, r.a, sc(r), r.bName, r.winner || (r.m.status === 'finished' ? 'Draw' : r.status)]
  const ko = rows.filter(r => r.isKo).sort((x, y) => x.m.sequence - y.m.sequence)
  if (ko.length) out.push({ k: 'h3', t: 'Knockout' }, { k: 'table', head: GH, w: GW, al: GA, bold: [4], win: 6, body: ko.map(game) })
  const rec = records(c, rows)
  out.push({ k: 'h3', t: 'Team records (all games)' }, { k: 'table', head: ['#', 'Team', 'P', 'W', 'L', 'PF', 'PA', '+/-', 'Win %', 'Best'],
    w: [24, 0, 32, 32, 32, 36, 36, 40, 44, 36], al: R(0, 2, 3, 4, 5, 6, 7, 8, 9), bold: [1],
    body: rec.map((r, i) => [i + 1, r.name, r.p, r.w, r.l, r.pf, r.pa, plus(r.pf - r.pa), r.p ? `${Math.round((r.w / r.p) * 100)}%` : '-', r.best]) })
  out.push({ k: 'h3', t: 'All games' }, { k: 'table', head: GH, w: GW, al: GA, bold: [4], win: 6, body: rows.map(game) })
}

const dateOf = (cats: Cat[]) => cats.find(c => c.b.competition.event_date)?.b.competition.event_date ?? ''

export function reportBlocks(hub: Hub, cats: Cat[]): Block[] {
  const title = hubTitle(hub, cats.map(c => c.b.competition.name))
  const when = dateOf(cats)
  const out: Block[] = [{ k: 'h1', t: title,
    sub: `Full results & analysis${when ? `  |  ${new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}`,
    note: `pickle-point.vercel.app/c/${hub.code}  |  downloaded ${new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' })}` }]
  if (!hub.noChurch) {
    const res = cats.map(c => categoryResult(c.b))
    const mt = medalTable(res, cats.map(c => c.b))
    const four = needsFourth(mt)
    const top3 = mt.filter(r => r.gold + r.silver + r.bronze > 0).slice(0, 3)
    out.push({ k: 'h2', t: 'Total Champion' })
    if (top3.length) out.push({ k: 'podium', items: top3.map((r, i) =>
      [['Total Champion', '2nd overall', '3rd overall'][i], r.name, `${r.gold} gold \u00b7 ${r.silver} silver \u00b7 ${r.bronze} bronze`] as [string, string, string]) },
      { k: 'h3', t: 'Medal table' })
    out.push({ k: 'table', head: ['#', 'Church', 'Gold', 'Silver', 'Bronze', ...(four ? ['4th'] : [])],
      w: [24, 0, 60, 60, 60, ...(four ? [60] : [])], al: R(0, 2, 3, 4, 5), bold: [1],
      body: mt.map((r, i) => [i + 1, r.name, r.gold, r.silver, r.bronze, ...(four ? [r.fourth] : [])]) },
    { k: 'h3', t: 'Category winners' }, { k: 'table', head: ['Category', 'Champion', 'Runner-up', '3rd place'], w: [150, 0, 0, 0], bold: [1],
      body: res.map((r, i) => [cats[i].label, r.podium.first ?? '-', r.podium.second ?? '-', r.podium.third ?? '-']) })
  }
  for (const c of cats) catBlocks(c, hub, out)
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
export async function reportPdf(hub: Hub, cats: Cat[], logoIn?: Logo | null): Promise<Blob> {
  const logo = logoIn === undefined ? await loadLogo(hub.logo) : logoIn
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = ((at as any).autoTable ?? (at as any).default?.default ?? at.default) as typeof at.default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, U = W - 2 * M
  type RGB = [number, number, number]
  const INK: RGB = [15, 23, 42], SLATE: RGB = [30, 41, 59], MUTE: RGB = [100, 116, 139], LINE: RGB = [226, 232, 240], SOFT: RGB = [248, 250, 252]
  const ACCENT: RGB = [202, 138, 4], BLUE: RGB = [29, 78, 216], PINK: RGB = [190, 24, 93]
  // [rim, face] of each medal: gold, silver, bronze, 4th
  const MEDALS: Array<[RGB, RGB]> = [[[180, 130, 20], [250, 204, 21]], [[120, 130, 145], [226, 232, 240]], [[150, 90, 45], [222, 160, 110]], [[100, 116, 139], [241, 245, 249]]]
  const WIN: RGB = [21, 128, 61]
  let y = M, title = ''
  const room = (h: number) => { if (y + h > H - M - 14) { doc.addPage(); y = M } }
  // standard PDF fonts cannot draw emoji or symbols outside Latin-1: keep text plain
  const clean = (v: unknown) => String(v ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  const fit = (t: string, w: number) => { let x = clean(t); while (x.length > 3 && doc.getTextWidth(x) > w) x = x.slice(0, -2); return x === clean(t) ? x : x.trimEnd() + '...' }
  for (const b of reportBlocks(hub, cats)) {
    if (b.k === 'h1') {
      title = clean(b.t)
      doc.setFillColor(...INK).rect(0, 0, W, 96, 'F')
      doc.setFillColor(...ACCENT).rect(0, 96, W, 3, 'F')
      let tx = M
      if (logo) {
        const lh = 60, lw = Math.min(90, (logo.w / logo.h) * lh)
        try { doc.addImage(logo.data, 'PNG', M, 18, lw, lh, undefined, 'FAST'); tx = M + lw + 14 } catch { /* no logo */ }
      }
      doc.setFont('helvetica', 'bold').setFontSize(23).setTextColor(255); doc.text(fit(b.t, W - M - tx), tx, 46)
      doc.setFont('helvetica', 'normal').setFontSize(10.5).setTextColor(226, 232, 240); doc.text(clean(b.sub).toUpperCase(), tx, 64, { charSpace: 0.6 })
      doc.setFontSize(8).setTextColor(148, 163, 184); doc.text(clean(b.note), tx, 79)
      y = 118
    } else if (b.k === 'p') {
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(...MUTE); doc.text(clean(b.t), M, y + 10); y += 18
    } else if (b.k === 'h2') {
      if (y > 130) { doc.addPage(); y = M }          // every category starts on its own page
      const col = b.hue === 0 ? BLUE : b.hue === 1 ? PINK : SLATE
      doc.setFillColor(...col).roundedRect(M, y, U, 28, 4, 4, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(255); doc.text(clean(b.t).toUpperCase(), M + 12, y + 19)
      y += 40
    } else if (b.k === 'h3') {
      room(96); y += 6
      doc.setFillColor(...ACCENT).rect(M, y + 1, 3, 12, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(11).setTextColor(...INK); doc.text(clean(b.t), M + 9, y + 11)
      y += 20
    } else if (b.k === 'podium') {
      const medal = (cx: number, cy: number, r: number, i: number, dark: boolean) => {
        const [rim, face] = MEDALS[Math.min(i, 3)]
        doc.setFillColor(...rim).circle(cx, cy, r, 'F')
        doc.setFillColor(...face).circle(cx, cy, r - r * 0.2, 'F')
        doc.setDrawColor(...rim).setLineWidth(0.7).circle(cx, cy, r - r * 0.34, 'S')
        doc.setFont('helvetica', 'bold').setFontSize(r * 0.95).setTextColor(...(dark ? INK : rim))
        doc.text(String(i + 1), cx, cy + r * 0.33, { align: 'center' })
      }
      const [first, ...rest] = b.items
      const hh = 78
      room(hh + (rest.length ? 64 : 0) + 12)
      // champion: dark card, gold frame
      doc.setFillColor(...INK).roundedRect(M, y, U, hh, 6, 6, 'F')
      doc.setDrawColor(...MEDALS[0][0]).setLineWidth(1.2).roundedRect(M + 3, y + 3, U - 6, hh - 6, 4, 4, 'S')
      medal(M + 46, y + hh / 2, 24, 0, true)
      doc.setFont('helvetica', 'bold').setFontSize(8).setTextColor(...MEDALS[0][1]); doc.text(clean(first[0]).toUpperCase(), M + 86, y + 25, { charSpace: 1.6 })
      doc.setFontSize(19).setTextColor(255); doc.text(fit(first[1], U - 110), M + 86, y + 47)
      doc.setFont('helvetica', 'normal').setFontSize(9.5).setTextColor(203, 213, 225); if (first[2]) doc.text(fit(first[2], U - 110), M + 86, y + 63)
      y += hh + 8
      if (rest.length) {
        const gap = 8, n = rest.length, cw = (U - gap * (n - 1)) / n, ch = 54
        rest.forEach(([place, team, pl], j) => {
          const i = j + 1, x = M + j * (cw + gap)
          doc.setFillColor(255, 255, 255).setDrawColor(...LINE).setLineWidth(0.8).roundedRect(x, y, cw, ch, 5, 5, 'FD')
          doc.setFillColor(...MEDALS[Math.min(i, 3)][0]).roundedRect(x, y, 4, ch, 2, 2, 'F')
          medal(x + 30, y + ch / 2, 15, i, false)
          doc.setFont('helvetica', 'bold').setFontSize(7).setTextColor(...MUTE); doc.text(clean(place).toUpperCase(), x + 54, y + 17, { charSpace: 1.2 })
          doc.setFontSize(11.5).setTextColor(...INK); doc.text(fit(team, cw - 62), x + 54, y + 32)
          doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTE); if (pl) doc.text(fit(pl, cw - 62), x + 54, y + 44)
        })
        y += ch + 8
      }
      y += 4
    } else if (b.k === 'tiles') {
      const gap = 8, n = b.items.length, cw = (U - gap * (n - 1)) / n, ch = 44
      room(ch + 8)
      b.items.forEach(([label, val], i) => {
        const x = M + i * (cw + gap)
        doc.setFillColor(...SOFT).setDrawColor(...LINE).setLineWidth(0.6).roundedRect(x, y, cw, ch, 4, 4, 'FD')
        doc.setFont('helvetica', 'bold').setFontSize(15).setTextColor(...INK); doc.text(clean(val), x + cw / 2, y + 21, { align: 'center' })
        doc.setFont('helvetica', 'normal').setFontSize(7.5).setTextColor(...MUTE); doc.text(clean(label).toUpperCase(), x + cw / 2, y + 35, { align: 'center' })
      })
      y += ch + 8
    } else {
      const fixed = b.w.reduce((s, x) => s + x, 0), flexN = b.w.filter(x => !x).length
      const widths = b.w.map(x => x || (U - fixed) / Math.max(1, flexN))
      const bold = new Set(b.bold ?? [])
      autoTable(doc, {
        startY: y, margin: { left: M, right: M, top: M, bottom: M + 14 }, tableWidth: U,
        head: b.kv ? undefined : [b.head.map(clean)], body: b.body.map(r => r.map(clean)),
        theme: 'plain', rowPageBreak: 'avoid',
        styles: { font: 'helvetica', fontSize: 8.5, cellPadding: { top: 4.5, bottom: 4.5, left: 5, right: 5 }, overflow: 'linebreak', textColor: SLATE, lineColor: LINE, lineWidth: { bottom: 0.5 } as any, valign: 'middle' },
        headStyles: { fillColor: SLATE, textColor: 255, fontStyle: 'bold', fontSize: 8, lineWidth: 0 },
        alternateRowStyles: { fillColor: SOFT },
        columnStyles: Object.fromEntries(widths.map((w, i) => [i, { cellWidth: w, halign: b.al?.[i] ?? 'left' }])) as any,
        didParseCell: d => {
          const i = d.column.index
          if (d.section === 'head') d.cell.styles.halign = b.al?.[i] ?? 'left'
          if (d.section === 'body') {
            if (b.kv && i === 0) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = INK }
            if (b.kv && i === 2) d.cell.styles.textColor = MUTE
            if (bold.has(i)) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = INK }
            if (b.win === i) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = WIN }
          }
        },
      })
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 10
    }
  }
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i)
    doc.setDrawColor(...LINE).setLineWidth(0.6).line(M, H - 30, W - M, H - 30)
    doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTE)
    doc.text(`${title}  |  Full results`, M, H - 18)
    doc.text(`Page ${i} of ${n}`, W - M, H - 18, { align: 'right' })
  }
  return doc.output('blob')
}

export function reportCsv(hub: Hub, cats: Cat[]): string {
  const q = (v: unknown) => { const s = String(v ?? ''); return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s }
  const lines = [['Category', 'Time', 'Court', 'Stage', 'Team A', 'Players A', 'Score A', 'Score B', 'Team B', 'Players B', 'Winner', 'Status', 'Length (m:ss)']]
  for (const c of cats) for (const r of rowsOf(c, hub)) {
    const ta = c.b.teams.find(t => t.id === r.m.team_a_id), tb = c.b.teams.find(t => t.id === r.m.team_b_id)
    lines.push([r.cat, r.time, r.court, r.stage, r.a, players(ta), String(r.sa), String(r.sb), r.bName, players(tb), r.winner, r.status, dur(r.secs)])
  }
  return '﻿' + lines.map(l => l.map(q).join(',')).join('\r\n')
}

export function saveFile(name: string, data: string | Blob, type: string) {
  const url = URL.createObjectURL(typeof data === 'string' ? new Blob([data], { type }) : data)
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** marker an organiser puts in an announcement to show the download buttons (hidden from the text) */
export const DOWNLOAD_MARK = /\s*\[download\]\s*/i
