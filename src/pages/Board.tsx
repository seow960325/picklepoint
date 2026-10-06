import { useState, useEffect, useRef, useLayoutEffect } from 'react'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, teamLogo, liveOnCourt, nextOnCourt, onDeck, results, standings,
  eventOf, duelTally, duelPods, groupStandings, bracketRounds, bracketSeeded, isKoMatch,
} from '../lib/store'
import { displayScores, rulesOf, servingSide, serverCourt as serverCourtOf, scoreCall, activeServerNo } from '../lib/scoring'
import type { Bundle, EventCfg, Match } from '../lib/types'
import { Screen, Pill, Spinner, FullscreenButton, Flag, Emblem, ThemeToggle } from '../components/ui'
import Court from '../components/Court'
import { IS_DEMO, demo } from '../lib/api'
import { fullscreenSupported } from '../lib/fullscreen'
import TieStandings from '../components/TieStandings'
import {
  isMultiSport, sportBundle, sportsPresent, SPORT_ICON, SPORT_LABEL, SPORT_TONE,
  parseSportView, readSportView, saveSportView, tiesOf, tieTitle, koState, koCourtLabel,
  type Sport, type SportView, type Tie,
} from '../lib/multisport'
import { KnockoutBracket, ChampionStage, FinalBanner, useWide } from '../components/TieKnockout'
import { CourtQueues, GroupCardPro, PlayClock, UpNextQueue } from '../components/GroupsKo'
import { isPoolDispatch, koSlotLabel, stageLabel } from '../lib/pool'

type Tab = 'live' | 'standings' | 'bracket' | 'matches' | 'knockout'

export default function Board() {
  const { code } = useParams()
  const { bundle, error, loading, reload } = useCompetition(code)
  const navigate = useNavigate()
  const [tab, setTab] = useState<Tab>('live')
  const [tv, setTv] = useState(false)
  const [tvView, setTvView] = useState<'live' | 'bracket'>('live')
  // multi-sport codes only: which sport this viewer follows (URL ?s= wins, then this device's last pick)
  const [params, setParams] = useSearchParams()
  const [picked, setPicked] = useState<SportView | null>(() =>
    parseSportView(params.get('s')) ?? (code ? readSportView(code) : null))
  // multi-sport TV: live courts, tables/bracket, or alternate every 20 s
  const [tvPane, setTvPane] = useState<'live' | 'board' | 'auto'>('live')
  const [flip, setFlip] = useState(false)
  useEffect(() => {
    if (!tv || tvPane !== 'auto') return
    const id = setInterval(() => setFlip(f => !f), 20000)
    return () => clearInterval(id)
  }, [tv, tvPane])
  const wide = useWide()
  const pickSport = (v: SportView) => {
    setPicked(v)
    if (code) saveSportView(code, v)
    const next = new URLSearchParams(params)
    next.set('s', v)
    setParams(next, { replace: true })
  }

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
  const duelWin = !podium && duelEvent ? duelWinner(bundle, duelEvent) : null
  const koEv = bundle.events.find(e => e.format === 'groups_ko')
  const koReady = !!koEv && bracketSeeded(bundle, koEv.id)
  // sister-category codes (MCMD / MCXD): long titles, compact phone header
  const twoCat = !!koEv?.tv_partner

  // multi-sport (opt-in per code): each viewer follows one sport, or both
  const multi = isMultiSport(bundle)
  const sports = multi ? sportsPresent(bundle) : []
  const view: SportView | null = !multi ? 'all'
    : sports.length < 2 ? (sports[0] ?? 'all')
    : picked === 'all' || (picked != null && sports.includes(picked as Sport)) ? picked
    : null
  if (view === null) return <SportGate b={bundle} sports={sports} onPick={pickSport} />
  const sv: SportView = view
  const vb = multi && sv !== 'all' ? sportBundle(bundle, sv) : bundle
  const activeTab = multi && sv !== 'all' ? SPORT_TONE[sv].solid : 'bg-brand text-brand-fg'
  const anyKo = multi && sports.some(s => koState(sportBundle(bundle, s)).phase !== 'groups')

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
          {multi && sports.length > 1 && <SportSwitch sports={sports} view={sv} onPick={pickSport} size="sm" />}
          {multi && (
            <div className="flex rounded-lg border border-line bg-surface/70 p-0.5 text-xs">
              {(['live', 'board', 'auto'] as const).map(p => (
                <button key={p} onClick={() => { setTvPane(p); setFlip(false) }}
                  className={`rounded-md px-2.5 py-1 ${tvPane === p ? 'bg-fg text-canvas' : 'text-fg-muted'}`}>
                  {p === 'live' ? 'Live' : p === 'board' ? (anyKo ? 'Bracket' : 'Tables') : 'Auto'}
                </button>
              ))}
            </div>
          )}
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
        {multi
          ? <TvSports b={bundle} view={sv} code={code!} pane={tvPane} flip={flip} title={c.name} />
          : tvView === 'bracket' && koReady
          ? (
            <div className="min-h-0 flex-1 px-2 sm:px-6">
              <FitBox><PosterBracket b={bundle} broadcast /></FitBox>
            </div>
          )
          : podium
          ? <Podium b={bundle} champion={podium.champion} runnerUp={podium.runnerUp} third={podium.third} title={c.name} />
          : duelWin
          ? <DuelPodium winnerName={duelWin.winnerName} loserName={duelWin.loserName}
              winnerScore={duelWin.winnerScore} loserScore={duelWin.loserScore} title={c.name} />
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
      {multi && <SportBar view={sv} sports={sports} />}

      <div className="border-b border-line px-4 py-3 lg:px-6 lg:py-4">
        <div className="flex items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2 lg:gap-3">
            <Link to="/" aria-label="Back to lobby"
              className="flex h-8 shrink-0 items-center gap-1 rounded-lg border border-line px-2.5 text-sm text-fg-muted active:bg-surface-2 lg:h-10 lg:px-3">
              ←<span className="hidden font-semibold sm:inline"> Lobby</span>
            </Link>
            <div className="min-w-0">
              <div className={`${multi || twoCat ? 'line-clamp-2 leading-tight' : 'truncate'} font-display text-2xl font-bold tracking-wide lg:text-3xl`}>{c.name}</div>
              <div className="truncate text-xs text-fg-muted lg:text-sm">
                {twoCat ? koEv!.name : c.venue} · code <span className="font-bold text-brand-ink">{c.code}</span>
              </div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5 lg:gap-2">
            <Link to={`/c/${code}/admin`}
              className="flex h-8 items-center rounded-lg border border-line px-3 text-xs text-fg-muted active:bg-surface-2 lg:h-10 lg:px-4 lg:text-sm">
              {multi || twoCat ? <><span className="sm:hidden">⚙</span><span className="hidden sm:inline">Settings</span></> : 'Settings'}
            </Link>
            <button onClick={() => koEv?.tv_partner
                ? navigate(`/tv/${c.code}+${koEv.tv_partner}`)
                : setTv(true)}
              className="flex h-8 items-center rounded-lg border border-line px-3 text-xs text-fg-muted active:bg-surface-2 lg:h-10 lg:px-4 lg:text-sm">
              {multi || twoCat ? <><span className="sm:hidden">TV</span><span className="hidden sm:inline">TV mode</span></> : 'TV mode'}
            </button>
            <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-line p-1.5 text-fg-muted active:bg-surface-2 lg:h-10 lg:w-10" />
            <ThemeToggle className="grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2 lg:h-10 lg:w-10" />
          </div>
        </div>

        {multi && sports.length > 1 && (
          <div className="mt-3 lg:mt-4">
            <SportSwitch sports={sports} view={sv} onPick={pickSport} />
          </div>
        )}

        <div className="mt-3 flex gap-1 overflow-x-auto lg:mt-4 lg:gap-2">
          {([...(bundle.events.some(e => e.format === 'groups_ko')
              ? ['live', 'matches', 'bracket']
              : ['live', 'matches']),
             ...(isMultiSport(bundle) ? ['standings', 'knockout'] : [])] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-semibold uppercase tracking-wider lg:px-4 lg:text-sm ${
                tab === t ? activeTab : 'text-fg-muted'}`}>
              {t}
            </button>
          ))}
        </div>
      </div>

      {tab === 'live' && (multi
        ? <MultiLive b={bundle} code={code!} view={sv} onPick={pickSport} title={c.name} wide={wide} />
        : <LiveGrid b={bundle} code={code!} tv={false} />)}
      {tab === 'standings' && multi && <TieStandings b={vb} />}
      {tab === 'knockout' && multi && <MultiKnockout b={bundle} view={sv} title={c.name} wide={wide} />}
      {tab === 'bracket' && <PosterBracket b={bundle} />}
      {tab === 'matches' && (multi
        ? <TieMatches b={bundle} code={code!} view={sv} />
        : <Matches b={bundle} code={code!} />)}

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
            <div key={m.id} className="grid grid-cols-[minmax(0,1fr)_2rem_minmax(0,1fr)] items-center gap-2 text-base sm:text-lg">
              <span className="flex min-w-0 items-center justify-end gap-2">
                <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
                <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-4 w-auto shrink-0 rounded-[1px]" />
              </span>
              <span className="text-center text-fg-subtle">vs</span>
              <span className="flex min-w-0 items-center gap-2">
                <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-4 w-auto shrink-0 rounded-[1px]" />
                <span className="truncate">{teamName(b, m.team_b_id)}</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------- multi-sport board
// Opt-in multi-sport codes only (e.g. pickleball + badminton on one code).
// Each viewer picks the sport they follow; the pick sticks on that device and
// can be deep-linked with ?s=pickleball / ?s=badminton / ?s=all (one QR per
// hall). Each sport keeps its own colour (SPORT_TONE) on every screen.

function SportGate({ b, sports, onPick }: { b: Bundle; sports: Sport[]; onPick: (v: SportView) => void }) {
  const c = b.competition
  return (
    <Screen className="flex flex-col items-center justify-center px-5 py-10">
      <div className="w-full max-w-md">
        <div className="text-center font-display text-3xl font-bold tracking-wide sm:text-4xl">{c.name}</div>
        <div className="mt-1 text-center text-xs text-fg-subtle">
          {c.venue ? `${c.venue} · ` : ''}code <span className="font-bold text-brand-ink">{c.code}</span>
        </div>
        <div className="mt-8 text-center text-sm font-semibold text-fg-muted">Which sport are you following?</div>
        <div className="mt-3 grid gap-3">
          {sports.map(s => {
            const sb = sportBundle(b, s)
            const t = SPORT_TONE[s]
            const live = sb.courts.filter(ct => liveOnCourt(sb, ct.id)).length
            return (
              <button key={s} onClick={() => onPick(s)}
                className={`flex items-center gap-4 rounded-2xl border-2 px-5 py-5 text-left active:scale-[0.99] ${t.border} ${t.soft}`}>
                <span className="text-4xl leading-none">{SPORT_ICON[s]}</span>
                <span className="min-w-0 flex-1">
                  <span className={`block font-display text-3xl font-bold uppercase tracking-wide ${t.text}`}>{SPORT_LABEL[s]}</span>
                  <span className="block text-xs text-fg-muted">
                    {sb.courts.length} court{sb.courts.length === 1 ? '' : 's'} · {sb.teams.length} teams
                    {live > 0 && <span className="font-bold text-fg"> · {live} live now</span>}
                  </span>
                </span>
                <span className={`font-display text-3xl ${t.text}`}>›</span>
              </button>
            )
          })}
        </div>
        <button onClick={() => onPick('all')}
          className="mt-3 w-full rounded-2xl border border-line py-3 font-display text-base font-bold uppercase tracking-wider text-fg-muted active:bg-surface-2">
          Show both sports
        </button>
        <div className="mt-6 text-center text-xs text-fg-subtle">You can switch any time at the top of the board.</div>
        <div className="mt-4 text-center">
          <Link to="/" className="text-xs text-fg-subtle underline underline-offset-4">← Lobby</Link>
        </div>
      </div>
    </Screen>
  )
}

function SportSwitch({ sports, view, onPick, size = 'md' }: {
  sports: Sport[]; view: SportView; onPick: (v: SportView) => void; size?: 'md' | 'sm'
}) {
  const opts: SportView[] = [...sports, 'all']
  return (
    <div className="grid gap-1 rounded-xl border border-line bg-surface p-1"
      style={{ gridTemplateColumns: `repeat(${sports.length}, minmax(0, 1fr)) auto` }}>
      {opts.map(o => {
        const on = o === view
        const tone = o === 'all' ? 'bg-fg text-canvas' : SPORT_TONE[o].solid
        return (
          <button key={o} onClick={() => onPick(o)}
            className={`flex min-w-0 items-center justify-center gap-1.5 whitespace-nowrap rounded-lg font-display font-bold uppercase tracking-wider ${
              size === 'md' ? 'px-2 py-2 text-[13px] tracking-wide sm:px-3 sm:text-sm sm:tracking-wider lg:text-base' : 'px-2.5 py-1 text-xs'} ${
              on ? tone : 'text-fg-muted active:bg-surface-2'}`}>
            {o === 'all' ? 'Both' : <><span>{SPORT_ICON[o]}</span><span className="truncate">{SPORT_LABEL[o]}</span></>}
          </button>
        )
      })}
    </div>
  )
}

/** Thin colour strip on top of the board: one sport's colour, or both halves. */
function SportBar({ view, sports }: { view: SportView; sports: Sport[] }) {
  const show = view === 'all' ? sports : [view]
  return (
    <div className="flex h-1.5">
      {show.map(s => <div key={s} className={`flex-1 ${SPORT_TONE[s].bar}`} />)}
    </div>
  )
}

function SportBanner({ sport, b, big = false, onOpen }: {
  sport: Sport; b: Bundle; big?: boolean; onOpen?: () => void
}) {
  const t = SPORT_TONE[sport]
  const live = b.courts.filter(ct => liveOnCourt(b, ct.id)).length
  return (
    <div className={`mb-2 flex items-center gap-2 rounded-xl border ${t.border} ${t.soft} ${big ? 'mb-3 px-4 py-2' : 'px-3 py-1.5'}`}>
      <span className={big ? 'text-3xl leading-none' : 'text-lg leading-none'}>{SPORT_ICON[sport]}</span>
      <span className={`font-display font-bold uppercase tracking-widest ${t.text} ${big ? 'text-3xl' : 'text-base'}`}>
        {SPORT_LABEL[sport]}
      </span>
      <span className="ml-auto flex items-center gap-2">
        {live > 0
          ? <Pill tone="live">● {live} live</Pill>
          : <span className="text-[11px] text-fg-subtle">{b.courts.length} court{b.courts.length === 1 ? '' : 's'}</span>}
        {onOpen && (
          <button onClick={onOpen}
            className={`rounded-lg border px-2.5 py-1 text-[11px] font-bold uppercase tracking-wider ${t.border} ${t.text}`}>
            Only {SPORT_LABEL[sport]} ›
          </button>
        )}
      </span>
    </div>
  )
}

/** Champions ceremony once a sport is decided, gold Final strip while its Final is on. */
function StageTop({ sb, sport, title, size }: { sb: Bundle; sport: Sport; title: string; size: 'sm' | 'md' }) {
  const k = koState(sb)
  if (k.phase === 'done') return <div className="mb-3"><ChampionStage b={sb} sport={sport} k={k} title={title} size={size} /></div>
  if (k.final?.games.some(g => g.status === 'live')) return <FinalBanner b={sb} t={k.final} />
  return null
}

function MultiLive({ b, code, view, onPick, title, wide }: {
  b: Bundle; code: string; view: SportView; onPick: (v: SportView) => void; title: string; wide: boolean
}) {
  if (view !== 'all') {
    const sb = sportBundle(b, view)
    return <>
      <div className="px-3 pt-3 lg:px-5 [&:empty]:hidden"><StageTop sb={sb} sport={view} title={title} size={wide ? 'md' : 'sm'} /></div>
      <LiveGrid b={sb} code={code} tv={false} hideDeck />
      <div className="px-3 pb-4 lg:px-5"><NextTies b={sb} /></div>
    </>
  }
  return (
    <div className="grid gap-6 p-3 lg:grid-cols-2 lg:p-5">
      {sportsPresent(b).map(s => {
        const sb = sportBundle(b, s)
        return (
          <section key={s} className="min-w-0">
            <SportBanner sport={s} b={sb} onOpen={() => onPick(s)} />
            <StageTop sb={sb} sport={s} title={title} size="sm" />
            <LiveGrid b={sb} code={code} tv={false} compact hideDeck />
            <NextTies b={sb} />
          </section>
        )
      })}
    </div>
  )
}

/** The next few ties that haven't started (one row per team-vs-team meeting). */
function NextTies({ b, n = 4 }: { b: Bundle; n?: number }) {
  const ties = b.events.flatMap(e => tiesOf(b, e.id))
    .filter(t => t.games.every(g => g.status === 'scheduled' || g.status === 'on_deck'))
    .slice(0, n)
  if (!ties.length) return null
  const fl = 'h-4 w-4 shrink-0 rounded-[2px] object-contain'
  return (
    <div className="mt-4">
      <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-accent">Next ties</div>
      <div className="divide-y divide-line/60 rounded-2xl border border-line bg-surface">
        {ties.map((t, i) => (
          <div key={t.id} className="px-3 py-2">
            <div className="grid grid-cols-[1.1rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-center gap-1.5 text-sm">
              <span className="text-center font-display text-xs font-bold text-fg-subtle">{i + 1}</span>
              <span className="flex min-w-0 items-center justify-end gap-1.5">
                <span className="truncate text-right">{teamName(b, t.a)}</span>
                <Emblem logo={teamLogo(b, t.a)} flagName={teamSideName(b, t.a)} className={fl} />
              </span>
              <span className="text-center text-xs text-fg-subtle">vs</span>
              <span className="flex min-w-0 items-center gap-1.5">
                <Emblem logo={teamLogo(b, t.b)} flagName={teamSideName(b, t.b)} className={fl} />
                <span className="truncate">{teamName(b, t.b)}</span>
              </span>
            </div>
            <div className="mt-0.5 text-center text-[10px] uppercase tracking-wider text-fg-subtle">
              {tieTitle(t)} · {t.units.map(u => u.label).join(' · ')}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

/** TV: one sport full-screen, or both sports split left | right.
 *  Each half shows, by stage: live courts (gold Final strip during the Final),
 *  group tables or the bracket (pane, auto-rotation, or nothing live), and the
 *  champions ceremony once the sport is decided. */
function TvSports({ b, view, code, pane, flip, title }: {
  b: Bundle; code: string; view: SportView; pane: 'live' | 'board' | 'auto'; flip: boolean; title: string
}) {
  const sports = view === 'all' ? sportsPresent(b) : [view]
  const split = sports.length > 1
  return (
    <div className="shrink-0 px-4 sm:px-8">
      <div className={`mx-auto grid w-full gap-6 ${split ? 'max-w-[1800px] lg:grid-cols-2 lg:gap-8' : 'max-w-[1600px]'}`}>
        {sports.map(s => {
          const sb = sportBundle(b, s)
          const k = koState(sb)
          const live = sb.courts.some(ct => liveOnCourt(sb, ct.id))
          const finalLive = !!k.final?.games.some(g => g.status === 'live')
          const board = pane === 'board' || (pane === 'auto' && flip) || !live
          if (k.phase === 'done' && pane !== 'board') {
            return (
              <section key={s} className="min-w-0">
                <ChampionStage b={sb} sport={s} k={k} title="" size={split ? 'md' : 'lg'} />
              </section>
            )
          }
          return (
            <section key={s} className="min-w-0">
              <SportBanner sport={s} b={sb} big />
              {board
                ? (k.phase === 'groups'
                  ? <TieStandings b={sb} big />
                  : <KnockoutBracket b={sb} sport={s} big />)
                : <>
                    {finalLive && k.final && <FinalBanner b={sb} t={k.final} big />}
                    <LiveGrid b={sb} code={code} tv split={split} />
                  </>}
            </section>
          )
        })}
      </div>
    </div>
  )
}

/** Knockout tab: ceremony (once decided) above each sport's bracket. */
function MultiKnockout({ b, view, title, wide }: { b: Bundle; view: SportView; title: string; wide: boolean }) {
  const sports = view === 'all' ? sportsPresent(b) : [view]
  const both = sports.length > 1
  return (
    <div className={`p-3 lg:p-5 ${both ? 'grid gap-8 xl:grid-cols-2' : ''}`}>
      {sports.map(s => {
        const sb = sportBundle(b, s)
        const k = koState(sb)
        return (
          <section key={s} className="min-w-0 space-y-4">
            {both && <SportBanner sport={s} b={sb} />}
            {k.phase === 'done' && <ChampionStage b={sb} sport={s} k={k} title={title} size={wide && !both ? 'md' : 'sm'} />}
            {k.final?.games.some(g => g.status === 'live') && <FinalBanner b={sb} t={k.final} />}
            <KnockoutBracket b={sb} sport={s} />
          </section>
        )
      })}
    </div>
  )
}

/** Matches tab: team-vs-team ties with their games underneath, per sport. */
function TieMatches({ b, code, view }: { b: Bundle; code: string; view: SportView }) {
  const sports = view === 'all' ? sportsPresent(b) : [view]
  const both = sports.length > 1
  return (
    <div className={`p-3 lg:p-5 ${both ? 'grid gap-6 lg:grid-cols-2' : ''}`}>
      {sports.map(s => (
        <SportTies key={s} b={sportBundle(b, s)} sport={s} code={code} banner={both} wide={!both} />
      ))}
    </div>
  )
}

function SportTies({ b, sport, code, banner, wide }: {
  b: Bundle; sport: Sport; code: string; banner: boolean; wide: boolean
}) {
  const ties = b.events.flatMap(e => tiesOf(b, e.id))
  const isLive = (t: Tie) => t.games.some(g => g.status === 'live')
  const upcoming = ties.filter(t => !t.done).sort((x, y) => Number(isLive(y)) - Number(isLive(x)))
  const done = ties.filter(t => t.done).reverse()
  const grid = `grid gap-2 ${wide ? 'sm:grid-cols-2 xl:grid-cols-3' : ''}`
  const head = (txt: string) => (
    <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-fg-muted">{txt}</div>
  )
  const empty = (txt: string) => (
    <div className="rounded-xl border border-line p-4 text-sm text-fg-subtle">{txt}</div>
  )
  return (
    <section className="min-w-0">
      {banner && <SportBanner sport={sport} b={b} />}
      {ties.length === 0 ? empty('Schedule not drawn yet.') : (
        <div className="space-y-5">
          <div>
            {head('Up next')}
            {upcoming.length
              ? <div className={grid}>{upcoming.map(t => <TieCard key={t.id} b={b} t={t} code={code} sport={sport} />)}</div>
              : empty('Every tie has been played.')}
          </div>
          {done.length > 0 && (
            <div>
              {head('Results')}
              <div className={grid}>{done.map(t => <TieCard key={t.id} b={b} t={t} code={code} sport={sport} />)}</div>
            </div>
          )}
        </div>
      )}
    </section>
  )
}

function TieCard({ b, t, code, sport }: { b: Bundle; t: Tie; code: string; sport: Sport }) {
  const tone = SPORT_TONE[sport]
  const live = t.games.some(g => g.status === 'live')
  const started = live || t.games.some(g => g.status === 'finished')
  const aWin = t.stage ? t.winner === t.a && !!t.winner : t.done && t.aPts > t.bPts
  const bWin = t.stage ? t.winner === t.b && !!t.winner : t.done && t.bPts > t.aPts
  const sweep = !t.stage && t.done && (t.aGames === t.units.length || t.bGames === t.units.length)
  const court = (id: string | null) => {
    const ct = b.courts.find(c => c.id === id)
    return ct ? (ct.label || `Court ${ct.number}`) : '—'
  }
  const side = (id: string | null, win: boolean, right: boolean) => (
    <span className={`flex min-w-0 items-center gap-1.5 ${right ? 'justify-end' : ''} ${
      win ? 'font-bold text-fg' : t.done ? 'text-fg-muted' : 'text-fg'}`}>
      {right && <span className="truncate text-right">{teamName(b, id)}</span>}
      <Emblem logo={teamLogo(b, id)} flagName={teamSideName(b, id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
      {!right && <span className="truncate">{teamName(b, id)}</span>}
    </span>
  )
  return (
    <div className={`overflow-hidden rounded-xl border bg-surface ${
      t.stage === 'F' ? 'border-[#c99a3c]' : live ? tone.border : 'border-line'}`}>
      <div className={`flex items-center justify-between gap-2 px-3 pt-2 text-[10px] font-bold uppercase tracking-widest ${
        t.stage === 'F' ? 'font-cer text-gold' : t.stage ? tone.text : 'text-fg-subtle'}`}>
        <span className="truncate">{tieTitle(t)}</span>
        {live ? <Pill tone="live">● live</Pill> : t.done ? <Pill tone="done">final</Pill> : null}
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-3 py-2 text-sm">
        {side(t.a, aWin, true)}
        <span className={`tabular font-display text-lg font-bold ${started ? tone.text : 'text-fg-subtle'}`}>
          {started ? `${t.aGames}–${t.bGames}` : 'vs'}
        </span>
        {side(t.b, bWin, false)}
      </div>
      {!started ? (
        <div className="flex flex-wrap justify-center gap-x-3 gap-y-0.5 border-t border-line/60 px-3 py-1.5 text-[11px] text-fg-subtle">
          {t.games.map(g => (
            <span key={g.id} className="whitespace-nowrap">
              <span className={`font-display font-bold ${tone.text}`}>{g.game_label}{g.set_no ? ` G${g.set_no}` : ''}</span> {court(g.court_id)}
            </span>
          ))}
        </div>
      ) : (
      <div className="divide-y divide-line/60 border-t border-line/60">
        {t.games.map(g => {
          const played = g.status === 'live' || g.status === 'finished'
          return (
            <Link key={g.id} to={`/c/${code}/match/${g.id}`}
              className={`grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-2 px-3 py-1.5 text-xs active:bg-surface-2 ${
                g.status === 'live' ? tone.soft : ''}`}>
              <span className={`font-display text-sm font-bold ${tone.text}`}>{g.game_label}{g.set_no ? <span className="text-[10px] text-fg-subtle"> G{g.set_no}</span> : null}</span>
              <span className="truncate text-fg-subtle">{court(g.court_id)}</span>
              <span className={`tabular font-bold ${played ? 'text-fg' : 'text-fg-subtle'}`}>
                {played ? `${g.score_a}–${g.score_b}` : g.status === 'on_deck' ? 'on deck' : '—'}
              </span>
            </Link>
          )
        })}
      </div>
      )}
      {sweep && <div className="px-3 pb-2 pt-1 text-[11px] font-bold text-gold">Sweep · +1 bonus</div>}
    </div>
  )
}

/** neon glow for the court status line: green = group, cyan = knockout, gold = final */
const neon = (kind: 'group' | 'ko' | 'final'): React.CSSProperties => {
  const c = kind === 'final' ? '#ffd23d' : kind === 'ko' ? '#22d3ee' : '#c6ff3d'
  return { color: c, textShadow: `0 0 4px ${c}, 0 0 12px ${c}99, 0 0 26px ${c}55` }
}

export function LiveGrid({ b, code, tv, split = false, compact = false, hideDeck = false }: {
  b: Bundle; code: string; tv: boolean
  split?: boolean    // TV half-screen (multi-sport "both")
  compact?: boolean  // board half-width column (multi-sport "both")
  hideDeck?: boolean // multi-sport: per-court lists replaced by "Next ties"
}) {
  const poolEv = b.events.find(e => e.format === 'groups_ko' && isPoolDispatch(e))
  // shared-queue events keep every court on the TV (an empty one says "open")
  const shownCourts = tv && !poolEv ? b.courts.filter(ct => liveOnCourt(b, ct.id)) : b.courts
  if (tv && shownCourts.length === 0) return <TvIdle b={b} />
  // court cards and the "on deck" lists share ONE column rule so they line up
  const boardCols = compact ? 'grid-cols-1 sm:grid-cols-2'
    : b.courts.length > 3 ? 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4'
    : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3'
  const cols = !tv
    ? boardCols
    : shownCourts.length <= 1 ? 'grid-cols-1'
    : shownCourts.length === 2 || split ? 'grid-cols-1 sm:grid-cols-2'
    : 'grid-cols-1 sm:grid-cols-3'
  const tvBig = tv && !!poolEv && !split   // MC combined TV: larger wording
  const wrap = tv && !split && shownCourts.length === 1 ? 'mx-auto w-full max-w-[1100px] ' : ''
  return (
    <div className={tv || compact ? '' : 'p-3 lg:p-5'}>
      <div className={`${wrap}grid gap-2 lg:gap-3 ${cols}`}>
        {shownCourts.map(ct => {
          const m = liveOnCourt(b, ct.id)
          const up = nextOnCourt(b, ct.id)
          const cardBody = <>
              <div className="mb-1.5 flex items-center justify-between gap-2 lg:mb-2">
                <span className={`min-w-0 shrink-0 truncate whitespace-nowrap font-display font-bold tracking-widest text-fg-muted ${tvBig ? 'text-3xl' : 'text-sm lg:text-base'}`}>
                  {b.competition.multi_sport && ct.label ? ct.label.toUpperCase() : `COURT ${ct.number}`}
                  {b.competition.multi_sport && ct.game_group ? ` · ${ct.game_group}` : ''}
                </span>
                <span className="flex shrink-0 items-center gap-2">
                  {m && eventOf(b, m).play_clock && <PlayClock m={m} className={tvBig ? 'text-2xl text-fg-muted' : 'text-xs text-fg-muted lg:text-sm'} />}
                  {m ? <Pill tone="live" big={tvBig}>● live</Pill> : <Pill big={tvBig}>open</Pill>}
                </span>
              </div>
              {poolEv && m && (
                <div className={`mb-1.5 truncate whitespace-nowrap text-center font-display font-bold uppercase lg:mb-2 ${tvBig ? 'text-4xl tracking-[0.2em]' : 'text-sm tracking-[0.16em] lg:text-lg'}`}
                  style={neon(stageLabel(b, m).kind)}>
                  {stageLabel(b, m).text}
                </div>
              )}
              {m ? <CourtScoreRow b={b} m={m} tv={tv} /> : (
                <div className="py-6 text-center text-sm text-fg-subtle lg:py-10">No match running</div>
              )}
              {up && (
                <div className={`mt-3 border-t border-line pt-2 text-fg-muted lg:mt-4 lg:pt-3 ${tvBig ? 'text-xl' : 'text-[11px] lg:text-sm'}`}>
                  Next: <span className="truncate">{teamName(b, up.team_a_id)}</span> vs <span className="truncate">{teamName(b, up.team_b_id)}</span>
                </div>
              )}
            </>
          return tv ? (
            <div key={ct.id} className="block rounded-2xl border border-line bg-surface p-2 lg:p-3">
              {cardBody}
            </div>
          ) : (
            <Link key={ct.id} to={`/c/${code}/court/${ct.number}`}
              className="block rounded-2xl border border-line bg-surface p-2 active:scale-[0.99] lg:p-3">
              {cardBody}
            </Link>
          )
        })}
      </div>

      {!tv && !hideDeck && poolEv && (
        <div className="mt-4"><CourtQueues b={b} ev={poolEv} cols={cols} n={99} /></div>
      )}
      {tv && poolEv && !split && (
        <div className="mt-2 lg:mt-3"><CourtQueues b={b} ev={poolEv} cols={cols} n={3} big /></div>
      )}
      {tv && poolEv && split && (
        <div className="mt-2 lg:mt-3"><UpNextQueue b={b} ev={poolEv} n={4} big /></div>
      )}
      {!tv && !hideDeck && !poolEv && (
        <div className="mt-4">
          <div className="mb-2 px-1 font-display text-sm font-bold uppercase tracking-widest text-accent">
            On deck
          </div>
          <div className={`grid gap-3 ${boardCols}`}>
            {b.courts.map(ct => {
              const ups = b.matches
                .filter(mm => mm.court_id === ct.id && (mm.status === 'scheduled' || mm.status === 'on_deck'))
                .sort((x, y) => x.sequence - y.sequence)
              return (
                <div key={ct.id} className="rounded-2xl border border-line bg-surface p-3">
                  <div className="mb-1.5 font-display text-xs font-bold uppercase tracking-widest text-fg-muted">
                    {b.competition.multi_sport && ct.label ? ct.label : `Court ${ct.number}`}
                  </div>
                  {ups.length === 0 ? (
                    <div className="py-1.5 text-xs text-fg-subtle">No upcoming matches</div>
                  ) : (
                    <div className="divide-y divide-line/60">
                      {ups.map((mm, i) => (
                        <div key={mm.id} className="grid grid-cols-[1.1rem_minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-center gap-1.5 py-1.5 text-sm">
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

function CourtScoreRow({ b, m, tv }: { b: Bundle; m: Match; tv: boolean }) {
  const s = displayScores(m)
  const ev = eventOf(b, m)
  const sideName = (teamId: string | null): string | null => {
    const t = b.teams.find(x => x.id === teamId)
    if (!t?.side) return null
    return (t.side === 'A' ? ev.side_a_name : ev.side_b_name) ?? null
  }
  const leftTeamId = m.a_on_left ? m.team_a_id : m.team_b_id
  const rightTeamId = m.a_on_left ? m.team_b_id : m.team_a_id
  const rules = rulesOf(ev, m)
  const serving = m.status === 'live' ? servingSide(m, rules.serve_mode) : null
  const serverNo = rules.serve_mode === 'alternate' && m.status === 'live' ? activeServerNo(m) : null
  const courtSide = m.status === 'live' ? serverCourtOf(m, rules.serve_mode) : null
  const call = m.status === 'live' ? scoreCall(m, rules.serve_mode) : null
  return (
    <div className="aspect-[2/1] lg:aspect-[7/4]">
      <Court
        leftName={teamName(b, leftTeamId)}
        nameHalo={ev.court_dispatch === 'pool'}
        rightName={teamName(b, rightTeamId)}
        leftScore={s.left} rightScore={s.right}
        leftFlag={sideName(leftTeamId)} rightFlag={sideName(rightTeamId)}
        leftLogo={teamLogo(b, leftTeamId)} rightLogo={teamLogo(b, rightTeamId)}
        label={ev.court_dispatch === 'pool' ? undefined : (koCourtLabel(m) ?? (m.bracket_key ? (m.round ?? undefined) : (m.game_label ?? undefined)))}
        sport={ev.sport}
        serving={serving}
        serverNo={serverNo}
        serverCourt={courtSide}
        callScore={call}
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
              <span className="grid grid-cols-[minmax(0,1fr)_1.75rem_minmax(0,1fr)] items-center gap-1">
                <span className="flex min-w-0 items-center justify-end gap-1">
                  <span className="truncate text-right">{teamName(b, m.team_a_id)}</span>
                  <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={fl} />
                </span>
                <span className="text-center text-xs text-fg-subtle">vs</span>
                <span className="flex min-w-0 items-center gap-1">
                  <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={fl} />
                  <span className="truncate">{teamName(b, m.team_b_id)}</span>
                </span>
              </span>
            </div>
            <div className="mt-1 text-[11px] tracking-wide text-fg-subtle">{(m.round ?? '').replace(/pod/i, 'Court')} · #{m.sequence}{m.game_label ? ` · ${m.game_label}` : ''}</div>
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
export function FitBox({ children }: { children: any }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [scale, setScale] = useState(1)
  useLayoutEffect(() => {
    let raf1 = 0, raf2 = 0
    const timers: ReturnType<typeof setTimeout>[] = []
    const recompute = () => {
      const o = outer.current, i = inner.current
      if (!o || !i) return
      const ow = o.clientWidth, oh = o.clientHeight
      const w = i.offsetWidth, h = i.offsetHeight
      if (!w || !h || !ow || !oh) return
      // tiny safety margin so sub-pixel rounding never lets an edge get clipped
      const s = Math.min(ow / w, oh / h) * 0.995
      if (isFinite(s) && s > 0) setScale(s)
    }
    recompute()
    // content can still reflow after the first paint (webfonts swapping in,
    // iOS toolbar show/hide changing the visible viewport, slow layout on
    // first load) -- keep re-measuring for a bit so the scale always matches
    // the FINAL rendered size, on every device, not just fast desktop ones.
    raf1 = requestAnimationFrame(() => { raf2 = requestAnimationFrame(recompute) })
    ;[100, 300, 600, 1200, 2000].forEach(ms => timers.push(setTimeout(recompute, ms)))
    const fonts: any = (document as any).fonts
    if (fonts?.ready) fonts.ready.then(recompute).catch(() => {})
    const ro = new ResizeObserver(recompute)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    window.addEventListener('resize', recompute)
    window.addEventListener('orientationchange', recompute)
    const vv: any = (window as any).visualViewport
    vv?.addEventListener('resize', recompute)
    vv?.addEventListener('scroll', recompute)
    return () => {
      ro.disconnect()
      cancelAnimationFrame(raf1); cancelAnimationFrame(raf2)
      timers.forEach(clearTimeout)
      window.removeEventListener('resize', recompute)
      window.removeEventListener('orientationchange', recompute)
      vv?.removeEventListener('resize', recompute)
      vv?.removeEventListener('scroll', recompute)
    }
  }, [])
  return (
    <div ref={outer} className="grid h-full w-full place-items-center overflow-hidden">
      <div ref={inner} style={{ transform: `scale(${scale})`, transformOrigin: 'center' }}>
        {children}
      </div>
    </div>
  )
}

export function PosterBracket({ b, broadcast = false }: { b: Bundle; broadcast?: boolean }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  if (!bracketSeeded(b, ev.id) && !ev.bracket_preview) {
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
  const podium = koPodium(b)

  return (
    <div className={`${broadcast ? 'w-max' : 'overflow-x-auto'} p-4 text-fg`} style={{ background: broadcast
        ? 'radial-gradient(ellipse at top, rgba(244,205,106,0.10), transparent 60%), rgb(var(--canvas))'
        : 'radial-gradient(ellipse at top, rgba(244,205,106,0.06), transparent 55%), rgb(var(--canvas))' }}>
      <div className="mx-auto flex min-w-max items-stretch justify-center">
        {leftCols.map((col, i) => (
          <div key={'L' + i} className="flex items-stretch">
            <PColumn b={b} col={col} side="left" />
            <PConnector count={col.matches.length} side="left" />
          </div>
        ))}

        <PCentre b={b} finalM={finalM} thirdM={thirdM} champId={champId} podium={podium} />

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

function PMatch({ b, m, medalOf }: { b: Bundle; m?: Match; medalOf?: (id: string | null) => 'gold' | 'silver' | 'bronze' | null }) {
  if (!m) return <div className="rounded-md border border-dashed border-line/60 bg-surface/30 px-2 py-3 text-center text-[10px] text-fg-subtle">TBD</div>
  // a real bye is written finished at once; a half-filled later round is not a bye
  const bye = m.team_b_id == null && m.team_a_id != null && m.status === 'finished'
  // fixed bracket shown before the teams are known (bracket_preview events)
  const ev = eventOf(b, m)
  const slot = (s: 'a' | 'b') => ev?.bracket_preview ? koSlotLabel(b, ev, m, s) : undefined
  const decided = m.status === 'finished'
  const live = m.status === 'live'
  return (
    <div className="relative">
      {live && (
        <div className="absolute right-0 top-0 z-10 -translate-y-[130%]">
          <Pill tone="live"><span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />live</Pill>
        </div>
      )}
      <div className={`overflow-hidden rounded-md border ${live ? 'border-brand pp-live' : 'border-line'} bg-surface`}>
        <PTeam b={b} teamId={m.team_a_id} score={m.score_a} win={decided && m.winner_id === m.team_a_id} lose={decided && m.winner_id !== m.team_a_id} finished={decided} medal={medalOf?.(m.team_a_id) ?? null} placeholder={slot('a')} />
        <div className="h-px bg-line" />
        {bye
          ? <div className="px-2.5 py-1.5 text-[11px] italic text-fg-subtle">bye</div>
          : <PTeam b={b} teamId={m.team_b_id} score={m.score_b} win={decided && m.winner_id === m.team_b_id} lose={decided && m.winner_id !== m.team_b_id} finished={decided} medal={medalOf?.(m.team_b_id) ?? null} placeholder={slot('b')} />}
      </div>
    </div>
  )
}

function PTeam({ b, teamId, score, win, lose, finished, medal, placeholder }: { b: Bundle; teamId: string | null; score: number; win: boolean; lose: boolean; finished: boolean; medal?: 'gold' | 'silver' | 'bronze' | null; placeholder?: string }) {
  if (teamId == null && placeholder) {
    return (
      <div className="flex items-center gap-2 border-l-2 border-transparent px-2.5 py-1.5">
        <span className="h-4 w-4 shrink-0 rounded-[2px] border border-dashed border-line-strong" />
        <span className="min-w-0 flex-1 truncate text-xs italic text-fg-subtle">{placeholder}</span>
      </div>
    )
  }
  return (
    <div className={`flex items-center gap-2 border-l-2 px-2.5 py-1.5 ${win ? 'border-gold bg-gold/15' : lose ? 'border-transparent opacity-45' : 'border-transparent'}`}>
      <Emblem logo={teamLogo(b, teamId)} flagName={teamSideName(b, teamId)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
      <span className={`min-w-0 flex-1 truncate text-xs ${win ? 'font-bold text-fg' : 'text-fg-muted'}`}>{teamName(b, teamId)}</span>
      {medal && <span className="shrink-0 text-xs leading-none" aria-label={medal}>{medal === 'gold' ? '🥇' : medal === 'silver' ? '🥈' : '🥉'}</span>}
      {finished && <span className={`tabular shrink-0 text-xs ${win ? 'font-bold text-gold' : 'text-fg-subtle'}`}>{score}</span>}
    </div>
  )
}

function PCentre({ b, finalM, thirdM, champId, podium }: {
  b: Bundle; finalM?: Match; thirdM?: Match; champId: string | null
  podium: { champion: string; runnerUp: string | null; third: string | null } | null
}) {
  // medals only once BOTH the Final and Third place matches are confirmed
  const medalsReady = finalM?.status === 'finished' && thirdM?.status === 'finished' && !!podium
  const medalOf = (id: string | null): 'gold' | 'silver' | 'bronze' | null => {
    if (!medalsReady || !id) return null
    if (id === podium!.champion) return 'gold'
    if (id === podium!.runnerUp) return 'silver'
    if (id === podium!.third) return 'bronze'
    return null
  }
  return (
    <div className="flex flex-col px-2 lg:px-5">
      <div className="mb-1 h-4 text-center font-cer text-[11px] font-bold uppercase tracking-[0.28em] text-gold">Final</div>
      <div className="flex flex-1 flex-col items-center justify-center gap-2">
        <div className="w-52"><PMatch b={b} m={finalM} medalOf={medalOf} /></div>
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
        <div className="w-48"><PMatch b={b} m={thirdM} medalOf={medalOf} /></div>
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

export function koPodium(b: Bundle): { champion: string; runnerUp: string | null; third: string | null } | null {
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

export function Podium({ b, champion, runnerUp, third, title }: {
  b: Bundle; champion: string; runnerUp: string | null; third: string | null; title: string
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 text-fg">
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

/** A duel event's overall winner, once every game has been played and one
 *  side is ahead — generic for any duel-format competition, not just one. */
function duelWinner(b: Bundle, ev: EventCfg): {
  winnerName: string; loserName: string; winnerScore: number; loserScore: number
} | null {
  const t = duelTally(b, ev.id)
  if (t.gamesTotal === 0 || t.gamesPlayed !== t.gamesTotal || t.leader === 'tie') return null
  const aName = ev.side_a_name || 'Side A', bName = ev.side_b_name || 'Side B'
  return t.leader === 'A'
    ? { winnerName: aName, loserName: bName, winnerScore: t.sideAWins, loserScore: t.sideBWins }
    : { winnerName: bName, loserName: aName, winnerScore: t.sideBWins, loserScore: t.sideAWins }
}

/** Champion celebration for a decided duel, mirroring the KO Podium's look
 *  and feel but for two sides instead of three team slots. */
function DuelPodium({ winnerName, loserName, winnerScore, loserScore, title }: {
  winnerName: string; loserName: string; winnerScore: number; loserScore: number; title: string
}) {
  return (
    <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden px-4 text-fg">
      <div className="pointer-events-none absolute inset-0" style={{ background: 'radial-gradient(46% 55% at 50% 12%, rgba(244,205,106,0.16), transparent 60%)' }} />
      <div className="pointer-events-none absolute inset-x-0 top-0 h-2/3 opacity-25" style={{ background: 'repeating-linear-gradient(90deg, rgba(244,205,106,0.55) 0 1px, transparent 1px 13px)', WebkitMaskImage: 'linear-gradient(to bottom, black, transparent)', maskImage: 'linear-gradient(to bottom, black, transparent)' }} />
      <div className="relative z-[1] mb-6 text-center sm:mb-10">
        <div className="font-display text-xs font-semibold uppercase tracking-[0.35em] text-fg-subtle">{title} · Final Result</div>
        <div className="mt-1 font-cer text-3xl font-black uppercase tracking-[0.16em] sm:text-5xl"
          style={{ backgroundImage: 'linear-gradient(180deg,#fff,#efdca6 55%,#f4cd6a)', WebkitBackgroundClip: 'text', backgroundClip: 'text', color: 'transparent' }}>Champions</div>
      </div>
      <div className="relative z-[1] flex items-end justify-center gap-4 sm:gap-10">
        <DuelPodiumSpot name={loserName} score={loserScore} first={false} />
        <DuelPodiumSpot name={winnerName} score={winnerScore} first />
      </div>
    </div>
  )
}

function DuelPodiumSpot({ name, score, first }: { name: string; score: number; first: boolean }) {
  const t = first
    ? { c1: '#f7d774', c2: '#b8862f', h: 'h-40 sm:h-56', label: 'Champion', frame: 'h-24 w-24 sm:h-32 sm:w-32', w: 'w-32 sm:w-44', bd: '.32s', wd: '.7s' }
    : { c1: '#dbe0e8', c2: '#9aa2af', h: 'h-24 sm:h-32', label: 'Runner-up', frame: 'h-20 w-20 sm:h-24 sm:w-24', w: 'w-28 sm:w-36', bd: '.05s', wd: '.35s' }
  return (
    <div className={`flex ${t.w} flex-col items-center`}>
      <div className="pp-rise flex flex-col items-center" style={{ animationDelay: t.wd }}>
        {first && <div className="pp-pop mb-1" style={{ animationDelay: '1.05s' }}><Trophy lit /></div>}
        <div className={`mb-3 rounded-full p-[3px] ${first ? 'pp-champ-ring' : ''}`} style={{ background: `linear-gradient(150deg, ${t.c1}, ${t.c2})` }}>
          <div className={`grid ${t.frame} place-items-center overflow-hidden rounded-full bg-[#0b0e14]`}>
            <Flag name={name} className="h-3/5 w-4/5 rounded-[1px] object-contain" />
          </div>
        </div>
        <div className={`mb-1 max-w-full truncate text-center font-bold ${first ? 'font-cer text-lg sm:text-2xl' : 'font-display text-base text-fg sm:text-xl'}`}
          style={first ? { color: '#f4cd6a' } : undefined}>{name}</div>
        <div className="mb-3 text-[10px] font-bold uppercase tracking-[0.22em]" style={{ color: t.c1 }}>{t.label}</div>
      </div>
      <div className={`pp-grow relative w-full ${t.h} rounded-t-xl border-t-4`}
        style={{ borderColor: t.c1, background: 'linear-gradient(180deg,#1a1e28,#0a0c11)', boxShadow: `0 0 40px -12px ${t.c1}88`, animationDelay: t.bd }}>
        <div className="absolute inset-x-0 top-2 text-center font-cer text-6xl font-black opacity-90 sm:text-8xl" style={{ color: t.c1 }}>{score}</div>
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
  const allRounds = bracketSeeded(b, koEv.id) ? bracketRounds(b, koEv.id) : []
  // a round is "reached" once at least one of its matches has a team in it —
  // an all-TBD Final/Third place (waiting on semis) has nothing to show yet.
  const reached = allRounds.filter(r => r.matches.some(m => m.team_a_id != null || m.team_b_id != null))
  const finalR = reached.find(r => r.round === 'Final')
  const thirdR = reached.find(r => r.round === 'Third place')
  const restR = reached.filter(r => r !== finalR && r !== thirdR).reverse()
  const rounds = [finalR, thirdR, ...restR].filter(Boolean) as typeof allRounds

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
                  {r.matches.map(m => {
                    const decided = m.status === 'finished'
                    const live = m.status === 'live'
                    const aWin = decided && m.winner_id === m.team_a_id
                    const bWin = decided && m.winner_id === m.team_b_id
                    const nameCls = (win: boolean) => win ? 'font-bold text-gold' : 'text-fg-muted'
                    const scoreCls = (win: boolean) => win ? 'text-gold' : 'text-fg-subtle'
                    return (
                    <li key={m.id}>
                      <Link to={`/c/${code}/match/${m.id}`}
                        className={`grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-2 rounded-lg px-1 py-1.5 active:bg-surface-2 ${live ? 'bg-brand/[0.06]' : ''}`}>
                        <span className={`flex min-w-0 items-center justify-end gap-1.5 truncate text-sm ${nameCls(aWin)}`}>
                          <span className="truncate">{teamName(b, m.team_a_id)}</span>
                          <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                          {(decided || live) && <span className={`tabular inline-block min-w-[1.4rem] pl-1 text-right font-display font-bold ${live ? 'text-brand-ink' : scoreCls(aWin)}`}>{m.score_a}</span>}
                        </span>
                        <span className="flex justify-center">
                          {live
                            ? <Pill tone="live"><span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />live</Pill>
                            : decided ? null
                            : m.team_b_id == null && m.team_a_id != null ? <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">bye</span>
                            : m.team_a_id != null && m.team_b_id != null ? <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">vs</span>
                            : null}
                        </span>
                        <span className={`flex min-w-0 items-center gap-1.5 truncate text-sm ${nameCls(bWin)}`}>
                          {(decided || live) && <span className={`tabular inline-block min-w-[1.4rem] pr-1 text-left font-display font-bold ${live ? 'text-brand-ink' : scoreCls(bWin)}`}>{m.score_b}</span>}
                          <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                          <span className="truncate">{teamName(b, m.team_b_id)}</span>
                        </span>
                      </Link>
                    </li>
                    )
                  })}
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
            koEv.tiebreak === 'diff'
              ? <GroupCardPro key={g} b={b} code={code} g={g} rows={tables[g]} advance={advance}
                  matches={b.matches
                    .filter(m => m.event_id === koEv.id && !isKoMatch(m) && poolOf(m.team_a_id) === g)
                    .sort((x, y) => x.sequence - y.sequence)} />
              : <GroupCard key={g} b={b} code={code} g={g} rows={tables[g]} advance={advance}
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
        <div className="text-sm">
          {rows.map((r: any, i: number) => (
            <div key={r.team.id} className={`flex items-center gap-2 py-0.5 ${i < advance ? 'font-semibold text-fg' : 'text-fg-subtle'}`}>
              <span className="w-3.5 shrink-0 tabular">{i + 1}</span>
              <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
              <span className="min-w-0 flex-1 truncate">{r.team.name}</span>
              <span className="shrink-0 tabular font-bold">{r.won}</span>
            </div>
          ))}
        </div>
      </button>
      {open && (
        <div className="border-t border-line">
          {matches.length ? matches.map(m => {
            const decided = m.status === 'finished'
            const live = m.status === 'live'
            const aWin = decided && m.winner_id === m.team_a_id
            const bWin = decided && m.winner_id === m.team_b_id
            const nameCls = (win: boolean) => win ? 'font-bold text-gold' : 'text-fg-muted'
            const scoreCls = (win: boolean) => win ? 'text-gold' : 'text-fg-subtle'
            return (
              <Link key={m.id} to={`/c/${code}/match/${m.id}`}
                className={`grid grid-cols-[minmax(0,1fr)_3.5rem_minmax(0,1fr)] items-center gap-2 border-b border-line/60 px-3 py-2 text-xs last:border-0 active:bg-surface-2 ${live ? 'bg-brand/[0.06]' : ''}`}>
                <span className={`flex min-w-0 items-center justify-end gap-1 truncate ${nameCls(aWin)}`}>
                  <span className="truncate">{teamName(b, m.team_a_id)}</span>
                  <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                  {(decided || live) && <span className={`tabular inline-block min-w-[1.1rem] pl-0.5 text-right font-bold ${live ? 'text-brand-ink' : scoreCls(aWin)}`}>{m.score_a}</span>}
                </span>
                <span className="flex justify-center">
                  {live
                    ? <Pill tone="live"><span className="mr-1 inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-current align-middle" />live</Pill>
                    : decided ? null
                    : m.team_a_id != null && m.team_b_id != null ? <span className="text-[10px] font-bold uppercase tracking-widest text-fg-subtle">vs</span>
                    : null}
                </span>
                <span className={`flex min-w-0 items-center gap-1 truncate ${nameCls(bWin)}`}>
                  {(decided || live) && <span className={`tabular inline-block min-w-[1.1rem] pr-0.5 text-left font-bold ${live ? 'text-brand-ink' : scoreCls(bWin)}`}>{m.score_b}</span>}
                  <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
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
    <div className="hidden grid-cols-[3rem_minmax(0,1fr)_7rem_minmax(0,1fr)] items-center gap-3 px-4 pb-1 text-[10px] font-bold uppercase tracking-widest text-fg-subtle sm:grid">
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
        <div className="hidden grid-cols-[3rem_minmax(0,1fr)_7rem_minmax(0,1fr)] items-center gap-3 sm:grid">
          <div className="text-center font-display text-base font-bold text-fg-subtle">{court}</div>
          <div className="flex min-w-0 items-center gap-2">
            <Emblem logo={teamLogo(b, m.team_a_id)} flagName={teamSideName(b, m.team_a_id)} className={flag} />
            <span className={`truncate text-sm ${nameCls(aWin)}`}>{teamName(b, m.team_a_id)}</span>
            {(finished || live) && <span className={`ml-auto pl-2 tabular font-display text-lg font-bold ${live ? 'text-brand-ink' : scoreCls(aWin)}`}>{m.score_a}</span>}
          </div>
          <div className="flex justify-center">{statusPill(m)}</div>
          <div className="flex min-w-0 items-center justify-end gap-2">
            {(finished || live) && <span className={`mr-auto pr-2 tabular font-display text-lg font-bold ${live ? 'text-brand-ink' : scoreCls(bWin)}`}>{m.score_b}</span>}
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
              {(finished || live) && <span className={`ml-auto tabular font-bold ${live ? 'text-brand-ink' : scoreCls(aWin)}`}>{m.score_a}</span>}
            </div>
            <div className="flex items-center gap-2">
              <Emblem logo={teamLogo(b, m.team_b_id)} flagName={teamSideName(b, m.team_b_id)} className={flag} />
              <span className={`truncate text-sm ${nameCls(bWin)}`}>{teamName(b, m.team_b_id)}</span>
              {(finished || live) && <span className={`ml-auto tabular font-bold ${live ? 'text-brand-ink' : scoreCls(bWin)}`}>{m.score_b}</span>}
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
