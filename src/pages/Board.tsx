import { useState, useEffect } from 'react'
import { Link, useParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, teamLogo, liveOnCourt, nextOnCourt, onDeck, results, standings,
  eventOf, duelTally, duelPods, groupStandings, bracketRounds, bracketSeeded, isKoMatch,
} from '../lib/store'
import { displayScores } from '../lib/scoring'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { Screen, Pill, Spinner, FullscreenButton, Flag, Emblem, ThemeToggle } from '../components/ui'
import Court from '../components/Court'
import { IS_DEMO, demo } from '../lib/api'
import { fullscreenSupported } from '../lib/fullscreen'

type Tab = 'live' | 'schedule' | 'standings' | 'results' | 'bracket' | 'poster'

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
          <IphoneHomeTip />
        </div>

        {/* title */}
        <div className="shrink-0 px-4 text-center sm:px-8">
          <div className="font-display text-2xl font-bold tracking-wide sm:text-3xl md:text-4xl">{c.name}</div>
          {c.venue && <div className="mt-0.5 text-xs text-fg-muted sm:text-sm">{c.venue}</div>}
        </div>

        {/* big scoreboard */}
        {duelEvent && (
          <div className="shrink-0 px-4 sm:px-8">
            <DuelScoreboard b={bundle} ev={duelEvent} big />
          </div>
        )}

        {/* courts */}
        <div className="shrink-0 px-4 sm:px-8">
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
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Link to="/" aria-label="Back to lobby"
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-sm text-fg-muted active:bg-surface-2 lg:h-10 lg:px-3">
              ←<span className="hidden font-semibold sm:inline"> Lobby</span>
            </Link>
            <div className="min-w-0">
              <div className="truncate font-display text-2xl font-bold tracking-wide lg:text-3xl">{c.name}</div>
              <div className="truncate text-xs text-fg-muted lg:text-sm">
                {c.venue} · code <span className="font-bold text-brand-ink">{c.code}</span>
              </div>
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
          {((bundle.events.some(e => e.format === 'groups_ko')
              ? ['live', 'schedule', 'standings', 'bracket', 'poster', 'results']
              : ['live', 'schedule', 'standings', 'results']) as Tab[]).map(t => (
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
      {tab === 'bracket' && <BracketView b={bundle} />}
      {tab === 'poster' && <PosterBracket b={bundle} />}
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
function TvIdle({ b }: { b: Bundle }) {
  const ups = onDeck(b, { n: 6 })
  return (
    <div className="px-6 py-16 text-center">
      <div className="font-display text-2xl font-bold tracking-wide text-fg-muted sm:text-3xl">
        No match live right now
      </div>
      {ups.length > 0 && (
        <div className="mx-auto mt-6 max-w-lg space-y-2">
          <div className="text-xs font-bold uppercase tracking-widest text-accent">Up next</div>
          {ups.map(m => (
            <div key={m.id} className="flex items-center justify-center gap-2 text-base sm:text-lg">
              <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-4 w-auto shrink-0 rounded-[1px]" />
              <span className="truncate">{teamName(b, m.team_a_id)}</span>
              <span className="text-fg-subtle">vs</span>
              <span className="truncate">{teamName(b, m.team_b_id)}</span>
              <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-4 w-auto shrink-0 rounded-[1px]" />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LiveGrid({ b, code, tv }: { b: Bundle; code: string; tv: boolean }) {
  const shownCourts = tv ? b.courts.filter(ct => liveOnCourt(b, ct.id)) : b.courts
  if (tv && shownCourts.length === 0) return <TvIdle b={b} />
  const cols = !tv
    ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : shownCourts.length <= 1 ? 'grid-cols-1'
    : shownCourts.length === 2 ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-3'
  const wrap = tv && shownCourts.length === 1 ? 'mx-auto w-full max-w-[1100px] ' : ''
  return (
    <div className={tv ? '' : 'p-3 lg:p-5'}>
      <div className={`${wrap}grid gap-2 lg:gap-3 ${cols}`}>
        {shownCourts.map(ct => {
          const m = liveOnCourt(b, ct.id)
          const up = nextOnCourt(b, ct.id)
          return (
            <Link key={ct.id} to={`/c/${code}/court/${ct.number}`}
              className="block rounded-2xl border border-line bg-surface p-2 active:scale-[0.99] lg:p-3">
              <div className="mb-1.5 flex items-center justify-between lg:mb-2">
                <span className="font-display text-sm font-bold tracking-widest text-fg-muted lg:text-base">
                  COURT {ct.number}
                </span>
                {m ? <Pill tone="live">● live</Pill> : <Pill>open</Pill>}
              </div>

              {m ? <CourtScoreRow b={b} m={m} tv={tv} /> : (
                <div className="py-6 text-center text-sm text-fg-subtle lg:py-10">No match running</div>
              )}

              {up && (
                <div className="mt-3 border-t border-line pt-2 text-[11px] text-fg-muted lg:mt-4 lg:pt-3 lg:text-sm">
                  Next: <span className="truncate">{teamName(b, up.team_a_id)}</span> vs <span className="truncate">{teamName(b, up.team_b_id)}</span>
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
          <div className={`grid gap-3 ${tv ? 'grid-cols-3' : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'}`}>
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
                            <span className="max-w-[4.5rem] truncate text-right sm:max-w-[5rem]">{teamName(b, mm.team_a_id)}</span>
                            <Emblem logo={teamLogo(b, mm.team_a_id)} flagName={teamSideName(b, mm.team_a_id)} className="h-3.5 w-auto shrink-0 rounded-[1px]" />
                          </span>
                          <span className="text-center text-xs text-fg-subtle">vs</span>
                          <span className="flex items-center justify-start gap-1.5 text-fg-muted">
                            <Emblem logo={teamLogo(b, mm.team_b_id)} flagName={teamSideName(b, mm.team_b_id)} className="h-3.5 w-auto shrink-0 rounded-[1px]" />
                            <span className="max-w-[4.5rem] truncate text-left sm:max-w-[5rem]">{teamName(b, mm.team_b_id)}</span>
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
        leftLogo={teamLogo(b, leftTeamId)} rightLogo={teamLogo(b, rightTeamId)}
        label={m.bracket_key ? (m.round ?? undefined) : undefined}
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
              <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={fl} />{teamName(b, m.team_a_id)}<span className="mx-2 text-fg-subtle">vs</span><Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={fl} />{teamName(b, m.team_b_id)}
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
function PosterBracket({ b }: { b: Bundle }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  if (!bracketSeeded(b, ev.id)) {
    return <div className="p-6 text-center text-sm text-fg-muted">The bracket hasn’t been drawn yet.</div>
  }
  const rounds = bracketRounds(b, ev.id)
  const finalR = rounds.find(r => r.round === 'Final')
  const thirdR = rounds.find(r => r.round === 'Third place')
  const play = rounds.filter(r => r !== finalR && r !== thirdR)
  const half = (n: number) => Math.ceil(n / 2)
  const leftCols = play.map(r => ({ round: r.round, matches: r.matches.slice(0, half(r.matches.length)) }))
  const rightCols = [...play].reverse().map(r => ({ round: r.round, matches: r.matches.slice(half(r.matches.length)) }))
  return (
    <div className="overflow-x-auto p-4">
      <div className="mx-auto flex min-w-max items-stretch justify-center gap-3 lg:gap-5">
        {leftCols.map((col, i) => <BracketColumn key={'L' + i} b={b} col={col} side="left" />)}
        <div className="flex flex-col items-center justify-center gap-2 px-1">
          <div className="text-[10px] font-bold uppercase tracking-[0.2em] text-brand-ink">Final</div>
          <div className="w-44"><PMatch b={b} m={finalR?.matches[0]} /></div>
          <Trophy />
          <div className="mt-1 text-[10px] font-bold uppercase tracking-[0.2em] text-fg-subtle">Third place</div>
          <div className="w-44"><PMatch b={b} m={thirdR?.matches[0]} /></div>
        </div>
        {rightCols.map((col, i) => <BracketColumn key={'R' + i} b={b} col={col} side="right" />)}
      </div>
    </div>
  )
}

function BracketColumn({ b, col, side }: { b: Bundle; col: { round: string; matches: Match[] }; side: 'left' | 'right' }) {
  return (
    <div className="flex min-w-[9.5rem] flex-col justify-around gap-2">
      <div className={`mb-1 text-[10px] font-bold uppercase tracking-widest text-fg-subtle ${side === 'right' ? 'text-right' : ''}`}>
        {col.round}
      </div>
      {col.matches.map(m => <PMatch key={m.id} b={b} m={m} />)}
    </div>
  )
}

function PMatch({ b, m }: { b: Bundle; m?: Match }) {
  if (!m) return <div className="rounded-lg border border-dashed border-line/70 bg-surface/40 px-2 py-3 text-center text-[10px] text-fg-subtle">TBD</div>
  const bye = m.team_b_id == null && m.team_a_id != null
  return (
    <div className={`overflow-hidden rounded-lg border ${m.status === 'live' ? 'border-brand' : 'border-line'} bg-surface`}>
      <PTeam b={b} teamId={m.team_a_id} score={m.score_a} win={m.winner_id != null && m.winner_id === m.team_a_id} finished={m.status === 'finished'} />
      <div className="h-px bg-line" />
      {bye
        ? <div className="px-2 py-1 text-[11px] italic text-fg-subtle">bye</div>
        : <PTeam b={b} teamId={m.team_b_id} score={m.score_b} win={m.winner_id != null && m.winner_id === m.team_b_id} finished={m.status === 'finished'} />}
    </div>
  )
}

function PTeam({ b, teamId, score, win, finished }: { b: Bundle; teamId: string | null; score: number; win: boolean; finished: boolean }) {
  return (
    <div className={`flex items-center gap-1.5 px-2 py-1 ${win ? 'bg-brand/10' : ''}`}>
      <Emblem logo={teamLogo(b, teamId)} flagName={teamSideName(b, teamId)} className="h-3.5 w-5 shrink-0 rounded-[1px] object-contain" />
      <span className={`min-w-0 flex-1 truncate text-xs ${win ? 'font-bold text-fg' : 'text-fg-muted'}`}>{teamName(b, teamId)}</span>
      {finished && <span className="tabular shrink-0 text-xs text-fg-subtle">{score}</span>}
    </div>
  )
}

function Trophy() {
  return (
    <svg viewBox="0 0 48 60" className="h-14 w-14" aria-hidden="true">
      <defs>
        <linearGradient id="ppTrophy" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f7d774" /><stop offset="100%" stopColor="#c2922c" />
        </linearGradient>
      </defs>
      <path d="M14 6h20v11a10 10 0 0 1-20 0V6z" fill="url(#ppTrophy)" />
      <path d="M14 9H7v4a7 7 0 0 0 7 7M34 9h7v4a7 7 0 0 1-7 7" fill="none" stroke="url(#ppTrophy)" strokeWidth="2.5" />
      <rect x="21" y="27" width="6" height="9" fill="url(#ppTrophy)" />
      <rect x="15" y="36" width="18" height="4" rx="1" fill="url(#ppTrophy)" />
      <rect x="12" y="40" width="24" height="6" rx="2" fill="url(#ppTrophy)" />
    </svg>
  )
}

function DuelScoreboard({ b, ev, big }: { b: Bundle; ev: EventCfg; big: boolean }) {
  const t = duelTally(b, ev.id)
  const aName = ev.side_a_name || 'Side A', bName = ev.side_b_name || 'Side B'
  const nameSz = big ? 'text-base sm:text-2xl md:text-4xl' : 'text-base lg:text-2xl'
  const scoreSz = big ? 'text-4xl sm:text-6xl md:text-8xl' : 'text-3xl lg:text-5xl'
  const flagSz = big ? 'h-6 sm:h-9 md:h-12' : 'h-5 lg:h-8'
  const dashSz = big ? 'text-2xl sm:text-4xl md:text-6xl' : 'text-xl lg:text-3xl'
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

      <div className="mx-auto flex max-w-5xl items-center justify-center gap-2 sm:gap-4 md:gap-8 lg:gap-12">
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
                    <Emblem logo={teamLogo(b, g.team_a_id)} flagName={teamSideName(b, g.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, g.team_a_id)}
                  </span>
                  <span className="tabular w-10 shrink-0 text-center text-xs text-fg-subtle">
                    {g.status === 'scheduled' ? 'vs' : `${g.score_a}–${g.score_b}`}
                  </span>
                  <span className={`min-w-0 flex-1 truncate ${winnerSide === 'B' ? 'font-bold text-accent' : 'text-fg-muted'}`}>
                    <Emblem logo={teamLogo(b, g.team_b_id)} flagName={teamSideName(b, g.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, g.team_b_id)}
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

// --------------------------------------------------------------- bracket
function BracketView({ b }: { b: Bundle }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  const rounds = bracketRounds(b, ev.id)
  const seeded = bracketSeeded(b, ev.id)

  if (!seeded) {
    const left = b.matches.filter(
      m => m.event_id === ev.id && !isKoMatch(m) && m.status !== 'finished').length
    return (
      <div className="p-6 text-center text-sm text-fg-muted">
        <div className="font-display text-lg font-bold tracking-wide text-fg">
          Bracket not drawn yet
        </div>
        <p className="mx-auto mt-2 max-w-md">
          {left > 0
            ? `${left} group match${left > 1 ? 'es' : ''} still to play. Once the group
               stage finishes, the organizer locks the tables and the knockout draw
               appears here.`
            : 'The group stage is complete — waiting for the organizer to lock the tables.'}
        </p>
      </div>
    )
  }

  return (
    <div className="flex gap-3 overflow-x-auto p-3">
      {rounds.map(r => (
        <div key={r.round} className="min-w-[15rem] flex-1 shrink-0">
          <div className="mb-2 text-center text-[10px] font-bold uppercase tracking-widest text-fg-subtle">
            {r.round}
          </div>
          <div className="flex h-full flex-col justify-around gap-2">
            {r.matches.map(m => {
              const bye = m.team_b_id == null && m.team_a_id != null
              return (
                <div key={m.id}
                  className={`overflow-hidden rounded-xl border text-sm ${
                    m.status === 'live' ? 'border-brand' : 'border-line'}`}>
                  <BracketSide b={b} teamId={m.team_a_id} score={m.score_a}
                    won={m.winner_id != null && m.winner_id === m.team_a_id}
                    played={m.status === 'finished' && !bye} />
                  <div className="h-px bg-line" />
                  {bye
                    ? <div className="px-2.5 py-1.5 text-xs italic text-fg-subtle">bye</div>
                    : <BracketSide b={b} teamId={m.team_b_id} score={m.score_b}
                        won={m.winner_id != null && m.winner_id === m.team_b_id}
                        played={m.status === 'finished'} />}
                </div>
              )
            })}
          </div>
        </div>
      ))}
    </div>
  )
}

function BracketSide(
  { b, teamId, score, won, played }:
  { b: Bundle; teamId: string | null; score: number; won: boolean; played: boolean },
) {
  return (
    <div className={`flex items-center justify-between gap-2 px-2.5 py-1.5 ${
      won ? 'bg-surface font-bold text-fg' : 'text-fg-muted'}`}>
      <span className="flex min-w-0 items-center">
        {teamId && <Emblem logo={teamLogo(b, teamId)} flagName={teamSideName(b, teamId)}
          className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />}
        <span className="truncate">{teamId ? teamName(b, teamId) : '—'}</span>
      </span>
      {played && <span className="tabular shrink-0">{score}</span>}
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
        // a quarter-final win must not leak into the group table that produced
        // the quarter-finalists, so groups_ko reads group matches only
        const pools = ev.format === 'groups_ko'
          ? groupStandings(b, ev.id) : standings(b, ev.id)
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
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-line">
                    {rows.map(r => (
                      <tr key={r.team.id}>
                        <td className="truncate px-3 py-2"><Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{r.team.name}</td>
                        <td className="tabular px-2 py-2 text-right text-fg-muted">{r.played}</td>
                        <td className="tabular px-2 py-2 text-right font-bold">{r.won}</td>
                        <td className="tabular px-2 py-2 text-right text-fg-muted">{r.lost}</td>
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
/** On iPhone Safari, the Fullscreen API is unavailable. Show a one-time
 *  hint suggesting "Add to Home Screen" for a true fullscreen experience.
 *  Hidden on devices that support fullscreen, inside a PWA, or after dismissed. */
function IphoneHomeTip() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const isIos = /iPhone|iPod/.test(navigator.userAgent) && !(navigator as any).standalone
    if (isIos && !fullscreenSupported()) setShow(true)
  }, [])
  if (!show) return null
  return (
    <button onClick={() => setShow(false)}
      className="max-w-[11rem] rounded-lg border border-line bg-surface/90 px-2.5 py-1.5 text-left text-[10px] leading-snug text-fg-muted">
      For fullscreen: tap{' '}
      <svg viewBox="0 0 24 24" className="inline-block h-3 w-3 align-[-2px]" fill="none" stroke="currentColor"
        strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M4 12v8a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-8" />
        <polyline points="16 6 12 2 8 6" />
        <line x1="12" y1="2" x2="12" y2="15" />
      </svg>{' '}
      then <span className="font-semibold">Add to Home Screen</span>
    </button>
  )
}

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
                <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_a_id)}
              </div>
              <div className={`truncate text-sm ${!aWon ? 'font-bold text-fg' : 'text-fg-muted'}`}>
                <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="mr-1 inline-block h-3.5 w-auto shrink-0 rounded-[1px] align-[-2px]" />{teamName(b, m.team_b_id)}
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
