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
  | { k: 'podium'; items: Array<[string, string, string]> }
  | { k: 'tiles'; items: Array<[string, string]> }
  | { k: 'table'; head: string[]; body: Array<Array<string | number>>; w: number[]; al?: Record<number, Al>
      kv?: boolean; bold?: number[]; boldCell?: (row: number, col: number) => boolean }
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
  const big = [...done].sort((a, z) => margin(z) - margin(a))[0]
  const close = [...done].filter(r => r.winner).sort((a, z) => margin(a) - margin(z) || (z.sa + z.sb) - (a.sa + a.sb))[0]
  const high = [...done].sort((a, z) => (z.sa + z.sb) - (a.sa + a.sb))[0]
  const timed = done.filter(r => r.secs && r.secs > 60)
  const avg = timed.length ? Math.round(timed.reduce((s, r) => s + r.secs!, 0) / timed.length) : 0
  const long = [...timed].sort((a, z) => z.secs! - a.secs!)[0]
  const g = (r?: Row) => (r ? `${r.a}  ${r.sa} - ${r.sb}  ${r.bName}` : '-')
  const st = (r?: Row) => r?.stage ?? ''
  out.push({ k: 'h3', t: 'Key figures' }, { k: 'tiles', items: [
    ['Teams', String(c.b.teams.filter(t => evsOf(c, hub).some(e => e.id === t.event_id)).length)],
    ['Games played', `${done.length} / ${rows.length}`],
    ['Total points', String(pts)],
    ['Avg points / game', done.length ? (pts / done.length).toFixed(1) : '-'],
    ...(avg ? [['Avg game length', dur(avg)] as [string, string]] : []),
  ] }, { k: 'table', kv: true, head: ['', '', ''], w: [120, 0, 150], body: [
    ['Biggest win', g(big), st(big)],
    ['Closest game', g(close), st(close)],
    ['Highest-scoring game', g(high), st(high)],
    ...(long ? [['Longest game', g(long), `${st(long)} - ${dur(long.secs)}`]] : []),
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
  const winCell = (list: Row[], a: number, b: number) => (row: number, col: number) => {
    const m = list[row]?.m
    return !!m && m.status === 'finished' && ((col === a && m.winner_id === m.team_a_id) || (col === b && m.winner_id === m.team_b_id))
  }
  const ko = rows.filter(r => r.isKo).sort((x, y) => x.m.sequence - y.m.sequence)
  if (ko.length) out.push({ k: 'h3', t: 'Knockout (winner in bold)' }, { k: 'table', head: ['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Length'],
    w: [100, 52, 38, 0, 54, 0, 44], al: { 2: 'center', 3: 'right', 4: 'center', 6: 'right' }, bold: [4], boldCell: winCell(ko, 3, 5),
    body: ko.map(r => [r.stage, r.time, r.court, r.a, sc(r), r.bName, dur(r.secs)]) })
  const rec = records(c, rows)
  out.push({ k: 'h3', t: 'Team records (all games)' }, { k: 'table', head: ['#', 'Team', 'P', 'W', 'L', 'PF', 'PA', '+/-', 'Win %', 'Best'],
    w: [24, 0, 32, 32, 32, 36, 36, 40, 44, 36], al: R(0, 2, 3, 4, 5, 6, 7, 8, 9), bold: [1],
    body: rec.map((r, i) => [i + 1, r.name, r.p, r.w, r.l, r.pf, r.pa, plus(r.pf - r.pa), r.p ? `${Math.round((r.w / r.p) * 100)}%` : '-', r.best]) })
  out.push({ k: 'h3', t: 'All games (winner in bold)' }, { k: 'table', head: ['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Length'],
    w: [100, 52, 38, 0, 54, 0, 44], al: { 2: 'center', 3: 'right', 4: 'center', 6: 'right' }, bold: [4], boldCell: winCell(rows, 3, 5),
    body: rows.map(r => [r.stage, r.time, r.court, r.a, sc(r), r.bName, dur(r.secs)]) })
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
    out.push({ k: 'h2', t: 'Total Champion' }, { k: 'table', head: ['#', 'Church', 'Gold', 'Silver', 'Bronze', ...(four ? ['4th'] : [])],
      w: [24, 0, 60, 60, 60, ...(four ? [60] : [])], al: R(0, 2, 3, 4, 5), bold: [1],
      body: mt.map((r, i) => [i + 1, r.name, r.gold, r.silver, r.bronze, ...(four ? [r.fourth] : [])]) },
    { k: 'h3', t: 'Category winners' }, { k: 'table', head: ['Category', 'Champion', 'Runner-up', '3rd place'], w: [150, 0, 0, 0], bold: [1],
      body: res.map((r, i) => [cats[i].label, r.podium.first ?? '-', r.podium.second ?? '-', r.podium.third ?? '-']) })
  }
  for (const c of cats) catBlocks(c, hub, out)
  return out
}

/** The report as a real PDF (A4). jsPDF is loaded only when someone taps the button. */
export async function reportPdf(hub: Hub, cats: Cat[]): Promise<Blob> {
  const [{ jsPDF }, at] = await Promise.all([import('jspdf'), import('jspdf-autotable')])
  const autoTable = ((at as any).autoTable ?? (at as any).default?.default ?? at.default) as typeof at.default
  const doc = new jsPDF({ unit: 'pt', format: 'a4' })
  const W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight(), M = 36, U = W - 2 * M
  type RGB = [number, number, number]
  const INK: RGB = [15, 23, 42], SLATE: RGB = [30, 41, 59], MUTE: RGB = [100, 116, 139], LINE: RGB = [226, 232, 240], SOFT: RGB = [248, 250, 252]
  const ACCENT: RGB = [202, 138, 4], BLUE: RGB = [29, 78, 216], PINK: RGB = [190, 24, 93]
  const MEDAL: RGB[] = [[202, 138, 4], [148, 163, 184], [180, 115, 60], [100, 116, 139]]
  let y = M, title = ''
  const room = (h: number) => { if (y + h > H - M - 14) { doc.addPage(); y = M } }
  // standard PDF fonts cannot draw emoji or symbols outside Latin-1: keep text plain
  const clean = (v: unknown) => String(v ?? '').replace(/[–—]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  const fit = (t: string, w: number) => { let x = clean(t); while (x.length > 3 && doc.getTextWidth(x) > w) x = x.slice(0, -2); return x === clean(t) ? x : x.trimEnd() + '...' }
  for (const b of reportBlocks(hub, cats)) {
    if (b.k === 'h1') {
      title = clean(b.t)
      doc.setFillColor(...INK).rect(0, 0, W, 92, 'F')
      doc.setFillColor(...ACCENT).rect(0, 92, W, 4, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(24).setTextColor(255); doc.text(fit(b.t, U), M, 44)
      doc.setFont('helvetica', 'normal').setFontSize(11).setTextColor(226, 232, 240); doc.text(clean(b.sub), M, 64)
      doc.setFontSize(8.5).setTextColor(148, 163, 184); doc.text(clean(b.note), M, 80)
      y = 112
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
      const gap = 8, n = b.items.length, cw = (U - gap * (n - 1)) / n, ch = 62
      room(ch + 10)
      b.items.forEach(([place, team, pl], i) => {
        const x = M + i * (cw + gap)
        doc.setFillColor(...SOFT).setDrawColor(...LINE).setLineWidth(0.6).roundedRect(x, y, cw, ch, 4, 4, 'FD')
        doc.setFillColor(...MEDAL[Math.min(i, 3)]).rect(x, y, cw, 4, 'F')
        doc.setFont('helvetica', 'bold').setFontSize(7.5).setTextColor(...MEDAL[Math.min(i, 3)]); doc.text(clean(place).toUpperCase(), x + 10, y + 19)
        doc.setFontSize(11).setTextColor(...INK); doc.text(fit(team, cw - 20), x + 10, y + 36)
        doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(...MUTE); if (pl) doc.text(fit(pl, cw - 20), x + 10, y + 50)
      })
      y += ch + 10
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
            if (bold.has(i) || b.boldCell?.(d.row.index, i)) { d.cell.styles.fontStyle = 'bold'; d.cell.styles.textColor = INK }
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
