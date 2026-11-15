/** "Download full results": a PDF report and a
 *  CSV of every game (opens in Excel), built in the browser from the data the
 *  front page already has. No server, no cost. Used by the results announcement. */
import type { Bundle, EventCfg, Match, Team } from './types'
import type { Hub } from './hub'
import { hubTitle } from './hub'
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

/** the report as plain blocks: drawn as a PDF (reportPdf) */
export type Block =
  | { k: 'h1'; t: string } | { k: 'p'; t: string } | { k: 'h2'; t: string } | { k: 'h3'; t: string }
  | { k: 'table'; head: string[]; body: Array<Array<string | number>>; num?: number[]; kv?: boolean }
const plus = (n: number) => (n > 0 ? `+${n}` : String(n))

function catBlocks(c: Cat, hub: Hub, out: Block[]) {
  const rows = rowsOf(c, hub)
  const done = rows.filter(r => r.m.status === 'finished')
  const p = categoryResult(c.b).podium
  out.push({ k: 'h2', t: c.label })
  const pod = [['Champion', p.first], ['Runner-up', p.second], ['3rd place', p.third], ['4th place', p.fourth ?? null]]
    .filter(([, n]) => n) as Array<[string, string]>
  const podRows = pod.map(([k, n]) => {
    const t = c.b.teams.find(x => x.name === n)
    return [k, n, players(t)]
  })
  const withPl = podRows.some(r => r[2])
  if (pod.length) out.push({ k: 'table', head: withPl ? ['Place', 'Team', 'Players'] : ['Place', 'Team'], body: withPl ? podRows : podRows.map(r => r.slice(0, 2)) })
  else out.push({ k: 'p', t: 'Final placings not decided yet.' })

  const pts = done.reduce((s, r) => s + r.sa + r.sb, 0)
  const margin = (r: Row) => Math.abs(r.sa - r.sb)
  const big = [...done].sort((a, z) => margin(z) - margin(a))[0]
  const close = [...done].filter(r => r.winner).sort((a, z) => margin(a) - margin(z) || (z.sa + z.sb) - (a.sa + a.sb))[0]
  const high = [...done].sort((a, z) => (z.sa + z.sb) - (a.sa + a.sb))[0]
  const timed = done.filter(r => r.secs && r.secs > 60)
  const avg = timed.length ? Math.round(timed.reduce((s, r) => s + r.secs!, 0) / timed.length) : 0
  const long = [...timed].sort((a, z) => z.secs! - a.secs!)[0]
  const g = (r?: Row) => (r ? `${r.a} ${r.sa}-${r.sb} ${r.bName} (${r.stage})` : '-')
  out.push({ k: 'h3', t: 'Key figures' }, { k: 'table', kv: true, head: ['', ''], body: [
    ['Teams', c.b.teams.filter(t => evsOf(c, hub).some(e => e.id === t.event_id)).length],
    ['Games played', `${done.length} of ${rows.length}`],
    ['Total points scored', pts],
    ['Average points per game', done.length ? (pts / done.length).toFixed(1) : '-'],
    ['Biggest win', g(big)],
    ['Closest game', g(close)],
    ['Highest-scoring game', g(high)],
    ...(avg ? [['Average game length', dur(avg)], ['Longest game', `${g(long)} - ${dur(long?.secs)}`]] as Array<[string, string]> : []),
  ] })

  for (const ev of evsOf(c, hub)) {
    if (ev.sport === 'captainball') {
      const pools = [...new Set(c.b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
      for (const pl of pools) {
        const t = cbStandings(c.b, ev.id, pl)
        if (t.length) out.push({ k: 'h3', t: `Group ${pl}` }, { k: 'table', head: ['#', 'Team', 'P', 'W', 'D', 'L', 'PF', 'PA', '+/-', 'Pts'],
          body: t.map((r, i) => [i + 1, r.team.name, r.p, r.w, r.d, r.l, r.pf, r.pa, plus(r.diff), r.pts]), num: [0, 2, 3, 4, 5, 6, 7, 8, 9] })
      }
    } else if (ev.format === 'groups_ko') {
      const gt = groupStandings(c.b, ev.id)
      for (const k of Object.keys(gt).sort())
        out.push({ k: 'h3', t: `Group ${k}` }, { k: 'table', head: ['#', 'Team', 'Players', 'P', 'W', 'L', 'PF', 'PA', '+/-'],
          body: gt[k].map((r, i) => [i + 1, r.team.name, players(r.team), r.played, r.won, r.lost, r.pf, r.pa, plus(r.diff)]), num: [0, 3, 4, 5, 6, 7, 8] })
    }
  }
  const ko = rows.filter(r => r.isKo).sort((x, y) => x.m.sequence - y.m.sequence)
  const sc = (r: Row) => (r.m.status === 'scheduled' ? '-' : `${r.sa} - ${r.sb}`)
  if (ko.length) out.push({ k: 'h3', t: 'Knockout' }, { k: 'table', head: ['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Winner'],
    body: ko.map(r => [r.stage, r.time, r.court, r.a, sc(r), r.bName, r.winner]), num: [2, 4] })
  out.push({ k: 'h3', t: 'Team records (all games)' }, { k: 'table', head: ['#', 'Team', 'P', 'W', 'L', 'PF', 'PA', '+/-', 'Win %', 'Best'],
    body: records(c, rows).map((r, i) => [i + 1, r.name, r.p, r.w, r.l, r.pf, r.pa, plus(r.pf - r.pa), r.p ? `${Math.round((r.w / r.p) * 100)}%` : '-', r.best]),
    num: [0, 2, 3, 4, 5, 6, 7, 8, 9] })
  out.push({ k: 'h3', t: 'All games' }, { k: 'table', head: ['Time', 'Court', 'Stage', 'Team', 'Score', 'Team', 'Winner', 'Length'],
    body: rows.map(r => [r.time, r.court, r.stage, r.a, sc(r), r.bName, r.winner || r.status, dur(r.secs)]), num: [1, 4, 7] })
}

const dateOf = (cats: Cat[]) => cats.find(c => c.b.competition.event_date)?.b.competition.event_date ?? ''

export function reportBlocks(hub: Hub, cats: Cat[]): Block[] {
  const title = hubTitle(hub, cats.map(c => c.b.competition.name))
  const when = dateOf(cats)
  const out: Block[] = [{ k: 'h1', t: title },
    { k: 'p', t: `Full results & analysis${when ? ` - ${new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}` },
    { k: 'p', t: `Downloaded ${new Date().toLocaleString('en-GB')} from pickle-point.vercel.app/c/${hub.code}` }]
  if (!hub.noChurch) {
    const res = cats.map(c => categoryResult(c.b))
    const mt = medalTable(res, cats.map(c => c.b))
    const four = needsFourth(mt)
    out.push({ k: 'h2', t: 'Total Champion' }, { k: 'table', head: ['#', 'Church', 'Gold', 'Silver', 'Bronze', ...(four ? ['4th'] : [])],
      body: mt.map((r, i) => [i + 1, r.name, r.gold, r.silver, r.bronze, ...(four ? [r.fourth] : [])]), num: [0, 2, 3, 4, 5] },
    { k: 'h3', t: 'Category winners' }, { k: 'table', head: ['Category', 'Champion', 'Runner-up', '3rd place'],
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
  const W = doc.internal.pageSize.getWidth(), M = 36
  let y = M
  const room = (h: number) => { if (y + h > doc.internal.pageSize.getHeight() - M) { doc.addPage(); y = M } }
  // standard PDF fonts cannot draw emoji or symbols outside Latin-1: keep text plain
  const clean = (v: unknown) => String(v ?? '').replace(/[\u2013\u2014]/g, '-').replace(/[^\x20-\x7E\xA0-\xFF]/g, '')
  for (const b of reportBlocks(hub, cats)) {
    if (b.k === 'h1') { doc.setFont('helvetica', 'bold').setFontSize(20); doc.text(clean(b.t), M, y + 16); y += 26 }
    else if (b.k === 'p') { doc.setFont('helvetica', 'normal').setFontSize(10).setTextColor(90); doc.text(clean(b.t), M, y + 10); doc.setTextColor(0); y += 15 }
    else if (b.k === 'h2') {
      room(70); y += 10
      doc.setFillColor(17, 17, 17).roundedRect(M, y, W - 2 * M, 24, 4, 4, 'F')
      doc.setFont('helvetica', 'bold').setFontSize(14).setTextColor(255); doc.text(clean(b.t), M + 10, y + 16); doc.setTextColor(0); y += 32
    } else if (b.k === 'h3') { room(110); doc.setFont('helvetica', 'bold').setFontSize(11.5); doc.text(clean(b.t), M, y + 12); y += 17 }
    else {
      const num = new Set(b.num ?? [])
      autoTable(doc, {
        startY: y, margin: { left: M, right: M },
        head: b.kv ? undefined : [b.head.map(clean)], body: b.body.map(r => r.map(clean)),
        theme: 'striped', styles: { fontSize: 8.5, cellPadding: 3.5, overflow: 'linebreak' },
        headStyles: { fillColor: [235, 235, 235], textColor: 20, fontStyle: 'bold' },
        alternateRowStyles: { fillColor: [248, 248, 248] },
        columnStyles: Object.fromEntries([...num].map(i => [i, { halign: 'right' }])) as any,
        didParseCell: d => {
          if (b.kv && d.column.index === 0) d.cell.styles.fontStyle = 'bold'
          if (d.section === 'head' && num.has(d.column.index)) d.cell.styles.halign = 'right'
        },
      })
      y = ((doc as any).lastAutoTable?.finalY ?? y) + 8
    }
  }
  const n = doc.getNumberOfPages()
  for (let i = 1; i <= n; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal').setFontSize(8).setTextColor(130)
    doc.text(`PicklePoint - page ${i} of ${n}`, W / 2, doc.internal.pageSize.getHeight() - 16, { align: 'center' })
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
