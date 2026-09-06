import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, liveOnCourt, nextOnCourt, results, standings,
  eventOf, duelTally, duelPods,
} from '../lib/store'
import { displayScores } from '../lib/scoring'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { Screen, Pill, Spinner, FullscreenButton, Flag, ThemeToggle } from '../components/ui'
import Court from '../components/Court'
import { IS_DEMO, demo } from '../lib/api'

type Tab = 'live' | 'schedule' | 'standings' | 'results'

export default function Board() {
  const { code } = useParams()
  const { bundle, error, loading, reload } = useCompetition(code)
  const [tab, setTab] = useState<Tab>('live')
  const [tv, setTv] = useState(false)

  if (loading) return <Screen><Spinner /></Screen>
  if (error || !bundle) return (
    <Screen className="flex flex-col items-center justify-center gap-4 px-6">
      <div className="text-center text-fg-muted">
        No competition found for code <span className="font-bold text-fg">{code}</span>
      </div>
      <Link to="/" className="rounded-xl border border-line px-4 py-2 text-sm">Try again</Link>
    </Screen>
  )

  const c = bundle.competition
  const duelEvent = bundle.events.find(e => e.format === 'duel')

  // ---- TV mode: dedicated, centred fullscreen presentation ----
  if (tv) {
    return (
      <div className="fixed inset-0 flex flex-col justify-center gap-5 overflow-auto bg-canvas py-6 text-fg"
        style={{
          paddingTop: 'max(env(safe-area-inset-top), 1.5rem)',
          paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}>
        {/* discreet controls, top-right */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2 opacity-30 transition-opacity hover:opacity-100">
          <button onClick={() => setTv(false)}
            className="rounded-lg border border-line bg-surface/70 px-3 py-1.5 text-xs text-fg-muted">
            exit TV
          </button>
          <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface/70 p-1.5 text-fg-muted" />
        </div>

        {/* title */}
        <div className="shrink-0 px-8 text-center">
          <div className="font-display text-3xl font-bold tracking-wide sm:text-4xl">{c.name}</div>
          {c.venue && <div className="mt-0.5 text-sm text-fg-muted">{c.venue}</div>}
        </div>

        {/* big scoreboard */}
        {duelEvent && (
          <div className="shrink-0 px-8">
            <DuelScoreboard b={bundle} ev={duelEvent} big />
          </div>
        )}

        {/* courts */}
        <div className="shrink-0 px-8">
          <div className="mx-auto w-full max-w-[1600px]">
            <LiveGrid b={bundle} code={code!} tv />
          </div>
        </div>
      </div>
    )
  }

  return (
    <Screen>
      {duelEvent && <DuelScoreboard b={bundle} ev={duelEvent} big={false} />}

      <div className="border-b border-line px-4 py-3 lg:px-6 lg:py-4">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-display text-2xl font-bold tracking-wide lg:text-3xl">{c.name}</div>
            <div className="truncate text-xs text-fg-muted lg:text-sm">
              {c.venue} · code <span className="font-bold text-brand-ink">{c.code}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
            <Link to={`/c/${code}/admin`}
              className="flex h-8 items-center rounded-lg border border-line px-3 text-xs text-fg-muted active:bg-surface-2 lg:h-10 lg:px-4 lg:text-sm">
              Settings
            </Link>
            <button onClick={() => setTv(true)}
              className="flex h-8 items-center rounded-lg border border-line px-3 text-xs text-fg-muted active:bg-surface-2 lg:h-10 lg:px-4 lg:text-sm">
              TV mode
            </button>
            <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-line p-1.5 text-fg-muted active:bg-surface-2 lg:h-10 lg:w-10" />
            <ThemeToggle className="grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2 lg:h-10 lg:w-10" />
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto lg:mt-4 lg:gap-2">
          {(['live', 'schedule', 'standings', 'results'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider lg:px-4 lg:py-2 lg:text-sm ${
                tab === t ? 'bg-brand text-brand-fg' : 'text-fg-muted'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live' && <LiveGrid b={bundle} code={code!} tv={false} />}
      {tab === 'schedule' && <Schedule b={bundle} />}
      {tab === 'standings' && <Standings b={bundle} />}
      {tab === 'results' && <Results b={bundle} code={code!} />}

      {IS_DEMO && (
        <div className="px-4 py-8 text-center">
          <button onClick={() => { demo.reset(); location.reload() }}
            className="text-xs text-fg-subtle underline underline-offset-4">
            reset demo data
          </button>
        </div>
      )}
    </Screen>
  )
}

// ------------------------------------------------------------- live grid
function LiveGrid({ b, code, tv }: { b: Bundle; code: string; tv: boolean }) {
  return (
    <div className={tv ? '' : 'p-3 lg:p-5'}>
      <div className={`grid gap-3 lg:gap-5 ${tv ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-3'}`}>
        {b.courts.map(ct => {
          const m = liveOnCourt(b, ct.id)
          const up = nextOnCourt(b, ct.id)
          return (
            <Link key={ct.id} to={`/c/${code}/court/${ct.number}`}
              className="block rounded-2xl border border-line bg-surface p-3 active:scale-[0.99] lg:p-4">
              <div className="mb-2 flex items-center justify-between lg:mb-3">
                <span className="font-display text-lg font-bold tracking-widest text-fg-muted lg:text-xl">
                  COURT {ct.number}
                </span>
                {m ? <Pill tone="live">● live</Pill> : <Pill>open</Pill>}
              </div>

              {m ? <CourtScoreRow b={b} m={m} tv={tv} /> : (
                <div className="py-6 text-center text-sm text-fg-subtle lg:py-10">No match running</div>
              )}

              {up && (
                <div className="mt-3 border-t border-line pt-2 text-[11px] text-fg-muted lg:mt-4 lg:pt-3 lg:text-sm">
                  Next: {teamName(b, up.team_a_id)} vs {teamName(b, up.team_b_id)}
                </div>
              )}
            </Link>
          )
        })}
      </div>

      {!tv && (
        <div className="mt-4">
          <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-accent">
            On deck
          </div>
          <div className={`grid gap-3 ${tv ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-3'}`}>
            {b.courts.map(ct => {
              const ups = b.matches
                .filter(mm => mm.court_id === ct.id && (mm.status === 'scheduled' || mm.status === 'on_deck'))
                .sort((x, y) => x.sequence - y.sequence)
              return (
                <div key={ct.id} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="mb-1.5 font-display text-xs font-bold uppercase tracking-widest text-fg-muted">
                    Court {ct.number}
                  </div>
                  {ups.length === 0 ? (
                    <div className="py-1.5 text-xs text-fg-subtle">No upcoming matches</div>
                  ) : (
                    <div className="divide-y divide-line/60">
                      {ups.map((mm, i) => (
                        <div key={mm.id} className="grid grid-cols-[1.1rem_1fr_1.75rem_1fr] items-center gap-1.5 py-1.5 text-sm">
                          <span className="text-center font-display text-xs font-bold text-fg-subtle">{i + 1}</span>
                          <span className="flex items-center justify-end gap-1.5 text-fg-muted">
                            <span className="w-16 truncate text-right">{teamName(b, mm.team_a_id)}</span>
                            <Flag name={teamSideName(b, mm.team_a_id)} className="h-3.5 w-auto shrink-0 rounded-[1px]" />
                          </span>
                          <span className="text-center text-xs text-fg-subtle">vs</span>
                          <span className="flex items-center justify-start gap-1.5 text-fg-muted">
                            <Flag name={teamSideName(b, mm.team_b_id)} className="h-3.5 w-auto shrink-0 rounded-[1px]" />
                            <span className="w-16 truncate text-left">{teamName(b, mm.team_b_id)}</span>
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
      )}
    </div>
  )
}

function CourtScoreRow({ b, m }: { b: Bundle; m: Match; tv: boolean }) {
  const s = displayScores(m)
  const ev = eventOf(b, m)
  const sideName = (teamId: string | null): string | null => {
    const t = b.teams.find(x => x.id === teamId)
    if (!t?.side) return null
    return (t.side === 'A' ? ev.side_a_name : ev.side_b_name) ?? null
  }
  const leftTeamId = m.a_on_left ? m.team_a_id : m.team_b_id
  const rightTeamId = m.a_on_left ? m.team_b_id : m.team_a_id
  return (
    <div className="aspect-[2/1] lg:aspect-[7/4]">
      <Court
        leftName={teamName(b, leftTeamId)}
        rightName={teamName(b, rightTeamId)}
        leftScore={s.left} rightScore={s.right}
        leftFlag={sideName(leftTeamId)} rightFlag={sideName(rightTeamId)}
        onTap={() => {}} disabled
      />
    </div>
  )
}

// -------------------------------------------------------------- schedule
// Read-only on the public board. Reordering lives in the admin panel.
function Schedule({ b }: { b: Bundle }) {
  const upcoming = b.matches
    .filter(m => m.status !== 'finished')
    .sort((x, y) => x.sequence - y.sequence)
  const fl = "mr-1.5 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]"
  return (
    <div className="divide-y divide-line">
      {upcoming.map(m => (
        <div key={m.id} className="flex items-center gap-4 px-4 py-3.5">
          <div className="w-10 shrink-0 text-center font-display text-lg font-bold text-fg-subtle">
            {b.courts.find(c => c.id === m.court_id)?.number ?? '–'}
          </div>
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm leading-relaxed">
              <Flag name={teamSideName(b, m.team_a_id)} className={fl} />{teamName(b, m.team_a_id)}<span className="mx-2 text-fg-subtle">vs</span><Flag name={teamSideName(b, m.team_b_id)} className={fl} />{teamName(b, m.team_b_id)}
            </div>
            <div className="mt-1 text-[11px] tracking-wide text-fg-subtle">{(m.round ?? '').replace(/pod/i, 'Court')} · #{m.sequence}</div>
          </div>
          {m.status === 'live'
            ? <Pill tone="live">live</Pill>
            : <Pill>{m.status.replace('_', ' ')}</Pill>}
        </div>
      ))}
    </div>
  )
}

// -------------------------------------------------------------- duel mode
function DuelScoreboard({ b, ev, big }: { b: Bundle; ev: EventCfg; big: boolean }) {
  const t = duelTally(b, ev.id)
  const aName = ev.side_a_name || 'Side A', bName = ev.side_b_name || 'Side B'
  const nameSz = big ? 'text-2xl sm:text-4xl' : 'text-base lg:text-2xl'
  const scoreSz = big ? 'text-6xl sm:text-8xl' : 'text-3xl lg:text-5xl'
  const flagSz = big ? 'h-9 sm:h-12' : 'h-5 lg:h-8'
  const dashSz = big ? 'text-4xl sm:text-6xl' : 'text-xl lg:text-3xl'
  return (
    <div className={`px-4 ${big ? '' : 'border-b border-line py-3 lg:py-6'}`}>
      <div className={`mb-2 text-center text-fg-subtle ${big ? 'text-sm' : 'text-xs lg:mb-3 lg:text-sm'}`}>
        {t.gamesPlayed} of {t.gamesTotal} games played
        {t.gamesPlayed > 0 && ` · points ${t.sideAPoints}–${t.sideBPoints}`}
        {t.gamesPlayed === t.gamesTotal && t.gamesTotal > 0 && (
          <span className="ml-2 font-bold text-brand-ink">
            {t.leader === 'tie' ? '— tied' : `— ${t.leader === 'A' ? aName : bName} win${t.gamesPlayed !== 1 ? '' : 's'}!`}
          </span>
        )}
      </div>

      <div className="mx-auto flex max-w-5xl items-center justify-center gap-4 sm:gap-8 lg:gap-12">
        {/* side A */}
        <div className="flex min-w-0 flex-1 items-center justify-end gap-3 sm:gap-4">
          <Flag name={aName} className={`${flagSz} w-auto shrink-0 rounded-[2px]`} />
          <span className={`truncate font-display font-bold tracking-wide ${nameSz} ${t.leader === 'A' ? 'text-fg' : 'text-fg-muted'}`}>
            {aName}
          </span>
          <span className={`tabular shrink-0 font-display font-bold leading-none text-brand-ink ${scoreSz}`}>
            {t.sideAWins}
          </span>
        </div>

        <span className={`shrink-0 font-display font-bold leading-none text-fg-subtle ${dashSz}`}>–</span>

        {/* side B (mirrored) */}
        <div className="flex min-w-0 flex-1 items-center justify-start gap-3 sm:gap-4">
          <span className={`tabular shrink-0 font-display font-bold leading-none text-accent ${scoreSz}`}>
            {t.sideBWins}
          </span>
          <span className={`truncate font-display font-bold tracking-wide ${nameSz} ${t.leader === 'B' ? 'text-fg' : 'text-fg-muted'}`}>
            {bName}
          </span>
          <Flag name={bName} className={`${flagSz} w-auto shrink-0 rounded-[2px]`} />
        </div>
      </div>
    </div>
  )
}

function DuelBreakdown({ b, ev }: { b: Bundle; ev: EventCfg }) {
  const pods = duelPods(b, ev.id)
  const sideOf = (id: string | null) => b.teams.find(t => t.id === id)?.side ?? null
  const aName = ev.side_a_name || 'Side A', bName = ev.side_b_name || 'Side B'
  return (
    <div className="space-y-3">
      {pods.map(pod => (
        <div key={pod.label} className="overflow-hidden rounded-xl border border-line">
          <div className="bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted">
            {pod.courtNumber != null ? `Court ${pod.courtNumber}` : pod.label.replace(/pod/i, 'Court')}
          </div>
          <div className="divide-y divide-line">
            {pod.games.map(g => {
              const aSide = sideOf(g.team_a_id)
              const winnerSide = g.status === 'finished'
                ? (g.winner_id === g.team_a_id ? aSide : (aSide === 'A' ? 'B' : 'A'))
                : null
              return (
                <div key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`w-20 shrink-0 truncate ${winnerSide === 'A' ? 'font-bold text-brand-ink' : 'text-fg-muted'}`}>
                    <Flag name={teamSideName(b, g.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, g.team_a_id)}
                  </span>
                  <span className="tabular w-10 shrink-0 text-center text-xs text-fg-subtle">
                    {g.status === 'scheduled' ? 'vs' : `${g.score_a}–${g.score_b}`}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${winnerSide === 'B' ? 'font-bold text-accent' : 'text-fg-muted'}`}>
                    <Flag name={teamSideName(b, g.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, g.team_b_id)}
                  </span>
                  {g.status === 'live'
                    ? <Pill tone="live">live</Pill>
                    : g.status === 'finished'
                    ? <Pill tone="done">{winnerSide === 'A' ? aName : bName}</Pill>
                    : <Pill>{g.status.replace('_', ' ')}</Pill>}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

// ------------------------------------------------------------- standings
function Standings({ b }: { b: Bundle }) {
  return (
    <div className="p-3 space-y-5">
      {b.events.map(ev => {
        if (ev.format === 'duel') {
          return (
            <div key={ev.id}>
              <div className="mb-2 font-display text-lg font-bold tracking-wide">{ev.name}</div>
              <DuelBreakdown b={b} ev={ev} />
            </div>
          )
        }
        const pools = standings(b, ev.id)
        return (
          <div key={ev.id}>
            <div className="mb-2 font-display text-lg font-bold tracking-wide">{ev.name}</div>
            {Object.entries(pools).map(([pool, rows]) => (
              <div key={pool} className="mb-4 overflow-hidden rounded-xl border border-line">
                <div className="bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted">
                  Pool {pool}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Team</th>
                      <th className="px-2 py-1.5 text-right">P</th>
                      <th className="px-2 py-1.5 text-right">W</th>
                      <th className="px-2 py-1.5 text-right">L</th>
                      <th className="px-3 py-1.5 text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(r => (
                      <tr key={r.team.id}>
                        <td className="truncate px-3 py-2"><Flag name={teamSideName(b, r.team.id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{r.team.name}</td>
                        <td className="tabular px-2 py-2 text-right text-fg-muted">{r.played}</td>
                        <td className="tabular px-2 py-2 text-right font-bold">{r.won}</td>
                        <td className="tabular px-2 py-2 text-right text-fg-muted">{r.lost}</td>
                        <td className={`tabular px-3 py-2 text-right ${r.diff > 0 ? 'text-brand-ink' : r.diff < 0 ? 'text-fg-muted' : ''}`}>
                          {r.diff > 0 ? '+' : ''}{r.diff}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ))}
          </div>
        )
      })}
    </div>
  )
}

// --------------------------------------------------------------- results
function Results({ b, code }: { b: Bundle; code: string }) {
  const done = results(b)
  if (!done.length) return <div className="p-10 text-center text-sm text-fg-subtle">No completed matches yet.</div>
  return (
    <div className="divide-y divide-line">
      {done.map(m => {
        const aWon = m.winner_id === m.team_a_id
        return (
          <Link key={m.id} to={`/c/${code}/match/${m.id}`}
            className="flex items-center gap-3 px-4 py-3 active:bg-surface">
            <div className="w-10 shrink-0 text-center font-display text-lg font-bold text-fg-subtle">
              {b.courts.find(c => c.id === m.court_id)?.number ?? '–'}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm ${aWon ? 'font-bold text-fg' : 'text-fg-muted'}`}>
                <Flag name={teamSideName(b, m.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_a_id)}
              </div>
              <div className={`truncate text-sm ${!aWon ? 'font-bold text-fg' : 'text-fg-muted'}`}>
                <Flag name={teamSideName(b, m.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_b_id)}
              </div>
              <div className="text-[11px] text-fg-subtle">Match #{m.sequence}{m.round ? ` · ${m.round}` : ''}</div>
            </div>
            <div className="tabular text-right font-display text-2xl font-bold leading-tight">
              <div className={aWon ? 'text-brand-ink' : 'text-fg-muted'}>{m.score_a}</div>
              <div className={!aWon ? 'text-brand-ink' : 'text-fg-muted'}>{m.score_b}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
