import { useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, liveOnCourt, nextOnCourt, results, standings,
  eventOf, duelTally, duelPods,
} from '../lib/store'
import { displayScores } from '../lib/scoring'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { Screen, Pill, Spinner, FullscreenButton, Flag } from '../components/ui'
import Court from '../components/Court'
import { IS_DEMO, demo, adminMoveMatch } from '../lib/api'

type Tab = 'live' | 'schedule' | 'standings' | 'results'

export default function Board() {
  const { code } = useParams()
  const { bundle, error, loading, reload } = useCompetition(code)
  const [tab, setTab] = useState<Tab>('live')
  const [tv, setTv] = useState(false)

  if (loading) return <Screen><Spinner /></Screen>
  if (error || !bundle) return (
    <Screen className="flex flex-col items-center justify-center gap-4 px-6">
      <div className="text-center text-gray-400">
        No competition found for code <span className="font-bold text-white">{code}</span>
      </div>
      <Link to="/" className="rounded-xl border border-edge px-4 py-2 text-sm">Try again</Link>
    </Screen>
  )

  const c = bundle.competition
  const duelEvent = bundle.events.find(e => e.format === 'duel')

  // ---- TV mode: dedicated, centred fullscreen presentation ----
  if (tv) {
    return (
      <div className="fixed inset-0 flex flex-col bg-ink text-gray-100"
        style={{
          paddingTop: 'env(safe-area-inset-top)',
          paddingBottom: 'env(safe-area-inset-bottom)',
          paddingLeft: 'env(safe-area-inset-left)',
          paddingRight: 'env(safe-area-inset-right)',
        }}>
        {/* discreet controls, top-right */}
        <div className="absolute right-4 top-4 z-10 flex items-center gap-2 opacity-30 transition-opacity hover:opacity-100">
          <button onClick={() => setTv(false)}
            className="rounded-lg border border-edge bg-panel/70 px-3 py-1.5 text-xs text-gray-300">
            exit TV
          </button>
          <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-edge bg-panel/70 p-1.5 text-gray-300" />
        </div>

        {/* title + big scoreboard */}
        <div className="shrink-0 px-8 pt-6 text-center">
          <div className="font-display text-3xl font-bold tracking-wide sm:text-4xl">{c.name}</div>
          {c.venue && <div className="mt-0.5 text-sm text-gray-500">{c.venue}</div>}
        </div>
        {duelEvent && (
          <div className="shrink-0 px-8 pt-5">
            <DuelScoreboard b={bundle} ev={duelEvent} big />
          </div>
        )}

        {/* courts, centred and filling the remaining space */}
        <div className="flex min-h-0 flex-1 items-center justify-center px-8 py-6">
          <div className="w-full max-w-[1600px]">
            <LiveGrid b={bundle} code={code!} tv />
          </div>
        </div>
      </div>
    )
  }

  return (
    <Screen>
      {duelEvent && <DuelScoreboard b={bundle} ev={duelEvent} big={false} />}

      <div className="border-b border-edge px-4 py-3">
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <div className="truncate font-display text-2xl font-bold tracking-wide">{c.name}</div>
            <div className="truncate text-xs text-gray-500">
              {c.venue} · code <span className="font-bold text-lime">{c.code}</span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link to={`/c/${code}/admin`}
              className="flex h-8 items-center rounded-lg border border-edge px-3 text-xs text-gray-400 active:bg-edge">
              Settings
            </Link>
            <button onClick={() => setTv(true)}
              className="flex h-8 items-center rounded-lg border border-edge px-3 text-xs text-gray-400 active:bg-edge">
              TV mode
            </button>
            <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-edge p-1.5 text-gray-400 active:bg-edge" />
          </div>
        </div>

        <div className="mt-3 flex gap-1 overflow-x-auto">
          {(['live', 'schedule', 'standings', 'results'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider ${
                tab === t ? 'bg-lime text-ink' : 'text-gray-500'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live' && <LiveGrid b={bundle} code={code!} tv={false} />}
      {tab === 'schedule' && <Schedule b={bundle} code={code!} reload={reload} />}
      {tab === 'standings' && <Standings b={bundle} />}
      {tab === 'results' && <Results b={bundle} code={code!} />}

      {IS_DEMO && (
        <div className="px-4 py-8 text-center">
          <button onClick={() => { demo.reset(); location.reload() }}
            className="text-xs text-gray-600 underline underline-offset-4">
            reset demo data
          </button>
        </div>
      )}
    </Screen>
  )
}

// ------------------------------------------------------------- live grid
function LiveGrid({ b, code, tv }: { b: Bundle; code: string; tv: boolean }) {
  const deck = b.matches
    .filter(mm => mm.status === 'scheduled' || mm.status === 'on_deck')
    .sort((x, y) => x.sequence - y.sequence)
  return (
    <div className={tv ? '' : 'p-3'}>
      <div className={`grid gap-3 ${tv ? 'grid-cols-3' : 'grid-cols-2 lg:grid-cols-3'}`}>
        {b.courts.map(ct => {
          const m = liveOnCourt(b, ct.id)
          const up = nextOnCourt(b, ct.id)
          return (
            <Link key={ct.id} to={`/c/${code}/court/${ct.number}`}
              className="block rounded-2xl border border-edge bg-panel p-3 active:scale-[0.99]">
              <div className="mb-2 flex items-center justify-between">
                <span className="font-display text-lg font-bold tracking-widest text-gray-400">
                  COURT {ct.number}
                </span>
                {m ? <Pill tone="live">● live</Pill> : <Pill>open</Pill>}
              </div>

              {m ? <CourtScoreRow b={b} m={m} tv={tv} /> : (
                <div className="py-6 text-center text-sm text-gray-600">No match running</div>
              )}

              {up && (
                <div className="mt-3 border-t border-edge pt-2 text-[11px] text-gray-500">
                  Next: {teamName(b, up.team_a_id)} vs {teamName(b, up.team_b_id)}
                </div>
              )}
            </Link>
          )
        })}
      </div>

      {!tv && deck.length > 0 && (
        <div className="mt-4 rounded-2xl border border-edge bg-panel p-4">
          <div className="mb-2 font-display text-sm font-bold uppercase tracking-widest text-cyan">
            On deck
          </div>
          <div className="space-y-1.5">
            {deck.map(m => (
              <div key={m.id} className="flex justify-between text-sm">
                <span className="truncate">
                  <Flag name={teamSideName(b, m.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_a_id)} <span className="text-gray-600">vs</span> <Flag name={teamSideName(b, m.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_b_id)}
                </span>
                <span className="ml-3 shrink-0 text-gray-500">
                  Court {b.courts.find(c => c.id === m.court_id)?.number ?? '—'}
                </span>
              </div>
            ))}
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
    <div className="aspect-[2/1]">
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
function Schedule({ b, code, reload }: { b: Bundle; code: string; reload: () => void }) {
  const adminToken = localStorage.getItem(`pp.admin.${code}`)
  const [openId, setOpenId] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const upcoming = b.matches
    .filter(m => m.status !== 'finished')
    .sort((x, y) => x.sequence - y.sequence)

  const open = openId ? b.matches.find(m => m.id === openId) ?? null : null
  const sibs = open
    ? b.matches
        .filter(m => m.court_id === open.court_id && m.status === 'scheduled')
        .sort((x, y) => x.sequence - y.sequence)
    : []
  const idx = open ? sibs.findIndex(m => m.id === open.id) : -1
  const canUp = idx > 0
  const canDown = idx >= 0 && idx < sibs.length - 1

  const move = async (dir: 'up' | 'down') => {
    if (!adminToken || !openId) return
    setBusy(true)
    try { await adminMoveMatch(adminToken, openId, dir); setOpenId(null); reload() }
    finally { setBusy(false) }
  }

  const courtNo = (id: string | null) => b.courts.find(c => c.id === id)?.number ?? '–'

  return (
    <div className="divide-y divide-edge">
      {adminToken && (
        <div className="px-4 py-2 text-[11px] text-gray-600">
          Tap an upcoming match to move it up or down its court's queue.
        </div>
      )}
      {upcoming.map(m => {
        const canEdit = !!adminToken && m.status === 'scheduled'
        const inner = (
          <>
            <div className="w-10 shrink-0 text-center font-display text-lg font-bold text-gray-600">
              {courtNo(m.court_id)}
            </div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm">
                <Flag name={teamSideName(b, m.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_a_id)} <span className="text-gray-600">vs</span> <Flag name={teamSideName(b, m.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_b_id)}
              </div>
              <div className="text-[11px] text-gray-600">{m.round} · #{m.sequence}</div>
            </div>
            {m.status === 'live'
              ? <Pill tone="live">live</Pill>
              : <Pill>{m.status.replace('_', ' ')}</Pill>}
            {canEdit && <span className="ml-1 shrink-0 text-gray-600">⇅</span>}
          </>
        )
        return canEdit ? (
          <button key={m.id} onClick={() => setOpenId(m.id)}
            className="flex w-full items-center gap-3 px-4 py-3 text-left active:bg-panel">
            {inner}
          </button>
        ) : (
          <div key={m.id} className="flex items-center gap-3 px-4 py-3">
            {inner}
          </div>
        )
      })}

      {open && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-ink/70 px-6"
          onClick={() => { if (!busy) setOpenId(null) }}>
          <div className="w-full max-w-xs rounded-2xl border border-edge bg-panel p-4"
            onClick={e => e.stopPropagation()}>
            <div className="mb-1 text-[11px] uppercase tracking-widest text-gray-600">
              Court {courtNo(open.court_id)} · move match
            </div>
            <div className="mb-4 text-sm font-semibold">
              {teamName(b, open.team_a_id)} vs {teamName(b, open.team_b_id)}
            </div>
            <div className="space-y-2">
              <button disabled={!canUp || busy} onClick={() => move('up')}
                className="w-full rounded-xl border border-edge py-3 font-display text-sm font-bold tracking-wide active:bg-edge disabled:opacity-30">
                ▲ MOVE UP
              </button>
              <button disabled={!canDown || busy} onClick={() => move('down')}
                className="w-full rounded-xl border border-edge py-3 font-display text-sm font-bold tracking-wide active:bg-edge disabled:opacity-30">
                ▼ MOVE DOWN
              </button>
              <button disabled={busy} onClick={() => setOpenId(null)}
                className="w-full rounded-xl py-2 text-xs text-gray-500">
                Cancel
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

// -------------------------------------------------------------- duel mode
function DuelScoreboard({ b, ev, big }: { b: Bundle; ev: EventCfg; big: boolean }) {
  const t = duelTally(b, ev.id)
  const aName = ev.side_a_name || 'Side A', bName = ev.side_b_name || 'Side B'
  return (
    <div className={`border-b border-edge px-4 ${big ? 'py-6' : 'py-4'}`}>
      <div className="flex items-center justify-center gap-4 sm:gap-8">
        <Side name={aName} score={t.sideAWins} lead={t.leader === 'A'} tone="lime" big={big} align="right" />
        <div className={`font-display font-bold text-gray-700 ${big ? 'text-4xl' : 'text-xl'}`}>–</div>
        <Side name={bName} score={t.sideBWins} lead={t.leader === 'B'} tone="cyan" big={big} align="left" />
      </div>
      <div className="mt-1.5 text-center text-xs text-gray-600">
        {t.gamesPlayed} of {t.gamesTotal} games played
        {t.gamesPlayed > 0 && ` · points ${t.sideAPoints}–${t.sideBPoints}`}
        {t.gamesPlayed === t.gamesTotal && t.gamesTotal > 0 && (
          <span className="ml-2 font-bold text-lime">
            {t.leader === 'tie' ? '— tied' : `— ${t.leader === 'A' ? aName : bName} win${t.gamesPlayed !== 1 ? '' : 's'}!`}
          </span>
        )}
      </div>
    </div>
  )
}

function Side({ name, score, lead, tone, big, align }: {
  name: string; score: number; lead: boolean; tone: 'lime' | 'cyan'; big: boolean; align: 'left' | 'right'
}) {
  const color = tone === 'lime' ? 'text-lime' : 'text-cyan'
  return (
    <div className={`flex items-baseline gap-2.5 sm:gap-4 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
      <span className={`tabular font-display font-bold leading-none ${color} ${big ? 'text-7xl' : 'text-4xl'}`}>
        {score}
      </span>
      <span className={`flex min-w-0 items-center gap-2.5 ${align === 'right' ? 'flex-row-reverse' : ''}`}>
        <Flag name={name} className={`w-auto shrink-0 rounded-[2px] ${big ? 'h-11' : 'h-6'}`} />
        <span className={`truncate font-display font-bold tracking-wide ${lead ? 'text-white' : 'text-gray-500'} ${big ? 'text-4xl' : 'text-lg'}`}>
          {name}
        </span>
      </span>
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
        <div key={pod.label} className="overflow-hidden rounded-xl border border-edge">
          <div className="flex items-center justify-between bg-panel px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-gray-500">
            <span>{pod.label}</span>
            {pod.courtNumber != null && <span>Court {pod.courtNumber}</span>}
          </div>
          <div className="divide-y divide-edge">
            {pod.games.map(g => {
              const aSide = sideOf(g.team_a_id)
              const winnerSide = g.status === 'finished'
                ? (g.winner_id === g.team_a_id ? aSide : (aSide === 'A' ? 'B' : 'A'))
                : null
              return (
                <div key={g.id} className="flex items-center gap-3 px-3 py-2 text-sm">
                  <span className={`w-16 shrink-0 truncate ${winnerSide === 'A' ? 'font-bold text-lime' : 'text-gray-400'}`}>
                    {teamName(b, g.team_a_id)}
                  </span>
                  <span className="tabular shrink-0 text-xs text-gray-600">
                    {g.status === 'scheduled' ? 'vs' : `${g.score_a}–${g.score_b}`}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${winnerSide === 'B' ? 'font-bold text-cyan' : 'text-gray-400'}`}>
                    {teamName(b, g.team_b_id)}
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
              <div key={pool} className="mb-4 overflow-hidden rounded-xl border border-edge">
                <div className="bg-panel px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-gray-500">
                  Pool {pool}
                </div>
                <table className="w-full text-sm">
                  <thead className="text-[10px] uppercase tracking-wider text-gray-600">
                    <tr>
                      <th className="px-3 py-1.5 text-left">Team</th>
                      <th className="px-2 py-1.5 text-right">P</th>
                      <th className="px-2 py-1.5 text-right">W</th>
                      <th className="px-2 py-1.5 text-right">L</th>
                      <th className="px-3 py-1.5 text-right">Diff</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-edge">
                    {rows.map(r => (
                      <tr key={r.team.id}>
                        <td className="truncate px-3 py-2"><Flag name={teamSideName(b, r.team.id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{r.team.name}</td>
                        <td className="tabular px-2 py-2 text-right text-gray-400">{r.played}</td>
                        <td className="tabular px-2 py-2 text-right font-bold">{r.won}</td>
                        <td className="tabular px-2 py-2 text-right text-gray-400">{r.lost}</td>
                        <td className={`tabular px-3 py-2 text-right ${r.diff > 0 ? 'text-lime' : r.diff < 0 ? 'text-gray-500' : ''}`}>
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
  if (!done.length) return <div className="p-10 text-center text-sm text-gray-600">No completed matches yet.</div>
  return (
    <div className="divide-y divide-edge">
      {done.map(m => {
        const aWon = m.winner_id === m.team_a_id
        return (
          <Link key={m.id} to={`/c/${code}/match/${m.id}`}
            className="flex items-center gap-3 px-4 py-3 active:bg-panel">
            <div className="w-10 shrink-0 text-center font-display text-lg font-bold text-gray-600">
              {b.courts.find(c => c.id === m.court_id)?.number ?? '–'}
            </div>
            <div className="min-w-0 flex-1">
              <div className={`truncate text-sm ${aWon ? 'font-bold text-white' : 'text-gray-500'}`}>
                <Flag name={teamSideName(b, m.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_a_id)}
              </div>
              <div className={`truncate text-sm ${!aWon ? 'font-bold text-white' : 'text-gray-500'}`}>
                <Flag name={teamSideName(b, m.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_b_id)}
              </div>
              <div className="text-[11px] text-gray-600">Match #{m.sequence}{m.round ? ` · ${m.round}` : ''}</div>
            </div>
            <div className="tabular text-right font-display text-2xl font-bold leading-tight">
              <div className={aWon ? 'text-lime' : 'text-gray-500'}>{m.score_a}</div>
              <div className={!aWon ? 'text-lime' : 'text-gray-500'}>{m.score_b}</div>
            </div>
          </Link>
        )
      })}
    </div>
  )
}
