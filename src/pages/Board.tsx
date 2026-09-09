import { useState, useEffect, useRef, useLayoutEffect } from 'react'
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

type Tab = 'live' | 'standings' | 'bracket' | 'matches'

export default function Board() {
  const { code } = useParams()
  const { bundle, error, loading, reload } = useCompetition(code)
  const [tab, setTab] = useState<Tab>('live')
  const [tv, setTv] = useState(false)
  const [tvView, setTvView] = useState<'live' | 'bracket'>('live')

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
  const podium = koPodium(bundle)
  const koEv = bundle.events.find(e => e.format === 'groups_ko')
  const koReady = !!koEv && bracketSeeded(bundle, koEv.id)

  // ---- TV mode: dedicated, centred fullscreen presentation ----
  if (tv) {
    return (
      <div data-theme="dark" className="fixed inset-0 flex flex-col justify-center gap-5 overflow-auto bg-canvas py-6 text-fg"
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
          {koReady && (
            <button onClick={() => setTvView(v => v === 'live' ? 'bracket' : 'live')}
              className="rounded-lg border border-line bg-surface/70 px-3 py-1.5 text-xs text-fg-muted">
              {tvView === 'live' ? 'show bracket' : 'show live'}
            </button>
          )}
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

        {/* the bracket showcase, the podium ceremony, or the live courts */}
        {tvView === 'bracket' && koReady
          ? (
            <div className="min-h-0 flex-1 px-2 sm:px-6">
              <FitBox><PosterBracket b={bundle} broadcast /></FitBox>
            </div>
          )
          : podium
          ? <Podium b={bundle} champion={podium.champion} runnerUp={podium.runnerUp} third={podium.third} title={c.name} />
          : (
            <div className="shrink-0 px-4 sm:px-8">
              <div className="mx-auto w-full max-w-[1600px]">
                <LiveGrid b={bundle} code={code!} tv />
              </div>
            </div>
          )}
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
              ? ['live', 'matches', 'bracket']
              : ['live', 'matches']) as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`rounded-lg px-3 py-1.5 text-xs font-semibold uppercase tracking-wider lg:px-4 lg:py-2 lg:text-sm ${
                tab === t ? 'bg-brand text-brand-fg' : 'text-fg-muted'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live' && <LiveGrid b={bundle} code={code!} tv={false} />}
      {tab === 'bracket' && <PosterBracket b={bundle} />}
      {tab === 'matches' && <Matches b={bundle} code={code!} />}

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
function FitBox({ children }: { children: any }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    const recompute = () => {
      const o = outer.current, i = inner.current
      if (!o || !i) return
      const w = i.offsetWidth, h = i.offsetHeight
      if (!w || !h) return
      const s = Math.min(o.clientWidth / w, o.clientHeight / h)
      if (isFinite(s) && s > 0) setScale(s)
    }
    recompute()
    const ro = new ResizeObserver(recompute)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    window.addEventListener('resize', recompute)
    return () => { ro.disconnect(); window.removeEventListener('resize', recompute) }
  }, [])
  return (
    <div ref={outer} className="grid h-full w-full place-items-center overflow-hidden">
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
        {children}
      </div>
    </div>
  )
}

function PosterBracket({ b, broadcast = false }: { b: Bundle; broadcast?: boolean }) {
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
  const rightCols = play.map(r => ({ round: r.round, matches: r.matches.slice(half(r.matches.length)) }))
  const finalM = finalR?.matches[0]
  const thirdM = thirdR?.matches[0]
  const champId = finalM?.winner_id ?? null

  return (
    <div data-theme={broadcast ? 'dark' : undefined} className={`${broadcast ? 'w-max' : 'overflow-x-auto'} p-4 text-fg`} style={{ background: broadcast
        ? 'radial-gradient(ellipse at top, rgba(244,205,106,0.10), transparent 60%), rgb(var(--canvas))'
        : 'radial-gradient(ellipse at top, rgba(244,205,106,0.06), transparent 55%), rgb(var(--canvas))' }}>
      <div className="mx-auto flex min-w-max items-stretch justify-center">
        {leftCols.map((col, i) => (
          <div key={'L' + i} className="flex items-stretch">
            <PColumn b={b} col={col} side="left" />
            <PConnector count={col.matches.length} side="left" />
          </div>
        ))}

        <PCentre b={b} finalM={finalM} thirdM={thirdM} champId={champId} />

        {[...rightCols].reverse().map((col, i) => (
          <div key={'R' + i} className="flex items-stretch">
            <PConnector count={col.matches.length} side="right" />
            <PColumn b={b} col={col} side="right" />
          </div>
        ))}
      </div>
    </div>
  )
}

function PColumn({ b, col, side }: { b: Bundle; col: { round: string; matches: Match[] }; side: 'left' | 'right' }) {
  return (
    <div className="flex min-w-[9.5rem] flex-col lg:min-w-[11rem]">
      <div className={`mb-1 h-4 text-[10px] font-bold uppercase tracking-widest text-fg-subtle ${side === 'right' ? 'text-right' : ''}`}>
        {col.round}
      </div>
      <div className="flex flex-1 flex-col">
        {col.matches.map(m => (
          <div key={m.id} className="flex flex-1 items-center">
            <div className="w-full"><PMatch b={b} m={m} /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function PConnector({ count, side }: { count: number; side: 'left' | 'right' }) {
  const cells = Math.max(1, Math.ceil(count / 2))
  const single = count <= 1
  return (
    <div className="flex w-5 flex-col lg:w-8">
      <div className="mb-1 h-4" />
      <div className="flex flex-1 flex-col text-fg-subtle/50">
        {Array.from({ length: cells }).map((_, i) => (
          <div key={i} className="flex-1">
            <svg viewBox="0 0 100 100" preserveAspectRatio="none" className="h-full w-full">
              <path
                d={single
                  ? 'M0 50 H100'
                  : side === 'left'
                    ? 'M0 25 H60 V75 H0 M60 50 H100'
                    : 'M100 25 H40 V75 H100 M40 50 H0'}
                fill="none" stroke="currentColor" strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
            </svg>
          </div>
        ))}
      </div>
    </div>
  )
}

function PMatch({ b, m }: { b: Bundle; m?: Match }) {
  if (!m) return <div className="rounded-md border border-dashed border-line/60 bg-surface/30 px-2 py-3 text-center text-[10px] text-fg-subtle">TBD</div>
  const bye = m.team_b_id == null && m.team_a_id != null
  const decided = m.status === 'finished'
  const live = m.status === 'live'
  return (
    <div className={`overflow-hidden rounded-md border ${live ? 'border-gold pp-live' : 'border-line'} bg-surface`}>
      <PTeam b={b} teamId={m.team_a_id} score={m.score_a} win={decided && m.winner_id === m.team_a_id} lose={decided && m.winner_id !== m.team_a_id} finished={decided} />
      {decided
        ? <div className="h-px bg-line" />
        : <div className={`border-y border-line/60 py-0.5 text-center text-[9px] font-bold uppercase tracking-[0.18em] ${live ? 'animate-pulse text-gold' : 'text-fg-subtle'}`}>{live ? 'live' : 'vs'}</div>}
      {bye
        ? <div className="px-2.5 py-1.5 text-[11px] italic text-fg-subtle">bye</div>
        : <PTeam b={b} teamId={m.team_b_id} score={m.score_b} win={decided && m.winner_id === m.team_b_id} lose={decided && m.winner_id !== m.team_b_id} finished={decided} />}
    </div>
  )
}

function PTeam({ b, teamId, score, win, lose, finished }: { b: Bundle; teamId: string | null; score: number; win: boolean; lose: boolean; finished: boolean }) {
  return (
    <div className={`flex items-center gap-2 border-l-2 px-2.5 py-1.5 ${win ? 'border-gold bg-gold/15' : lose ? 'border-transparent opacity-45' : 'border-transparent'}`}>
      <Emblem logo={teamLogo(b, teamId)} flagName={teamSideName(b, teamId)} className="h-3.5 w-5 shrink-0 rounded-[1px] object-contain" />
      <span className={`min-w-0 flex-1 truncate text-xs ${win ? 'font-bold text-fg' : 'text-fg-muted'}`}>{teamName(b, teamId)}</span>
      {finished && <span className={`tabular shrink-0 text-xs ${win ? 'font-bold text-gold' : 'text-fg-subtle'}`}>{score}</span>}
    </div>
  )
}

function PCentre({ b, finalM, thirdM, champId }: { b: Bundle; finalM?: Match; thirdM?: Match; champId: string | null }) {
  return (
    <div className="flex flex-col px-2 lg:px-5">
      <div className="mb-1 h-4 text-center font-cer text-[11px] font-bold uppercase tracking-[0.28em] text-gold">Final</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <div className="w-52"><PMatch b={b} m={finalM} /></div>
        <div className="my-1 flex flex-col items-center">
          <Trophy lit={!!champId} />
          {champId
            ? <div className="mt-1 flex items-center gap-1.5 rounded-full border border-[#c2922c]/60 bg-[#f7d774]/10 px-3 py-1">
                <Emblem logo={teamLogo(b, champId)} flagName={teamSideName(b, champId)} className="h-4 w-6 shrink-0 rounded-[1px] object-contain" />
                <span className="font-cer text-sm font-bold text-[#f7d774]">{teamName(b, champId)}</span>
              </div>
            : <div className="mt-1 text-[10px] uppercase tracking-widest text-fg-subtle">champion</div>}
        </div>
        <div className="mt-1 text-center text-[10px] font-bold uppercase tracking-[0.2em] text-fg-subtle">Third place</div>
        <div className="w-48"><PMatch b={b} m={thirdM} /></div>
      </div>
    </div>
  )
}

function Trophy({ lit }: { lit?: boolean }) {
  return (
    <svg viewBox="0 0 48 60" className={`h-16 w-16 ${lit ? 'drop-shadow-[0_0_10px_rgba(247,215,116,0.6)]' : 'opacity-60'}`} aria-hidden="true">
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

function koPodium(b: Bundle): { champion: string; runnerUp: string | null; third: string | null } | null {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  const finalM = b.matches.find(m => m.event_id === ev.id && m.bracket_key != null && m.round === 'Final')
  if (!finalM || finalM.status !== 'finished' || !finalM.winner_id) return null
  const champion = finalM.winner_id
  const runnerUp = finalM.team_a_id === champion ? finalM.team_b_id : finalM.team_a_id
  const thirdM = b.matches.find(m => m.event_id === ev.id && m.bracket_key != null && m.round === 'Third place')
  const third = thirdM && thirdM.status === 'finished' ? thirdM.winner_id : null
  return { champion, runnerUp, third }
}

function Podium({ b, champion, runnerUp, third, title }: {
  b: Bundle; champion: string; runnerUp: string | null; third: string | null; title: string
}) {
  return (
    <div data-theme="dark" className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 text-fg">
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(46% 55% at 50% 12%, rgba(244,205,106,0.16), transparent 60%)' }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2/3 opacity-25" style={{ background: 'repeating-linear-gradient(90deg, rgba(244,205,106,0.55) 0 1px, transparent 1px 13px)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)', maskImage: 'linear-gradient(to bottom, black, transparent)' }} />
      <div className="relative z-[1] mb-6 text-center sm:mb-10">
        <div className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-fg-subtle">{title} · Final Standings</div>
        <div className="mt-1 font-cer text-3xl font-black uppercase tracking-[0.16em] sm:text-5xl"
          style={{ backgroundImage: 'linear-gradient(180deg,#fff,#efdca6 55%,#f4cd6a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Champions</div>
      </div>
      <div className="relative z-[1] flex items-end justify-center gap-3 sm:gap-6">
        <PodiumSpot b={b} teamId={runnerUp} place={2} />
        <PodiumSpot b={b} teamId={champion} place={1} />
        <PodiumSpot b={b} teamId={third} place={3} />
      </div>
    </div>
  )
}

function PodiumSpot({ b, teamId, place }: { b: Bundle; teamId: string | null; place: 1 | 2 | 3 }) {
  const t = place === 1
    ? { c1: '#f7d774', c2: '#b8862f', h: 'h-40 sm:h-56', label: 'Champion', num: '1', frame: 'h-24 w-24 sm:h-32 sm:w-32', w: 'w-32 sm:w-44', bd: '.32s', wd: '.7s' }
    : place === 2
      ? { c1: '#dbe0e8', c2: '#9aa2af', h: 'h-28 sm:h-40', label: '1st runner-up', num: '2', frame: 'h-20 w-20 sm:h-24 sm:w-24', w: 'w-28 sm:w-36', bd: '.05s', wd: '.35s' }
      : { c1: '#e0a75f', c2: '#9c6522', h: 'h-24 sm:h-32', label: 'Third place', num: '3', frame: 'h-20 w-20 sm:h-24 sm:w-24', w: 'w-28 sm:w-36', bd: '.18s', wd: '.48s' }
  const first = place === 1
  return (
    <div className={`flex ${t.w} flex-col items-center`}>
      <div className="pp-rise flex flex-col items-center" style={{ animationDelay: t.wd }}>
        {first && <div className="pp-pop mb-1" style={{ animationDelay: '1.05s' }}><Trophy lit /></div>}
        <div className={`mb-3 rounded-full p-[3px] ${first ? 'pp-champ-ring' : ''}`} style={{ background: `linear-gradient(150deg, ${t.c1}, ${t.c2})` }}>
          <div className={`grid ${t.frame} place-items-center overflow-hidden rounded-full bg-[#0b0e14]`}>
            <Emblem logo={teamLogo(b, teamId)} flagName={teamSideName(b, teamId)} className="h-3/5 w-3/5 object-contain" />
          </div>
        </div>
        <div className={`mb-1 max-w-full truncate text-center font-bold ${first ? 'font-cer text-lg sm:text-2xl' : 'font-display text-base text-fg sm:text-xl'}`}
          style={first ? { color: '#f4cd6a' } : undefined}>{teamName(b, teamId)}</div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.c1 }}>{t.label}</div>
      </div>
      <div className={`pp-grow relative w-full ${t.h} rounded-t-xl border-t-4`}
        style={{ borderColor: t.c1, background: 'linear-gradient(180deg,#1a1e28,#0a0c11)', boxShadow: `0 0 40px -12px ${t.c1}88`, animationDelay: t.bd }}>
        <div className="absolute inset-x-0 top-2 text-center font-cer text-6xl font-black opacity-90 sm:text-8xl" style={{ color: t.c1 }}>{t.num}</div>
      </div>
    </div>
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

function Matches({ b, code }: { b: Bundle; code: string }) {
  const koEv = b.events.find(e => e.format === 'groups_ko')
  if (!koEv) return <FlatMatches b={b} code={code} />

  const advance = koEv.advance_per_group ?? 2
  const tables = groupStandings(b, koEv.id)
  const poolOf = (id: string | null) => b.teams.find(t => t.id === id)?.pool ?? '—'
  const rawRounds = bracketSeeded(b, koEv.id) ? bracketRounds(b, koEv.id) : []
  const finalR = rawRounds.find(r => r.round === 'Final')
  const thirdR = rawRounds.find(r => r.round === 'Third place')
  const restR = rawRounds.filter(r => r !== finalR && r !== thirdR).reverse()
  const rounds = [finalR, thirdR, ...restR].filter(Boolean) as typeof rawRounds

  return (
    <div className="space-y-6 p-3">
      {rounds.length > 0 && (
        <section>
          <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">Knockout</div>
          <div className="space-y-3">
            {rounds.map(r => (
              <div key={r.round} className="rounded-xl border border-line bg-surface p-3">
                <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">{r.round}</div>
                <ul className="space-y-1 text-sm">
                  {r.matches.map(m => (
                    <li key={m.id}>
                      <Link to={`/c/${code}/match/${m.id}`}
                        className={`grid grid-cols-[1fr_3.5rem_1fr] items-center gap-2 rounded-lg px-1 py-1 active:bg-surface-2 ${m.status === 'live' ? 'bg-brand/[0.06]' : ''}`}>
                        <span className={`flex items-center justify-end gap-1.5 truncate ${m.winner_id === m.team_a_id ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                          <span className="truncate">{teamName(b, m.team_a_id)}</span>
                          <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-3 w-4 shrink-0 rounded-[1px] object-contain" />
                        </span>
                        <span className="tabular text-center text-xs text-fg-subtle">
                          {m.status === 'finished' ? `${m.score_a}–${m.score_b}`
                            : m.status === 'live' ? <span className="animate-pulse font-bold text-brand-ink">live</span>
                            : m.team_b_id == null && m.team_a_id != null ? 'bye' : 'vs'}
                        </span>
                        <span className={`flex items-center gap-1.5 truncate ${m.winner_id === m.team_b_id ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                          <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-3 w-4 shrink-0 rounded-[1px] object-contain" />
                          <span className="truncate">{teamName(b, m.team_b_id)}</span>
                        </span>
                      </Link>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </section>
      )}

      <section>
        <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">Groups</div>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          {Object.keys(tables).sort().map(g => (
            <GroupCard key={g} b={b} code={code} g={g} rows={tables[g]} advance={advance}
              matches={b.matches
                .filter(m => m.event_id === koEv.id && !isKoMatch(m) && poolOf(m.team_a_id) === g)
                .sort((x, y) => x.sequence - y.sequence)} />
          ))}
        </div>
      </section>
    </div>
  )
}

function GroupCard({ b, code, g, rows, advance, matches }: {
  b: Bundle; code: string; g: string; rows: any[]; advance: number; matches: Match[]
}) {
  const [open, setOpen] = useState(false)
  return (
    <div className="rounded-xl border border-line bg-surface">
      <button onClick={() => setOpen(o => !o)} className="w-full p-3 text-left active:bg-surface-2">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Group {g}</span>
          <span className="text-[11px] text-fg-subtle">{open ? 'hide matches' : `${matches.length} matches`}</span>
        </div>
        <table className="w-full text-sm">
          <tbody>
            {rows.map((r: any, i: number) => (
              <tr key={r.team.id} className={i < advance ? 'font-semibold text-fg' : 'text-fg-subtle'}>
                <td className="py-0.5 pr-2 tabular">{i + 1}</td>
                <td className="py-0.5 pr-1"><Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="inline-block h-3 w-4 rounded-[1px] align-[-1px] object-contain" /></td>
                <td className="w-full truncate py-0.5">{r.team.name}</td>
                <td className="py-0.5 pl-2 text-right tabular font-bold">{r.won}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </button>
      {open && (
        <div className="border-t border-line">
          {matches.length ? matches.map(m => {
            const decided = m.status === 'finished'
            return (
              <Link key={m.id} to={`/c/${code}/match/${m.id}`}
                className={`grid grid-cols-[1fr_3rem_1fr] items-center gap-2 border-b border-line/60 px-3 py-2 text-xs last:border-0 active:bg-surface-2 ${decided ? '' : m.status === 'live' ? 'bg-brand/[0.06]' : ''}`}>
                <span className={`flex items-center justify-end gap-1 truncate ${decided && m.winner_id === m.team_a_id ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                  <span className="truncate">{teamName(b, m.team_a_id)}</span>
                  <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-3 w-4 shrink-0 rounded-[1px] object-contain" />
                </span>
                <span className="tabular text-center text-fg-subtle">
                  {decided ? `${m.score_a}–${m.score_b}` : m.status === 'live' ? <span className="animate-pulse font-bold text-brand-ink">live</span> : 'vs'}
                </span>
                <span className={`flex items-center gap-1 truncate ${decided && m.winner_id === m.team_b_id ? 'font-semibold text-fg' : 'text-fg-muted'}`}>
                  <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-3 w-4 shrink-0 rounded-[1px] object-contain" />
                  <span className="truncate">{teamName(b, m.team_b_id)}</span>
                </span>
              </Link>
            )
          }) : <div className="p-3 text-xs text-fg-subtle">No group matches.</div>}
        </div>
      )}
    </div>
  )
}

function interleaveByCourt(ms: Match[], courts: { id: string; number: number }[]): Match[] {
  const groups = new Map<string, Match[]>()
  for (const m of ms) {
    const k = m.court_id ?? '~'
    const g = groups.get(k); if (g) g.push(m); else groups.set(k, [m])
  }
  for (const g of groups.values()) g.sort((x, y) => x.sequence - y.sequence)
  const ordered = courts.slice().sort((a, z) => a.number - z.number).map(c => c.id).filter(id => groups.has(id))
  for (const k of groups.keys()) if (!ordered.includes(k)) ordered.push(k)
  const out: Match[] = []
  for (let i = 0; ; i++) {
    let any = false
    for (const k of ordered) { const g = groups.get(k)!; if (i < g.length) { out.push(g[i]); any = true } }
    if (!any) break
  }
  return out
}

function FlatMatches({ b, code }: { b: Bundle; code: string }) {
  const upcoming = interleaveByCourt(
    b.matches.filter(m => m.status !== 'finished' && (m.team_a_id != null || m.team_b_id != null)),
    b.courts,
  )
  const done = results(b)
  const statusPill = (m: Match) =>
    m.status === 'live'
      ? <Pill tone="live"><span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />live</Pill>
      : m.status === 'finished'
        ? <Pill tone="done">finished</Pill>
        : <Pill>{m.status.replace('_', ' ')}</Pill>

  const Header = () => (
    <div className="hidden grid-cols-[3rem_1fr_7rem_1fr] items-center gap-3 px-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-fg-subtle sm:grid">
      <div className="text-center">Court</div>
      <div>Team</div>
      <div className="text-center">Status</div>
      <div className="text-right">Team</div>
    </div>
  )

  const row = (m: Match) => {
    const finished = m.status === 'finished'
    const live = m.status === 'live'
    const aWin = finished && m.winner_id === m.team_a_id
    const bWin = finished && m.winner_id === m.team_b_id
    const court = b.courts.find(c => c.id === m.court_id)?.number ?? '–'
    const nameCls = (win: boolean) => win ? 'font-bold text-gold' : 'text-fg-muted'
    const scoreCls = (win: boolean) => win ? 'text-gold' : 'text-fg-subtle'
    const flag = 'h-4 w-6 shrink-0 rounded-[1px] object-contain'
    return (
      <Link key={m.id} to={`/c/${code}/match/${m.id}`}
        className={`block px-4 py-3 active:bg-surface-2 ${live ? 'bg-brand/[0.06]' : ''}`}>
        {/* wide: teams pushed to the edges, status centered */}
        <div className="hidden grid-cols-[3rem_1fr_7rem_1fr] items-center gap-3 sm:grid">
          <div className="text-center font-display text-base font-bold text-fg-subtle">{court}</div>
          <div className="flex min-w-0 items-center gap-2">
            <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={flag} />
            <span className={`truncate text-sm ${nameCls(aWin)}`}>{teamName(b, m.team_a_id)}</span>
            {finished && <span className={`ml-auto pl-2 tabular font-display text-lg font-bold ${scoreCls(aWin)}`}>{m.score_a}</span>}
          </div>
          <div className="flex justify-center">{statusPill(m)}</div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {finished && <span className={`mr-auto pr-2 tabular font-display text-lg font-bold ${scoreCls(bWin)}`}>{m.score_b}</span>}
            <span className={`truncate text-right text-sm ${nameCls(bWin)}`}>{teamName(b, m.team_b_id)}</span>
            <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={flag} />
          </div>
        </div>
        {/* mobile: stacked */}
        <div className="flex items-center gap-3 sm:hidden">
          <div className="w-8 shrink-0 text-center font-display text-base font-bold text-fg-subtle">{court}</div>
          <div className="min-w-0 flex-1 space-y-0.5">
            <div className="flex items-center gap-2">
              <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={flag} />
              <span className={`truncate text-sm ${nameCls(aWin)}`}>{teamName(b, m.team_a_id)}</span>
              {finished && <span className={`ml-auto tabular font-bold ${scoreCls(aWin)}`}>{m.score_a}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={flag} />
              <span className={`truncate text-sm ${nameCls(bWin)}`}>{teamName(b, m.team_b_id)}</span>
              {finished && <span className={`ml-auto tabular font-bold ${scoreCls(bWin)}`}>{m.score_b}</span>}
            </div>
          </div>
          {!finished && <div className="shrink-0">{statusPill(m)}</div>}
        </div>
      </Link>
    )
  }

  return (
    <div className="space-y-6 p-3">
      <section>
        <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">Up next</div>
        <Header />
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {upcoming.length ? upcoming.map(row) : <div className="p-4 text-sm text-fg-subtle">Nothing scheduled right now.</div>}
        </div>
      </section>
      <section>
        <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">Results</div>
        <Header />
        <div className="divide-y divide-line overflow-hidden rounded-xl border border-line">
          {done.length ? done.map(row) : <div className="p-4 text-sm text-fg-subtle">No completed matches yet.</div>}
        </div>
      </section>
    </div>
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
