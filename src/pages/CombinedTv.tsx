/** One TV for two sister categories (e.g. /tv/MCMD+MCXD): each code keeps its
 *  own scoring, courts and PINs; this screen only reads both and shows them
 *  together. Panes: Live courts, Group tables, Bracket - each a toggle; the TV rotates through the ones switched on (one on = stays on it).
 *  Separate route on purpose — the single-code board and YC2626's
 *  multi-sport TV are untouched. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import FillGrid from '../components/FillGrid'
import { useAutoHide } from '../lib/useAutoHide'
import { Link, useParams, useSearchParams } from 'react-router-dom'
import { useCompetition, groupStandings, teamName, teamLogo, teamSideName, liveOnCourt } from '../lib/store'
import type { Bundle } from '../lib/types'
import { FullscreenButton, Spinner, Screen, Emblem } from '../components/ui'
import { GroupTable, PlayClock } from '../components/GroupsKo'
import { LiveGrid, PosterBracket, Podium, koPodium } from './Board'
import { upNext } from '../lib/pool'

type Pane = 'live' | 'groups' | 'bracket'
const PANES: Pane[] = ['live', 'groups', 'bracket']
/** the rotation for the panes switched on: all three keeps the live courts twice per cycle */
const rotation = (on: Pane[]): Pane[] =>
  on.length === 3 ? ['live', 'groups', 'live', 'bracket'] : PANES.filter(p => on.includes(p))
const AUTO_MS = 20000

// one colour per category, used for its banner strip
const TONES = [
  { text: 'text-[#5aa9ff]', bar: 'bg-[#5aa9ff]', soft: 'bg-[#5aa9ff]/10' },
  { text: 'text-[#f472b6]', bar: 'bg-[#f472b6]', soft: 'bg-[#f472b6]/10' },
]

export default function CombinedTv() {
  const { codes = '' } = useParams()
  const list = codes.split(/[+,\s]+/).filter(Boolean).slice(0, 2)
  const one = useCompetition(list[0], { preview: true })
  const two = useCompetition(list[1], { preview: true })
  const paneKey = `pp.tvpanes.${list.join('+').toUpperCase()}`
  const [on, setOn] = useState<Pane[]>(() => {
    try {
      const v = (localStorage.getItem(paneKey) ?? '').split(',').filter((x): x is Pane => (PANES as string[]).includes(x))
      if (v.length) return v
    } catch { /* private mode */ }
    return PANES
  })
  const togglePane = (p: Pane) => {
    // press to switch a pane on, press again to switch it off; the last one stays on
    const next = on.includes(p) ? (on.length > 1 ? on.filter(x => x !== p) : on) : PANES.filter(x => x === p || on.includes(x))
    setOn(next); setStep(0)
    try { localStorage.setItem(paneKey, next.join(',')) } catch { /* private mode */ }
  }
  const { shown: ctl, guard } = useAutoHide(true, 5000)
  const seq = rotation(on)
  // which category the TV shows: both (default) or one code — URL ?c= wins, then this device's last pick
  const [params, setParams] = useSearchParams()
  const catKey = `pp.tvcat.${list.join('+').toUpperCase()}`
  const [sel, setSel] = useState<string>(() => {
    const c = (params.get('c') ?? (() => { try { return localStorage.getItem(catKey) } catch { return null } })() ?? '').toUpperCase()
    return list.some(x => x.toUpperCase() === c) ? c : 'both'
  })
  const pickCat = (c: string) => {
    setSel(c)
    try { localStorage.setItem(catKey, c) } catch { /* private mode */ }
    const next = new URLSearchParams(params); next.set('c', c.toLowerCase()); setParams(next, { replace: true })
  }
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (seq.length < 2) return
    const id = setInterval(() => setStep(s => (s + 1) % seq.length), AUTO_MS)
    return () => clearInterval(id)
  }, [seq.join(',')])

  if (one.loading || (list[1] && two.loading)) return <Screen><Spinner /></Screen>
  const all = [one.bundle, two.bundle].filter((b): b is Bundle => !!b)
  const bundles = sel === 'both' ? all : all.filter(b => b.competition.code.toUpperCase() === sel)
  const toneOf = (b: Bundle) => TONES[Math.max(0, all.indexOf(b)) % 2]
  if (!all.length) {
    return (
      <Screen className="flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-center text-fg-muted">No competition found for <span className="font-bold text-fg">{codes}</span></div>
        <Link to="/" className="rounded-xl border border-line px-4 py-2 text-sm">Lobby</Link>
      </Screen>
    )
  }

  const shown: Pane = seq[step % seq.length]
  // the ceremony replaces a category's bracket once its Final AND 3rd place are in
  const decided = bundles.map(b => koPodium(b))
  const podiumReady = (i: number) => !!decided[i]?.third
  const title = sharedTitle(bundles)
  const single = bundles.length === 1

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-canvas text-fg"
      style={{
        paddingTop: 'max(var(--pp-top), 1rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
        paddingLeft: 'max(env(safe-area-inset-left), 1rem)',
        paddingRight: 'max(env(safe-area-inset-right), 1rem)',
      }}>
      {/* controls: hidden until the screen is touched, same look as the multi-sport TV */}
      <div className={`absolute right-4 z-10 flex items-center gap-2 transition-opacity duration-500 ${ctl ? 'opacity-100' : 'opacity-0'}`}
        style={{ top: 'calc(var(--pp-top) + 0.75rem)' }} {...guard}>
        {all.length > 1 && (
          <div className="flex gap-1 rounded-xl border border-line bg-surface p-1">
            {[...all.map(b => b.competition.code.toUpperCase()), 'both'].map(c => {
              const b = all.find(x => x.competition.code.toUpperCase() === c)
              const on = sel === c
              const tone = b ? toneOf(b) : null
              return (
                <button key={c} onClick={() => pickCat(c)}
                  className={`flex min-h-[40px] touch-manipulation items-center gap-2 whitespace-nowrap rounded-lg px-3.5 py-2 font-display text-sm font-bold uppercase tracking-wider ${
                    on ? (tone ? `${tone.bar} text-[#0a0e17]` : 'bg-fg text-canvas') : (tone ? `${tone.text} ${tone.soft} active:bg-surface-2` : 'text-fg-muted active:bg-surface-2')}`}>
                  {tone && !on && <span className={`h-3 w-1.5 rounded-full ${tone.bar}`} />}
                  {b ? category(b) : 'Both'}
                </button>
              )
            })}
          </div>
        )}
        <div className="flex rounded-lg border border-line bg-surface/70 p-0.5">
          {PANES.map(p => (
            <button key={p} onClick={() => togglePane(p)} aria-pressed={on.includes(p)}
              className={`min-h-[40px] touch-manipulation whitespace-nowrap rounded-md px-3.5 py-2 text-sm font-semibold capitalize ${on.includes(p) ? 'bg-fg text-canvas' : 'text-fg-muted'}`}>
              {p}
            </button>
          ))}
        </div>
        <Link to={`/c/${bundles[0].competition.code}`}
          className="flex min-h-[44px] touch-manipulation items-center whitespace-nowrap rounded-lg border border-line bg-surface/70 px-4 text-sm font-semibold text-fg-muted">exit TV</Link>
        <FullscreenButton className="grid h-11 w-11 shrink-0 place-items-center rounded-lg border border-line bg-surface/70 p-2.5 text-fg-muted" />
      </div>

      {shown !== 'live' && (
        <div className="shrink-0 pb-2 text-center">
          <div className="line-clamp-1 font-display text-2xl font-bold tracking-wide sm:text-3xl lg:text-4xl">{title}</div>
          <div className="mt-0.5 text-[11px] uppercase tracking-[0.3em] text-fg-subtle">
            {shown === 'groups' ? 'Group tables' : 'Knockout'}
          </div>
        </div>
      )}

      {shown === 'live' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {bundles.map((b, i) => (
            <LiveRow key={b.competition.id} b={b} tone={toneOf(b)} title={i === 0 ? title : undefined} />
          ))}
        </div>
      )}

      {shown === 'groups' && (
        <div className="relative min-h-0 flex-1">
          {single
            ? <Fit><div className="flex w-[1840px] flex-col"><GroupsBlock b={bundles[0]} tone={toneOf(bundles[0])} fill /></div></Fit>
            : (
              <Fit>
                <div className="flex w-[1840px] flex-col gap-5">
                  {bundles.map(b => <GroupsBlock key={b.competition.id} b={b} tone={toneOf(b)} />)}
                </div>
              </Fit>
            )}
        </div>
      )}

      {shown === 'bracket' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {bundles.map((b, i) => (
            <div key={b.competition.id} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Banner b={b} tone={toneOf(b)} />
              <div className="relative min-h-0 flex-1">
                {podiumReady(i)
                  ? <Fit><div className="flex h-[640px] w-[1200px] flex-col"><Podium b={b} champion={decided[i]!.champion} runnerUp={decided[i]!.runnerUp} third={decided[i]!.third} title={category(b)} /></div></Fit>
                  : <Fit fill={single}><PosterBracket b={b} broadcast tall={single} /></Fit>}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

// ------------------------------------------------------------------ pieces
function category(b: Bundle): string {
  return b.events.find(e => e.format === 'groups_ko')?.name || b.competition.name
}

/** "MC Open · Men's Doubles" + "MC Open · Mixed Doubles" -> "MC Open". */
function sharedTitle(bs: Bundle[]): string {
  const names = bs.map(b => b.competition.name)
  if (names.length < 2) return names[0] ?? ''
  const a = names[0].split(/\s+/), z = names[1].split(/\s+/)
  const common: string[] = []
  for (let i = 0; i < Math.min(a.length, z.length) && a[i] === z[i]; i++) common.push(a[i])
  const t = common.join(' ').replace(/[\s·\-–—|:]+$/, '')
  return t.length >= 3 ? t : names.join(' | ')
}

function stageLine(b: Bundle): string {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return ''
  const group = b.matches.filter(m => m.event_id === ev.id && m.bracket_key == null)
  const done = group.filter(m => m.status === 'finished').length
  if (done < group.length) return `Group stage · ${done}/${group.length} played`
  const live = b.matches.find(m => m.event_id === ev.id && m.bracket_key != null && (m.status === 'live' || m.status === 'awaiting_confirm'))
  if (live) return live.round ?? 'Knockout'
  return koPodium(b) ? 'Champions decided' : 'Knockout'
}

/** "MC Open · Men's Doubles" above a "Men's Doubles" banner -> just "MC Open". */
function stripCat(title: string, cat: string): string {
  const t = title.trim(), c = cat.trim()
  if (!c || !t.toLowerCase().endsWith(c.toLowerCase())) return t
  const head = t.slice(0, t.length - c.length).replace(/[\s·\-–—|:]+$/, '')
  return head.length >= 3 ? head : t
}

function Banner({ b, tone, big = false }: { b: Bundle; tone: typeof TONES[number]; big?: boolean }) {
  return (
    <div className={`flex shrink-0 items-center justify-between gap-3 rounded-xl ${big ? 'mb-3 px-5 py-3' : 'mb-2 px-3 py-1.5'} ${tone.soft}`}>
      <span className="flex min-w-0 items-center gap-3">
        <span className={`${big ? 'h-9 w-2' : 'h-5 w-1.5'} shrink-0 rounded-full ${tone.bar}`} />
        <span className={`truncate whitespace-nowrap font-display font-bold uppercase tracking-widest ${big ? 'text-4xl' : 'text-xl lg:text-2xl'} ${tone.text}`}>{category(b)}</span>
        <span className={`shrink-0 whitespace-nowrap font-display font-bold tracking-widest text-fg-subtle ${big ? 'text-2xl' : 'text-sm'}`}>{b.competition.code}</span>
      </span>
      <span className={`shrink-0 whitespace-nowrap font-semibold text-fg-muted ${big ? 'text-2xl' : 'text-xs lg:text-sm'}`}>{stageLine(b)}</span>
    </div>
  )
}

function LiveRow({ b, tone, title }: { b: Bundle; tone: typeof TONES[number]; title?: string }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  const next = ev ? upNext(b, ev.id, 4) : []
  const anyLive = b.courts.some(c => liveOnCourt(b, c.id))
  return (
    <section className="relative min-h-0 flex-1">
      <Fit>
        <div className="w-[1800px]">
          {title && <div className="mb-3 text-center font-display text-5xl font-bold tracking-wide">{stripCat(title, category(b))}</div>}
          <Banner b={b} tone={tone} big />
          {anyLive || next.length
            ? <LiveGrid b={b} code={b.competition.code} tv />
            : <div className="py-24 text-center text-3xl text-fg-subtle">No game on court right now</div>}
        </div>
      </Fit>
    </section>
  )
}

function GroupsBlock({ b, tone, fill = false }: { b: Bundle; tone: typeof TONES[number]; fill?: boolean }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  const tables = groupStandings(b, ev.id)
  const advance = ev.advance_per_group ?? 1
  const live = b.matches.filter(m => m.event_id === ev.id && m.status === 'live' && m.bracket_key == null)
  return (
    <section>
      <Banner b={b} tone={tone} />
      <FillGrid className="gap-3">
        {Object.keys(tables).sort().map(g => (
          <div key={g} className="rounded-xl border border-line bg-surface p-2">
            <GroupTable b={b} g={g} rows={tables[g]} advance={advance} big huge={fill} />
          </div>
        ))}
      </FillGrid>
      {live.length > 0 && (
        <div className="mt-1.5 flex items-center gap-4 text-sm text-fg-subtle">
          {live.map(m => (
            <span key={m.id} className="flex items-center gap-1.5 whitespace-nowrap">
              <span className="h-1.5 w-1.5 animate-pulse rounded-full bg-brand" />
              {teamName(b, m.team_a_id)} {m.score_a}–{m.score_b} {teamName(b, m.team_b_id)}
              <PlayClock m={m} className="text-fg-subtle" />
            </span>
          ))}
        </div>
      )}
    </section>
  )
}

/** Scale a fixed-size block to fit the box (both directions), centred. The
 *  box is absolutely filled so its size never depends on the content. */
function Fit({ children, fill = false }: { children: ReactNode; fill?: boolean }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  const [minH, setMinH] = useState(0)
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current, i = inner.current
      if (!o || !i || !i.offsetWidth || !i.offsetHeight) return
      // fill: give the block the screen's own shape so it stretches to use the full height
      const want = fill && o.clientWidth ? Math.round(i.offsetWidth * o.clientHeight / o.clientWidth) : 0
      setMinH(want)
      const k = Math.min(o.clientWidth / i.offsetWidth, o.clientHeight / Math.max(i.offsetHeight, want)) * 0.99
      if (isFinite(k) && k > 0) setS(k)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    const t = [150, 600, 1500].map(ms => setTimeout(fit, ms))
    ;(document as any).fonts?.ready?.then(fit).catch(() => {})
    return () => { ro.disconnect(); t.forEach(clearTimeout) }
  }, [fill])
  return (
    <div ref={outer} className="absolute inset-0 overflow-hidden">
      <div ref={inner} className={`absolute left-1/2 top-1/2 w-max ${fill ? 'flex flex-col' : ''}`}
        style={{ minHeight: minH || undefined, transform: `translate(-50%, -50%) scale(${s})`, transformOrigin: 'center' }}>
        {children}
      </div>
    </div>
  )
}
