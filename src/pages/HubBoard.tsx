/** The one public page of a multi-category church event (YC2626).
 *  Tabs: Live · Matches · Standings · Bracket · Medals, each covering every
 *  category; a category chip narrows any tab to one category (and then that
 *  category updates live, point by point). Scoring stays per category code
 *  behind the scenes; referees start from the Referee button. */
import { SportIcon } from '../components/SportIcon'
import { useMemo, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Bundle } from '../lib/types'
import { hubTitle, catHue, type Hub, type HubCat } from '../lib/hub'
import { useCompetition, groupStandings, groupStageComplete, bracketRounds, bracketSeeded } from '../lib/store'
import { FullscreenButton, ThemeToggle, Spinner, EventLogo } from '../components/ui'
import MapButton from '../components/CourtMap'
import { useOthers, LiveNext, MedalTable } from '../components/HubOverview'
import { CbLive, CbMatches, CbStandings } from '../components/CaptainBall'
import FlowChart from '../components/FlowChart'
import { flowOf } from '../lib/flow'
import { LiveGrid, Matches, Standings, PosterBracket, FlowBracket } from './Board'
import MyTeamBar, { resolvePin } from '../components/MyTeam'
import { HubGames, HubStandings } from '../components/HubViews'
import { PinCtx, usePins } from '../lib/pin'
import Announcements from '../components/Announcements'
import BounceTitle from '../components/BounceTitle'
import SportsTitle from '../components/SportsTitle'

type HubTab = 'live' | 'matches' | 'standings' | 'bracket' | 'medals'
const TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'live', label: 'Live' }, { id: 'matches', label: 'Matches' }, { id: 'standings', label: 'Standings' },
  { id: 'bracket', label: 'Bracket' }, { id: 'medals', label: 'Medals' },
]

export default function HubBoard({ hub, self }: { hub: Hub; self: Bundle | null }) {
  const [params, setParams] = useSearchParams()
  const tabs = hub.noChurch ? TABS.filter(t => t.id !== 'medals') : TABS
  const tab = (tabs.find(t => t.id === params.get('t'))?.id ?? 'live') as HubTab
  const { pins } = usePins(hub.code)
  // default filter = the category of the followed team(s); "All" only when chosen (?cat=all)
  // or when the followed teams are in different categories
  const pinCats = [...new Set(pins.map(p => p.code.toUpperCase()))].filter(c => hub.cats.some(x => x.code === c))
  const rawCat = params.get('cat')
  const cat = rawCat == null
    ? (pinCats.length === 1 ? hub.cats.find(c => c.code === pinCats[0]) ?? null : null)
    : hub.cats.find(c => c.code === rawCat.toUpperCase()) ?? null
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  const others = useOthers(hub.cats.map(c => c.code).filter(c => c !== hub.code), 5000)
  const bundleOf = (code: string) => (code === hub.code ? self : others[code] ?? null)
  const pinned = useMemo(() => new Set(pins.map(p => resolvePin(bundleOf(p.code), p)).filter((x): x is string => !!x)),
    [pins, others, self])

  return (
    <PinCtx.Provider value={pinned}>
    <div className="min-h-screen bg-canvas text-fg">
      <div className="sticky top-0 z-40 border-b border-line bg-canvas px-4 pb-2 pt-3 lg:px-6" style={{ paddingTop: 'max(var(--pp-top), 0.75rem)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/" className="flex h-8 shrink-0 items-center rounded-lg border border-line px-2.5 text-sm text-fg-muted">←</Link>
            {hub.logo && !hub.logoRight && <EventLogo src={hub.logo} className="h-12 w-12 lg:h-14 lg:w-14" />}
            <div className="min-w-0">
              {(() => {
                const title = hubTitle(hub, hub.cats.map(c => bundleOf(c.code)?.competition.name))
                const cls = 'font-display text-xl font-bold leading-tight tracking-wide sm:text-2xl lg:text-3xl'
                const sports = [...new Set(hub.cats.map(c => c.sport))]
                return sports.length > 1
                  ? <SportsTitle text={title} className={cls} sports={sports} />
                  : sports[0] === 'pickleball' ? <BounceTitle text={title} className={cls} /> : <div className={`line-clamp-2 ${cls}`}>{title}</div>
              })()}
            </div>
            {hub.logo && hub.logoRight && <EventLogo src={hub.logo} className="h-12 w-12 lg:h-14 lg:w-14" />}
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            {/* phone: Map above Referee, so the event name keeps its room; full screen is for big screens */}
            <div className="flex flex-col items-stretch gap-1 sm:flex-row sm:items-center sm:gap-1.5">
              {hub.map && <MapButton src={hub.map} className="justify-center lg:h-10 lg:text-sm" />}
              <Link to={`/c/${hub.code}/referee`} className="flex h-8 items-center justify-center rounded-lg border border-line px-3 text-xs text-fg-muted lg:h-10 lg:text-sm">Referee</Link>
            </div>
            <FullscreenButton className="hidden h-8 w-8 place-items-center rounded-lg border border-line p-1.5 text-fg-muted sm:grid lg:h-10 lg:w-10" />
            <ThemeToggle />
          </div>
        </div>
        {/* tabs */}
        <div className="mx-auto mt-3 grid max-w-6xl gap-1 sm:flex" style={{ gridTemplateColumns: `repeat(${tabs.length}, minmax(0, 1fr))` }}>
          {tabs.map(t => (
            <button key={t.id} onClick={() => set('t', t.id === 'live' ? null : t.id)}
              className={`min-h-[38px] whitespace-nowrap rounded-lg px-0.5 py-2 font-display text-[15px] font-bold uppercase tracking-wide sm:shrink-0 sm:px-3 sm:text-base lg:px-4 lg:text-lg ${tab === t.id ? 'bg-brand text-brand-fg' : 'bg-surface text-fg-muted sm:bg-transparent'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {/* category filter (not on Medals: medals are always the whole event) */}
        {tab !== 'medals' && (
          <div className="mx-auto mt-2 flex max-w-6xl flex-wrap gap-1.5 pb-1">
            <Chip on={!cat} onClick={() => set('cat', 'all')}>All</Chip>
            {hub.cats.map(c => {
              // MC26 (all pickleball): no ball icon, Men's = blue, Mixed = pink
              const hue = hub.noChurch ? catHue(c.code) : null
              return (
                <Chip key={c.code} on={cat?.code === c.code} onClick={() => set('cat', c.code)} hue={hue}>
                  {hue == null && <SportIcon sport={c.sport} />} {c.short}
                </Chip>
              )
            })}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-6xl pb-10">
        {tab !== 'medals' && <Announcements hub={hub} bundleOf={bundleOf} />}
        {tab !== 'medals' && <MyTeamBar hub={hub} bundleOf={bundleOf} compact={tab !== 'live'} onOpen={c => set('cat', c)} />}
        {tab === 'medals' && <div className="px-4 py-5"><MedalTable hub={hub} bundleOf={bundleOf} /></div>}
        {tab === 'live' && !cat && (
          <div className="px-4 py-5"><LiveNext hub={hub} bundleOf={bundleOf} onOpen={c => set('cat', c)} /></div>
        )}
        {tab !== 'medals' && (tab !== 'live' || cat) && (
          (cat ? [cat] : hub.cats).map(c => (
            <CatView key={c.code} cat={c} hub={hub} self={self} polled={bundleOf(c.code)} single={!!cat}
              onOpen={() => set('cat', c.code)}>
              {b => <Section tab={tab} b={b} code={c.code} />}
            </CatView>
          ))
        )}
      </div>
    </div>
    </PinCtx.Provider>
  )
}

const HUE_CHIP = [
  { on: 'border-sky-400 bg-sky-500 text-white', off: 'border-sky-500/60 bg-sky-500/15 text-sky-300' },
  { on: 'border-pink-400 bg-pink-500 text-white', off: 'border-pink-500/60 bg-pink-500/15 text-pink-300' },
]
const Chip = ({ on, onClick, children, hue = null }: { on: boolean; onClick: () => void; children: ReactNode; hue?: 0 | 1 | null }) => (
  <button onClick={onClick}
    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${hue != null ? HUE_CHIP[hue][on ? 'on' : 'off'] : on ? 'border-fg bg-fg text-canvas' : 'border-line text-fg-muted'}`}>
    {children}
  </button>
)

/** One category's block. When it is the only one shown it reads its code
 *  live (point by point); in the "All" lists it uses the 10 s copy. */
function CatView({ cat, hub, self, polled, single, onOpen, children }: {
  cat: HubCat; hub: Hub; self: Bundle | null; polled: Bundle | null; single: boolean; onOpen: () => void
  children: (b: Bundle) => ReactNode
}) {
  const own = cat.code === hub.code
  const body = own && self ? children(self)
    : single ? <LiveCat code={cat.code} render={children} />
    : polled ? children(polled)
    : <div className="px-4 py-3 text-sm text-fg-muted">Loading…</div>
  return (
    <section className="border-b border-line/60">
      {!single && (
        <button onClick={onOpen} className="flex w-full items-center gap-2 px-4 pb-1 pt-5 text-left">
          <span className="text-xl"><SportIcon sport={cat.sport} /></span>
          <span className="flex-1 font-display text-xl font-bold uppercase tracking-wide">{cat.label}</span>
          <span className="text-xs text-fg-subtle">only this ›</span>
        </button>
      )}
      {body}
    </section>
  )
}

function LiveCat({ code, render }: { code: string; render: (b: Bundle) => ReactNode }) {
  const { bundle, loading } = useCompetition(code, { viewer: true })
  if (loading && !bundle) return <div className="p-6"><Spinner /></div>
  if (!bundle) return <div className="px-4 py-3 text-sm text-fg-muted">Not available.</div>
  return <>{render(bundle)}</>
}

/** The tab's content for one category, using the screens the category code already has. */
function Section({ tab, b, code }: { tab: HubTab; b: Bundle; code: string }) {
  const cb = b.events.find(e => e.sport === 'captainball')
  if (tab === 'live') return cb ? <CbLive b={b} code={code} /> : <LiveGrid b={b} code={code} tv={false} noLink />
  const ko = b.events.find(e => e.format === 'groups_ko')
  if (tab === 'matches') return cb ? <div className="p-3 lg:p-5"><CbMatches b={b} /></div> : ko ? <HubGames b={b} code={code} /> : <Matches b={b} code={code} />
  if (tab === 'standings') return cb ? <div className="mx-auto max-w-2xl p-3 lg:p-5"><CbStandings b={b} ev={cb} /></div> : <HubStandings b={b} ev={ko} fallback={<Standings b={b} />} />
  const flow = flowOf(b, { groupStandings, groupStageComplete })
  // printed knockout (bracket_preview): the corners-to-trophy poster bracket; the flow chart only for the 6-team formats
  // one round-robin group straight into Final + 3rd place (4 teams): once drawn, the same bracket as the other categories
  const rrFinal = !!ko && !cb && bracketSeeded(b, ko.id) && bracketRounds(b, ko.id).every(r => r.round === 'Final' || r.round === 'Third place')
  return flow && !ko?.bracket_preview && !rrFinal ? (cb ? <FlowBracket b={b} flow={flow} /> : <FlowChart b={b} flow={flow} />) : <PosterBracket b={b} />
}
