/** Front-page tabs for a knockout category, one job each:
 *  HubGames     = the games: on court now, coming up (court + order), results.
 *  HubStandings = the group tables and, for a printed draw (MCMD / MCXD),
 *                 the race for the quarter-finals across the groups. */
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { groupStandings, groupStageComplete, bracketSeeded, teamName, teamLogo, teamSideName, type Standing } from '../lib/store'
import { koPlanOf, planDraw } from '../lib/koplan'
import { gameTitle } from '../lib/pool'
import { courtLabel } from '../lib/teamstatus'
import { usePinned } from '../lib/pin'
import { Emblem } from './ui'
import { GroupTable } from './GroupsKo'
import FillGrid from './FillGrid'

const ON = new Set(['live', 'awaiting_confirm'])
const H = ({ children, right }: { children: ReactNode; right?: ReactNode }) => (
  <div className="mb-1.5 flex items-baseline justify-between gap-2 px-1">
    <h3 className="min-w-0 truncate whitespace-nowrap font-display text-base font-bold uppercase tracking-widest text-fg-muted">{children}</h3>
    {right && <span className="shrink-0 whitespace-nowrap text-[11px] text-fg-subtle">{right}</span>}
  </div>
)

/** court | team A | score or vs | team B — fixed tracks so every row lines up */
function Row({ b, code, m, left }: { b: Bundle; code: string; m: Match; left: ReactNode }) {
  const pins = usePinned()
  const live = ON.has(m.status), done = m.status === 'finished'
  const mine = pins.has(m.team_a_id ?? '') || pins.has(m.team_b_id ?? '')
  const cls = (id: string | null) => `${done ? (m.winner_id === id ? 'font-bold text-fg' : 'text-fg-subtle') : 'font-semibold text-fg'} ${pins.has(id ?? '') ? 'underline decoration-gold decoration-2 underline-offset-4' : ''}`
  const body = (
    <>
      <span className="min-w-0 text-[11px] font-bold uppercase leading-tight tracking-wide text-fg-subtle">{left}</span>
      <span className={`flex min-w-0 items-center justify-end gap-1.5 text-right ${cls(m.team_a_id)}`}>
        <span className="line-clamp-2 min-w-0 break-words leading-tight">{teamName(b, m.team_a_id)}</span>
        <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-6 w-6 shrink-0 rounded-[2px] object-contain" />
      </span>
      <span className="text-center">
        {live || done
          ? <span className={`tabular whitespace-nowrap font-display text-lg font-bold leading-none ${live ? 'text-red-400' : 'text-fg'}`}>{m.score_a}–{m.score_b}</span>
          : <span className="text-xs text-fg-subtle">vs</span>}
      </span>
      <span className={`flex min-w-0 items-center gap-1.5 ${cls(m.team_b_id)}`}>
        <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-6 w-6 shrink-0 rounded-[2px] object-contain" />
        <span className="line-clamp-2 min-w-0 break-words leading-tight">{teamName(b, m.team_b_id)}</span>
      </span>
    </>
  )
  const base = `grid min-h-[44px] grid-cols-[2.9rem_minmax(0,1fr)_3.7rem_minmax(0,1fr)] items-center gap-1.5 border-b border-line/60 px-3 py-2 text-sm last:border-0 ${mine ? 'bg-gold/[0.08]' : ''}`
  return live || done
    ? <Link to={`/c/${code}/match/${m.id}`} className={`${base} active:bg-surface-2`}>{body}</Link>
    : <div className={base}>{body}</div>
}

const Tag = ({ top, sub, tone = '' }: { top: string; sub?: string; tone?: string }) => (
  <>
    <span className={`block truncate ${tone}`}>{top}</span>
    {sub && <span className="block truncate text-[10px] font-semibold normal-case tracking-normal text-fg-subtle">{sub}</span>}
  </>
)

export function HubGames({ b, code }: { b: Bundle; code: string }) {
  const pins = usePinned()
  const hasMine = b.teams.some(t => pins.has(t.id))
  const [only, setOnly] = useState(false)
  const [all, setAll] = useState(false)
  const short = (m: Match) => gameTitle(b, m).replace(/ · Slot \d+$/, '').replace(/^Group /, 'Grp ')
  const ct = (id: string | null | undefined) => courtLabel(b, id).replace(/^Court /, 'Ct ')
  const keep = (m: Match) => !(only && hasMine) || pins.has(m.team_a_id ?? '') || pins.has(m.team_b_id ?? '')
  const known = (m: Match) => !!m.team_a_id && !!m.team_b_id
  const live = b.matches.filter(m => ON.has(m.status) && known(m) && keep(m)).sort((x, y) => x.sequence - y.sequence)
  const next = b.matches.filter(m => (m.status === 'scheduled' || m.status === 'on_deck') && known(m) && keep(m)).sort((x, y) => x.sequence - y.sequence)
  const done = b.matches.filter(m => m.status === 'finished' && known(m) && keep(m))
    .sort((x, y) => (y.finished_at ?? '').localeCompare(x.finished_at ?? '') || y.sequence - x.sequence)
  const shownNext = all ? next : next.slice(0, 9)
  const box = 'overflow-hidden rounded-xl border border-line bg-surface'
  return (
    <div className="mx-auto max-w-3xl space-y-5 p-3 lg:p-5">
      {hasMine && (
        <div className="flex gap-1.5">
          {[['All games', false], ['My team only', true]].map(([label, v]) => (
            <button key={String(v)} onClick={() => setOnly(v as boolean)}
              className={`min-h-[34px] whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${only === v ? 'border-gold bg-gold/15 text-fg' : 'border-line text-fg-muted'}`}>
              {label}
            </button>
          ))}
        </div>
      )}
      <section>
        <H right={live.length ? `${live.length} on court` : undefined}>On court now</H>
        <div className={box}>
          {live.length === 0 && <div className="px-3 py-4 text-center text-sm text-fg-muted">No game on court right now.</div>}
          {live.map(m => <Row key={m.id} b={b} code={code} m={m} left={<Tag top={`● ${ct(m.court_id)}`} sub={short(m)} tone="text-red-400" />} />)}
        </div>
      </section>
      <section>
        <H right={next.length ? `${next.length} to play` : undefined}>Coming up</H>
        <div className={box}>
          {next.length === 0 && <div className="px-3 py-4 text-center text-sm text-fg-muted">
            {b.matches.some(m => m.status !== 'finished') ? 'The next games appear here once the teams are known.' : 'All games have been played.'}
          </div>}
          {shownNext.map(m => <Row key={m.id} b={b} code={code} m={m} left={<Tag top={ct(m.court_id ?? m.home_court) || '—'} sub={short(m)} />} />)}
          {next.length > shownNext.length && (
            <button onClick={() => setAll(true)} className="min-h-[40px] w-full px-3 py-2 text-xs font-semibold text-fg-muted active:bg-surface-2">
              Show all {next.length} games ▾
            </button>
          )}
        </div>
      </section>
      <section>
        <H right={done.length ? 'tap a game for the point log' : undefined}>Results</H>
        <div className={box}>
          {done.length === 0 && <div className="px-3 py-4 text-center text-sm text-fg-muted">No game finished yet.</div>}
          {done.map(m => <Row key={m.id} b={b} code={code} m={m} left={<Tag top={short(m)} sub={ct(m.court_id)} />} />)}
        </div>
      </section>
    </div>
  )
}

// ---------------------------------------------------------------- standings
type Row8 = Standing & { team: Standing['team'] }

function RaceTable({ b, title, note, rows, cut, level, label, settled }: {
  b: Bundle; title: string; note: string; rows: Row8[]; cut: number; level: boolean[]; label: string; settled: boolean
}) {
  const pins = usePinned()
  return (
    <div className="rounded-xl border border-line bg-surface p-2">
      <div className="px-1 pb-1">
        <div className="font-display text-base font-bold uppercase tracking-wide">{title}</div>
        <div className="text-[11px] text-fg-muted">{note}</div>
      </div>
      <table className="w-full table-fixed text-sm">
        <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
          <tr>
            <th className="w-9 px-1 py-1 text-left">#</th>
            <th className="px-1 py-1 text-left">Team</th>
            <th className="w-7 px-1 py-1 text-right">P</th>
            <th className="w-7 px-1 py-1 text-right">W</th>
            <th className="w-11 px-2 py-1 text-right">+/-</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => {
            const q = i < cut
            const tied = settled && ((level[i] && i + 1 < rows.length) || (i > 0 && level[i - 1]))
            return (
              <tr key={r.team.id} className={`${q ? 'bg-brand/[0.08]' : ''} ${pins.has(r.team.id) ? 'outline outline-2 -outline-offset-2 outline-gold/70' : ''} ${i === cut - 1 && i < rows.length - 1 ? 'border-b-2 border-dashed !border-line-strong' : ''}`}>
                <td className={`px-1 py-1.5 text-xs font-bold ${q ? 'text-brand-ink' : 'text-fg-subtle'}`}>{label}{i + 1}</td>
                <td className="px-1 py-1.5">
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="h-6 w-7 shrink-0 rounded-[2px] object-contain" />
                    <span className="min-w-0 flex-1">
                      <span className={`block truncate ${q ? 'font-semibold text-fg' : 'text-fg-muted'}`}>{r.team.name}</span>
                      <span className="block truncate text-[10px] text-fg-subtle">Group {r.team.pool}{tied ? ' · level, coin toss' : ''}</span>
                    </span>
                  </span>
                </td>
                <td className="tabular px-1 py-1.5 text-right text-fg-muted">{r.played}</td>
                <td className="tabular px-1 py-1.5 text-right font-bold">{r.won}</td>
                <td className={`tabular px-2 py-1.5 text-right ${r.diff > 0 ? 'text-brand-ink' : r.diff < 0 ? 'text-red-400' : 'text-fg-muted'}`}>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
              </tr>
            )
          })}
        </tbody>
      </table>
    </div>
  )
}

export function HubStandings({ b, ev, fallback }: { b: Bundle; ev: EventCfg | undefined; fallback: ReactNode }) {
  const plan = koPlanOf(b.competition.code)
  if (!ev || !plan) return <>{fallback}</>
  const tables = groupStandings(b, ev.id)
  const pd = planDraw(plan, tables as any)
  const nR = new Set(plan.pairs.flat().filter(t => /^R\d/.test(t))).size
  const nW = pd.winners.ranked.length
  const complete = groupStageComplete(b, ev.id)
  const seeded = bracketSeeded(b, ev.id)
  const state = seeded ? 'Final — the quarter-finals are drawn.' : complete ? 'Groups finished — waiting for the organiser to confirm the draw.' : 'So far — changes after every game.'
  return (
    <div className="space-y-5 p-3 lg:p-5">
      <section>
        <H>Who goes to the quarter-finals</H>
        <div className="mb-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted">
          <span className="font-semibold text-fg">{nW} group winners + the {nR} best runners-up = 8 teams.</span>{' '}
          Ranked by wins, then point difference (points won minus points lost). Still level: coin toss. {state}
        </div>
        <FillGrid max={2} className="gap-3">
          <RaceTable b={b} title="Group winners" note="All go through. The order decides who they meet."
            rows={pd.winners.ranked as any} cut={nW} level={pd.winners.level} label="W" settled={complete} />
          <RaceTable b={b} title="Runners-up" note={`Only the best ${nR} go through.`}
            rows={pd.runners.ranked as any} cut={nR} level={pd.runners.level} label="R" settled={complete} />
        </FillGrid>
      </section>
      <section>
        <H>Groups</H>
        <FillGrid className="gap-3">
          {Object.keys(tables).sort().map(g => (
            <div key={g} className="rounded-xl border border-line bg-surface p-2">
              <GroupTable b={b} g={g} rows={tables[g]} advance={1} />
            </div>
          ))}
        </FillGrid>
      </section>
    </div>
  )
}
