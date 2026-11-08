/** The one public page of a multi-category church event (YC2626).
 *  Tabs: Live · Matches · Standings · Bracket · Medals, each covering every
 *  category; a category chip narrows any tab to one category (and then that
 *  category updates live, point by point). Scoring stays per category code
 *  behind the scenes; referees start from the Referee button. */
import { SportIcon } from '../components/SportIcon'
import { useState, type ReactNode } from 'react'
import { Link, useSearchParams } from 'react-router-dom'
import type { Bundle } from '../lib/types'
import type { Hub, HubCat } from '../lib/hub'
import { useCompetition, groupStandings, groupStageComplete } from '../lib/store'
import { FullscreenButton, ThemeToggle, Spinner } from '../components/ui'
import { useOthers, LiveNext, MedalTable } from '../components/HubOverview'
import { CbLive, CbMatches, CbStandings } from '../components/CaptainBall'
import FlowChart from '../components/FlowChart'
import { flowOf } from '../lib/flow'
import { LiveGrid, Matches, Standings, PosterBracket } from './Board'

type HubTab = 'live' | 'matches' | 'standings' | 'bracket' | 'medals'
const TABS: Array<{ id: HubTab; label: string }> = [
  { id: 'live', label: 'Live' }, { id: 'matches', label: 'Matches' }, { id: 'standings', label: 'Standings' },
  { id: 'bracket', label: 'Bracket' }, { id: 'medals', label: 'Medals' },
]

export default function HubBoard({ hub, self }: { hub: Hub; self: Bundle }) {
  const [params, setParams] = useSearchParams()
  const tab = (TABS.find(t => t.id === params.get('t'))?.id ?? 'live') as HubTab
  const cat = hub.cats.find(c => c.code === (params.get('cat') ?? '').toUpperCase()) ?? null
  const set = (k: string, v: string | null) => {
    const next = new URLSearchParams(params)
    if (v) next.set(k, v); else next.delete(k)
    setParams(next, { replace: true })
  }
  const others = useOthers(hub.cats.map(c => c.code).filter(c => c !== hub.code), 10000)
  const bundleOf = (code: string) => (code === hub.code ? self : others[code] ?? null)

  return (
    <div className="min-h-screen bg-canvas text-fg">
      <div className="border-b border-line px-4 pb-2 pt-3 lg:px-6" style={{ paddingTop: 'max(var(--pp-top), 0.75rem)' }}>
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-3">
          <div className="flex min-w-0 items-center gap-2">
            <Link to="/" className="flex h-8 shrink-0 items-center rounded-lg border border-line px-2.5 text-sm text-fg-muted">←</Link>
            <div className="min-w-0">
              <div className="line-clamp-2 font-display text-xl font-bold leading-tight tracking-wide sm:text-2xl lg:text-3xl">{hub.title}</div>
              <div className="text-xs text-fg-muted">code <span className="font-bold text-brand-ink">{hub.code}</span></div>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-1.5">
            <Link to={`/c/${hub.code}/referee`} className="flex h-8 items-center rounded-lg border border-line px-3 text-xs text-fg-muted lg:h-10 lg:text-sm">Referee</Link>
            <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-line p-1.5 text-fg-muted lg:h-10 lg:w-10" />
            <ThemeToggle />
          </div>
        </div>
        {/* tabs */}
        <div className="mx-auto mt-3 flex max-w-6xl gap-1 overflow-x-auto">
          {TABS.map(t => (
            <button key={t.id} onClick={() => set('t', t.id === 'live' ? null : t.id)}
              className={`shrink-0 rounded-lg px-2.5 py-2 text-xs font-semibold uppercase tracking-wide sm:px-3 lg:px-4 lg:text-sm ${tab === t.id ? 'bg-brand text-brand-fg' : 'text-fg-muted'}`}>
              {t.label}
            </button>
          ))}
        </div>
        {/* category filter (not on Medals: medals are always the whole event) */}
        {tab !== 'medals' && (
          <div className="mx-auto mt-2 flex max-w-6xl gap-1.5 overflow-x-auto pb-1">
            <Chip on={!cat} onClick={() => set('cat', null)}>All</Chip>
            {hub.cats.map(c => (
              <Chip key={c.code} on={cat?.code === c.code} onClick={() => set('cat', c.code)}><SportIcon sport={c.sport} /> {c.short}</Chip>
            ))}
          </div>
        )}
      </div>

      <div className="mx-auto max-w-6xl pb-10">
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
  )
}

const Chip = ({ on, onClick, children }: { on: boolean; onClick: () => void; children: ReactNode }) => (
  <button onClick={onClick}
    className={`shrink-0 whitespace-nowrap rounded-full border px-3 py-1.5 text-xs font-semibold ${on ? 'border-fg bg-fg text-canvas' : 'border-line text-fg-muted'}`}>
    {children}
  </button>
)

/** One category's block. When it is the only one shown it reads its code
 *  live (point by point); in the "All" lists it uses the 10 s copy. */
function CatView({ cat, hub, self, polled, single, onOpen, children }: {
  cat: HubCat; hub: Hub; self: Bundle; polled: Bundle | null; single: boolean; onOpen: () => void
  children: (b: Bundle) => ReactNode
}) {
  const own = cat.code === hub.code
  const body = own ? children(self)
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
  if (tab === 'live') return cb ? <CbLive b={b} code={code} /> : <LiveGrid b={b} code={code} tv={false} />
  if (tab === 'matches') return cb ? <div className="p-3 lg:p-5"><CbMatches b={b} /></div> : <Matches b={b} code={code} />
  if (tab === 'standings') return cb ? <div className="mx-auto max-w-2xl p-3 lg:p-5"><CbStandings b={b} ev={cb} /></div> : <Standings b={b} />
  const flow = flowOf(b, { groupStandings, groupStageComplete })
  return flow ? <FlowChart b={b} flow={flow} /> : <PosterBracket b={b} />
}
