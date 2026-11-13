/** Front-page tabs for a knockout category, one job each:
 *  HubGames     = the games: on court now, coming up (court + order), results.
 *  HubStandings = the group tables and, for a printed draw (MCMD / MCXD),
 *                 the race for the quarter-finals across the groups. */
import { isAlert, alertWord } from '../lib/alert'
import { useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { groupStandings, groupStageComplete, bracketSeeded, teamName, teamLogo, teamSideName, type Standing } from '../lib/store'
import { koPlanOf, planDraw, slotName, cutReasons } from '../lib/koplan'
import { gameTitle } from '../lib/pool'
import { courtLabel } from '../lib/teamstatus'
import { hubOf, parentHub } from '../lib/hub'
import { slotOf, slotTime, clockOfCode } from '../lib/timetable'
import { usePinned } from '../lib/pin'
import { Emblem, PairName, hasFlag, Clock } from './ui'
import { GroupTable, TeamLink } from './GroupsKo'
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
      <div className="mb-1.5 flex min-w-0 text-[11px] font-bold uppercase leading-tight tracking-wide text-fg-subtle">{left}</div>
      <div className="grid grid-cols-[minmax(0,1fr)_1.5rem_3.6rem_1.5rem_minmax(0,1fr)] items-center gap-x-1.5">
      <span className={`min-w-0 text-right leading-tight ${cls(m.team_a_id)}`}><TeamLink b={b} id={m.team_a_id} className="block"><Stack name={teamName(b, m.team_a_id)} /></TeamLink></span>
      <span className="flex h-6 w-6 items-center justify-center">{m.team_a_id && <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
      <span className="text-center">
        {live || done
          ? <span className={`tabular whitespace-nowrap font-display text-lg font-bold leading-none ${live ? 'text-emerald-400' : 'text-fg'}`}>{m.score_a}–{m.score_b}</span>
          : <span className="text-xs text-fg-subtle">vs</span>}
      </span>
      <span className="flex h-6 w-6 items-center justify-center">{m.team_b_id && <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-6 w-6 shrink-0 rounded-[3px]" />}</span>
      <span className={`min-w-0 text-left leading-tight ${cls(m.team_b_id)}`}><TeamLink b={b} id={m.team_b_id} className="block"><Stack name={teamName(b, m.team_b_id)} /></TeamLink></span>
      </div>
    </>
  )
  const base = `block border-b border-line/60 px-3 py-2.5 text-[14px] last:border-0 ${mine ? 'bg-gold/[0.08]' : ''}`
  return live || done
    ? <Link to={`/c/${code}/match/${m.id}`} className={`${base} active:bg-surface-2`}>{body}</Link>
    : <div className={base}>{body}</div>
}

/** one player per line (no "/" and nothing cut off) */
const Stack = ({ name }: { name: string | null | undefined }) => {
  const parts = (name ?? '').split(/\s+\/\s+|\s*\|\s*/).filter(Boolean)
  return <>{(parts.length ? parts : ['—']).map((x, i) => <span key={i} className="block truncate">{x}</span>)}</>
}
const TIME = /^\d{1,2}:\d{2}\s*[ap]m$/i
/** the game's header line: court (and time) on the left, what stage it is on the right */
const Tag = ({ top, sub, sub2, tone = '' }: { top: string; sub?: string; sub2?: string; tone?: string }) => {
  const time = sub && TIME.test(sub) ? sub : null
  const right = sub2 ?? (sub && !time ? sub : null)
  return (
    <span className="flex w-full items-baseline justify-between gap-3">
      <span className={`flex min-w-0 items-baseline gap-2.5 ${tone}`}>
        <span className="whitespace-nowrap">{top}</span>
        {time && <Clock t={time} className="text-[12px] text-fg-muted" />}
      </span>
      {right && <span className={`min-w-0 truncate text-right text-[10.5px] font-semibold normal-case tracking-normal ${sub2 && tone ? tone : 'text-fg-subtle'}`}>{right}</span>}
    </span>
  )
}

export function HubGames({ b, code }: { b: Bundle; code: string }) {
  const pins = usePinned()
  const hasMine = b.teams.some(t => pins.has(t.id))
  const [only, setOnly] = useState(false)
  const [all, setAll] = useState(false)
  const short = (m: Match) => gameTitle(b, m).replace(/ · Slot \d+$/, '')
  const clock = clockOfCode(b.competition?.code ?? code)
  const when = (m: Match) => { const sl = clock ? slotOf(b, m) : null; return sl != null && clock ? slotTime(clock, sl) : '' }
  const ct = (id: string | null | undefined) => courtLabel(b, id)
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
          {live.map(m => <Row key={m.id} b={b} code={code} m={m} left={<Tag top={`● ${ct(m.court_id)}`} sub={short(m)} tone="text-emerald-400" />} />)}
        </div>
      </section>
      <section>
        <H right={next.length ? `${next.length} to play` : undefined}>Coming up</H>
        <div className={box}>
          {next.length === 0 && <div className="px-3 py-4 text-center text-sm text-fg-muted">
            {b.matches.some(m => m.status !== 'finished') ? 'The next games appear here once the teams are known.' : 'All games have been played.'}
          </div>}
          {shownNext.map(m => <Row key={m.id} b={b} code={code} m={m} left={<Tag top={ct(m.court_id ?? m.home_court) || '—'} sub={when(m) || short(m)} sub2={isAlert(m) ? alertWord(m) : when(m) ? short(m) : undefined} tone={isAlert(m) ? 'text-red-500' : ''} />} />)}
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
            <th className="w-7 px-0.5 py-1 text-center" title="Group">Grp</th>
            <th className="px-1 py-1 text-left">Team</th>
            <th className="w-10 px-0 py-1 text-center" title="Games played">P</th>
            <th className="w-10 px-0 py-1 text-center" title="Wins">W</th>
            <th className="w-10 px-0 py-1 text-center" title="Point difference: points won minus points lost">+/-</th>
            <th className="w-10 px-0 py-1 text-center" title="Points scored">Pts</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-line">
          {rows.map((r, i) => {
            const q = i < cut
            const tied = settled && ((level[i] && i + 1 < rows.length) || (i > 0 && level[i - 1]))
            return (
              <tr key={r.team.id} className={`${q ? 'bg-brand/[0.08]' : ''} ${pins.has(r.team.id) ? 'outline outline-2 -outline-offset-2 outline-gold/70' : ''} ${i === cut && cut > 0 ? '!border-t-2 border-dashed !border-line-strong' : ''}`}>
                <td className={`px-1 py-2 align-middle text-xs font-bold ${q ? 'text-brand-ink' : 'text-fg-subtle'}`}>{label}{i + 1}</td>
                <td className="px-0.5 py-2 text-center align-middle text-xs text-fg-muted">{r.team.pool}</td>
                <td className="px-1 py-2 align-middle">
                  <span className="flex min-w-0 items-center gap-1.5">
                    {(teamLogo(b, r.team.id) || hasFlag(teamSideName(b, r.team.id))) && <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="h-6 w-7 shrink-0 rounded-[2px] object-contain" />}
                    <span className={`min-w-0 flex-1 truncate ${q ? 'font-semibold text-fg' : 'text-fg-muted'}`}><TeamLink b={b} id={r.team.id}>{r.team.name}</TeamLink></span>
                    {tied && <span className="shrink-0 rounded bg-gold/20 px-1 text-[9px] font-bold uppercase leading-4 text-gold">coin toss</span>}
                  </span>
                </td>
                <td className="tabular px-0 py-2 text-center align-middle text-fg-muted">{r.played}</td>
                <td className="tabular px-0 py-2 text-center align-middle font-bold">{r.won}</td>
                <td className={`tabular px-0 py-2 text-center align-middle ${r.diff > 0 ? 'text-brand-ink' : r.diff < 0 ? 'text-red-400' : 'text-fg-muted'}`}>{r.diff > 0 ? `+${r.diff}` : r.diff}</td>
                <td className="tabular px-0 py-2 text-center align-middle text-fg-muted">{r.pf}</td>
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
  // before the first result everyone is level at 0: no team is "through" yet
  const played = b.matches.some(m => m.event_id === ev.id && m.bracket_key == null && m.status === 'finished')
  const seeded = bracketSeeded(b, ev.id)
  const state = seeded ? 'Final: the quarter-finals are drawn.' : complete ? 'Groups finished: the quarter-finals appear in a moment.' : played ? 'So far, it changes after every game.' : 'No result yet: the order below is only alphabetical until the first game ends.'
  const run = pd.runners.ranked as unknown as Standing[]
  const why = played ? cutReasons(run, nR) : []
  const qf = (complete ? pd.tokens : plan.pairs).map(([x, y], i) => ({ n: i + 1, a: slotName(x), b: slotName(y), moved: plan.pairs[i][0] !== x || plan.pairs[i][1] !== y }))
  return (
    <div className="space-y-5 p-3 lg:p-5">
      <section>
        <H>Who goes to the quarter-finals</H>
        <div className="mb-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted">
          <span className="font-semibold text-fg">{nW} group winners + the {nR} best runners-up = 8 teams.</span>{' '}
          Ranked by wins, then point difference (points won minus points lost), then points scored. Still level: coin toss. {state}
        </div>
        <FillGrid max={2} className="gap-3">
          <RaceTable b={b} title="Group winners" note="All go through, each to its own quarter-final."
            rows={pd.winners.ranked as any} cut={played ? nW : 0} level={pd.winners.level} label="W" settled={complete} />
          <div>
            <RaceTable b={b} title="Runners-up" note={`Only the best ${nR} go through (R1 to R${nR}).`}
              rows={pd.runners.ranked as any} cut={played ? nR : 0} level={pd.runners.level} label="R" settled={complete} />
            {why.length > 0 && (
              <div className="mt-2 rounded-xl border border-line bg-surface px-3 py-2 text-xs leading-relaxed text-fg-muted">
                <div className="mb-0.5 font-semibold text-fg">{complete ? 'Why this order' : 'Why this order (so far)'}</div>
                {why.map((w, i) => <div key={i}>{w}</div>)}
              </div>
            )}
          </div>
        </FillGrid>
        <div className="mt-3 rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted">
          <div className="mb-1 font-semibold text-fg">Quarter-finals</div>
          {qf.map(x => (
            <div key={x.n} className="grid grid-cols-[2.4rem_minmax(0,1fr)] gap-x-2 py-0.5">
              <span className="font-bold text-fg">QF{x.n}</span>
              <span>{x.a} v {x.b}{x.moved ? ' (moved)' : ''}</span>
            </div>
          ))}
          {complete && pd.swapped && <div className="mt-1 text-gold">Runners-up changed places so that no team meets the winner of its own group again in the quarter-finals.</div>}
          {!complete && <div className="mt-1">If a best runner-up would meet the winner of its own group, the runners-up change places.</div>}
          <div className="mt-1">Tap a team name to see every game it played and check its +/-.</div>
        </div>
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
