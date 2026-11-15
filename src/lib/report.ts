/** "Download full results": a self-contained report (HTML, prints to PDF) and a
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

const esc = (s: unknown) => String(s ?? '').replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!))
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
    .sort((x, y) => (x.m.started_at ?? '9').localeCompare(y.m.started_at ?? '9') || (x.m.slot ?? 99) - (y.m.slot ?? 99) || x.m.sequence - y.m.sequence)
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

const table = (head: string[], body: Array<Array<string | number>>, num: number[] = []) =>
  `<table><thead><tr>${head.map((h, i) => `<th${num.includes(i) ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${
    body.map(r => `<tr>${r.map((v, i) => `<td${num.includes(i) ? ' class="n"' : ''}>${esc(v)}</td>`).join('')}</tr>`).join('')}</tbody></table>`

function catSection(c: Cat, hub: Hub): string {
  const rows = rowsOf(c, hub)
  const done = rows.filter(r => r.m.status === 'finished')
  const res = categoryResult(c.b)
  const p = res.podium
  let h = `<section><h2>${esc(c.label)}</h2>`
  const pod = [['🥇 Champion', p.first], ['🥈 Runner-up', p.second], ['🥉 3rd place', p.third], ['4th place', p.fourth ?? null]]
    .filter(([, n]) => n) as Array<[string, string]>
  h += pod.length ? `<div class="pod">${pod.map(([k, n]) => {
    const t = c.b.teams.find(x => x.name === n)
    return `<div><b>${esc(k)}</b><span>${esc(n)}</span>${players(t) && players(t) !== n ? `<i>${esc(players(t))}</i>` : ''}</div>`
  }).join('')}</div>` : '<p class="muted">Final placings not decided yet.</p>'

  // key figures
  const pts = done.reduce((s, r) => s + r.sa + r.sb, 0)
  const margin = (r: Row) => Math.abs(r.sa - r.sb)
  const big = [...done].sort((a, z) => margin(z) - margin(a))[0]
  const close = [...done].filter(r => r.winner).sort((a, z) => margin(a) - margin(z) || (z.sa + z.sb) - (a.sa + a.sb))[0]
  const high = [...done].sort((a, z) => (z.sa + z.sb) - (a.sa + a.sb))[0]
  const timed = done.filter(r => r.secs && r.secs > 60)
  const avg = timed.length ? Math.round(timed.reduce((s, r) => s + r.secs!, 0) / timed.length) : 0
  const long = [...timed].sort((a, z) => z.secs! - a.secs!)[0]
  const g = (r?: Row) => (r ? `${r.a} ${r.sa}–${r.sb} ${r.bName} (${r.stage})` : '—')
  h += `<h3>Key figures</h3>${table(['', ''], [
    ['Teams', c.b.teams.filter(t => evsOf(c, hub).some(e => e.id === t.event_id)).length],
    ['Games played', `${done.length} of ${rows.length}`],
    ['Total points scored', pts],
    ['Average points per game', done.length ? (pts / done.length).toFixed(1) : '—'],
    ['Biggest win', g(big)],
    ['Closest game', g(close)],
    ['Highest-scoring game', g(high)],
    ...(avg ? [['Average game length', dur(avg)], ['Longest game', `${g(long)} · ${dur(long?.secs)}`]] as Array<[string, string]> : []),
  ])}`

  // group tables
  for (const ev of evsOf(c, hub)) {
    if (ev.sport === 'captainball') {
      const pools = [...new Set(c.b.teams.filter(t => t.event_id === ev.id).map(t => t.pool ?? 'A'))].sort()
      for (const pl of pools) {
        const t = cbStandings(c.b, ev.id, pl)
        if (!t.length) continue
        h += `<h3>Group ${esc(pl)}</h3>${table(['#', 'Team', 'P', 'W', 'D', 'L', 'PF', 'PA', '+/-', 'Pts'],
          t.map((r, i) => [i + 1, r.team.name, r.p, r.w, r.d, r.l, r.pf, r.pa, r.diff > 0 ? `+${r.diff}` : r.diff, r.pts]), [0, 2, 3, 4, 5, 6, 7, 8, 9])}`
      }
    } else if (ev.format === 'groups_ko') {
      const gt = groupStandings(c.b, ev.id)
      for (const k of Object.keys(gt).sort()) {
        h += `<h3>Group ${esc(k)}</h3>${table(['#', 'Team', 'Players', 'P', 'W', 'L', 'PF', 'PA', '+/-'],
          gt[k].map((r, i) => [i + 1, r.team.name, players(r.team) === r.team.name ? '' : players(r.team), r.played, r.won, r.lost, r.pf, r.pa, r.diff > 0 ? `+${r.diff}` : r.diff]), [0, 3, 4, 5, 6, 7, 8])}`
      }
    }
  }

  // knockout
  const ko = rows.filter(r => r.isKo)
  if (ko.length) h += `<h3>Knockout</h3>${table(['Stage', 'Time', 'Court', 'Team', 'Score', 'Team', 'Winner'],
    ko.map(r => [r.stage, r.time, r.court, r.a, r.m.status === 'scheduled' ? '–' : `${r.sa} – ${r.sb}`, r.bName, r.winner]), [1, 2, 4])}`

  // every team's record
  h += `<h3>Team records (all games)</h3>${table(['#', 'Team', 'P', 'W', 'L', 'PF', 'PA', '+/-', 'Win %', 'Best score'],
    records(c, rows).map((r, i) => [i + 1, r.name, r.p, r.w, r.l, r.pf, r.pa, r.pf - r.pa > 0 ? `+${r.pf - r.pa}` : r.pf - r.pa,
      r.p ? `${Math.round((r.w / r.p) * 100)}%` : '—', r.best]), [0, 2, 3, 4, 5, 6, 7, 8, 9])}`

  // every game
  h += `<h3>All games</h3>${table(['Time', 'Court', 'Stage', 'Team', 'Score', 'Team', 'Winner', 'Length'],
    rows.map(r => [r.time, r.court, r.stage, r.a, r.m.status === 'scheduled' ? '–' : `${r.sa} – ${r.sb}`, r.bName, r.winner || r.status, dur(r.secs)]), [0, 1, 4, 7])}`
  return h + '</section>'
}

const dateOf = (cats: Cat[]) => cats.find(c => c.b.competition.event_date)?.b.competition.event_date ?? ''
const titleOf = (hub: Hub, cats: Cat[]) => hubTitle(hub, cats.map(c => c.b.competition.name))

export function reportHtml(hub: Hub, cats: Cat[]): string {
  const title = titleOf(hub, cats)
  const when = dateOf(cats)
  let body = `<header><h1>${esc(title)}</h1><p>Full results &amp; analysis${when ? ` · ${esc(new Date(when + 'T00:00:00').toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }))}` : ''}</p>
<p class="muted">Downloaded ${esc(new Date().toLocaleString('en-GB'))} from pickle-point.vercel.app/c/${esc(hub.code)}</p></header>`
  if (!hub.noChurch) {
    const res = cats.map(c => categoryResult(c.b))
    const mt = medalTable(res, cats.map(c => c.b))
    const four = needsFourth(mt)
    body += `<section><h2>Total Champion</h2>${table(['#', 'Church', '🥇', '🥈', '🥉', ...(four ? ['4th'] : [])],
      mt.map((r, i) => [i + 1, r.name, r.gold, r.silver, r.bronze, ...(four ? [r.fourth] : [])]), [0, 2, 3, 4, 5])}
      <h3>Category winners</h3>${table(['Category', 'Champion', 'Runner-up', '3rd place'],
      res.map((r, i) => [cats[i].label, r.podium.first ?? '—', r.podium.second ?? '—', r.podium.third ?? '—']))}</section>`
  }
  body += cats.map(c => catSection(c, hub)).join('')
  return `<!DOCTYPE html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(title)} – Full results</title><style>
body{font:14px/1.45 system-ui,-apple-system,Segoe UI,Roboto,sans-serif;color:#111;margin:0;padding:16px;max-width:1000px;margin:auto}
header{border-bottom:3px solid #111;margin-bottom:12px}h1{margin:0 0 4px;font-size:24px}
h2{font-size:20px;margin:28px 0 8px;padding:6px 10px;background:#111;color:#fff;border-radius:6px}h3{font-size:15px;margin:18px 0 6px}
table{border-collapse:collapse;width:100%;margin-bottom:6px;font-size:13px}th,td{border-bottom:1px solid #ddd;padding:5px 6px;text-align:left;vertical-align:top}
th{background:#f3f3f3;font-weight:600}.n{text-align:right;white-space:nowrap;font-variant-numeric:tabular-nums}tr:nth-child(even) td{background:#fafafa}
.pod{display:grid;grid-template-columns:repeat(auto-fit,minmax(170px,1fr));gap:8px}.pod div{border:1px solid #ddd;border-radius:8px;padding:8px}
.pod b{display:block;font-size:12px;color:#555}.pod span{font-weight:700;font-size:15px}.pod i{display:block;font-size:12px;color:#555}
.muted{color:#777;font-size:12px}section{break-inside:auto}h2{break-after:avoid}@media print{body{padding:0}h2{-webkit-print-color-adjust:exact;print-color-adjust:exact}}
</style></head><body>${body}<p class="muted" style="margin-top:24px">Tip: open this file and use Print → Save as PDF for a PDF copy.</p></body></html>`
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

export function saveFile(name: string, text: string, type: string) {
  const url = URL.createObjectURL(new Blob([text], { type }))
  const a = document.createElement('a')
  a.href = url; a.download = name; document.body.appendChild(a); a.click(); a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 30000)
}

/** marker an organiser puts in an announcement to show the download buttons (hidden from the text) */
export const DOWNLOAD_MARK = /\s*\[download\]\s*/i
