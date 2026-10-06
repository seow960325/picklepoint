/** One TV for two sister categories (e.g. /tv/MCMD+MCXD): each code keeps its
 *  own scoring, courts and PINs; this screen only reads both and shows them
 *  together. Panes: Live courts, Group tables, Bracket, or Auto (rotates).
 *  Separate route on purpose — the single-code board and YC2626's
 *  multi-sport TV are untouched. */
import { useEffect, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCompetition, groupStandings, teamName, teamLogo, teamSideName, liveOnCourt } from '../lib/store'
import type { Bundle } from '../lib/types'
import { FullscreenButton, Spinner, Screen, Emblem } from '../components/ui'
import { GroupTable, PlayClock } from '../components/GroupsKo'
import { LiveGrid, PosterBracket, Podium, koPodium } from './Board'
import { upNext } from '../lib/pool'

type Pane = 'live' | 'groups' | 'bracket' | 'auto'
const AUTO: Array<Exclude<Pane, 'auto'>> = ['live', 'groups', 'live', 'bracket']
const AUTO_MS = 20000

// one colour per category, used for its banner strip
const TONES = [
  { text: 'text-[#5aa9ff]', bar: 'bg-[#5aa9ff]', soft: 'bg-[#5aa9ff]/10' },
  { text: 'text-[#f472b6]', bar: 'bg-[#f472b6]', soft: 'bg-[#f472b6]/10' },
]

export default function CombinedTv() {
  const { codes = '' } = useParams()
  const list = codes.split(/[+,\s]+/).filter(Boolean).slice(0, 2)
  const one = useCompetition(list[0])
  const two = useCompetition(list[1])
  const [pane, setPane] = useState<Pane>('auto')
  const [step, setStep] = useState(0)
  useEffect(() => {
    if (pane !== 'auto') return
    const id = setInterval(() => setStep(s => (s + 1) % AUTO.length), AUTO_MS)
    return () => clearInterval(id)
  }, [pane])

  if (one.loading || (list[1] && two.loading)) return <Screen><Spinner /></Screen>
  const bundles = [one.bundle, two.bundle].filter((b): b is Bundle => !!b)
  if (!bundles.length) {
    return (
      <Screen className="flex flex-col items-center justify-center gap-4 px-6">
        <div className="text-center text-fg-muted">No competition found for <span className="font-bold text-fg">{codes}</span></div>
        <Link to="/" className="rounded-xl border border-line px-4 py-2 text-sm">Lobby</Link>
      </Screen>
    )
  }

  const shown: Exclude<Pane, 'auto'> = pane === 'auto' ? AUTO[step] : pane
  // the ceremony replaces a category's bracket once its Final AND 3rd place are in
  const decided = bundles.map(b => koPodium(b))
  const podiumReady = (i: number) => !!decided[i]?.third
  const title = sharedTitle(bundles)

  return (
    <div className="fixed inset-0 flex flex-col overflow-hidden bg-canvas text-fg"
      style={{
        paddingTop: 'max(env(safe-area-inset-top), 1rem)',
        paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)',
        paddingLeft: 'max(env(safe-area-inset-left), 1rem)',
        paddingRight: 'max(env(safe-area-inset-right), 1rem)',
      }}>
      {/* discreet controls */}
      <div className="absolute right-3 top-3 z-10 flex items-center gap-2 opacity-30 transition-opacity hover:opacity-100">
        <div className="flex rounded-lg border border-line bg-surface/70 p-0.5 text-xs">
          {(['live', 'groups', 'bracket', 'auto'] as const).map(p => (
            <button key={p} onClick={() => { setPane(p); setStep(0) }}
              className={`min-h-[30px] whitespace-nowrap rounded-md px-2.5 py-1.5 capitalize ${pane === p ? 'bg-fg text-canvas' : 'text-fg-muted'}`}>
              {p}
            </button>
          ))}
        </div>
        <Link to={`/c/${bundles[0].competition.code}`}
          className="flex min-h-[32px] items-center whitespace-nowrap rounded-lg border border-line bg-surface/70 px-3 text-xs text-fg-muted">exit TV</Link>
        <FullscreenButton className="grid h-8 w-8 place-items-center rounded-lg border border-line bg-surface/70 p-1.5 text-fg-muted" />
      </div>

      <div className="shrink-0 pb-2 text-center">
        <div className="line-clamp-1 font-display text-2xl font-bold tracking-wide sm:text-3xl lg:text-4xl">{title}</div>
        <div className="mt-0.5 text-[11px] uppercase tracking-[0.3em] text-fg-subtle">
          {shown === 'live' ? 'Live courts' : shown === 'groups' ? 'Group tables' : 'Knockout'}
        </div>
      </div>

      {shown === 'live' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {bundles.map((b, i) => (
            <LiveRow key={b.competition.id} b={b} tone={TONES[i % 2]} />
          ))}
        </div>
      )}

      {shown === 'groups' && (
        <div className="relative min-h-0 flex-1">
          <Fit>
            <div className="flex w-[1840px] flex-col gap-5">
              {bundles.map((b, i) => <GroupsBlock key={b.competition.id} b={b} tone={TONES[i % 2]} />)}
            </div>
          </Fit>
        </div>
      )}

      {shown === 'bracket' && (
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          {bundles.map((b, i) => (
            <div key={b.competition.id} className="flex min-h-0 min-w-0 flex-1 flex-col">
              <Banner b={b} tone={TONES[i % 2]} />
              <div className="relative min-h-0 flex-1">
                {podiumReady(i)
                  ? <Fit><div className="flex h-[640px] w-[1200px] flex-col"><Podium b={b} champion={decided[i]!.champion} runnerUp={decided[i]!.runnerUp} third={decided[i]!.third} title={category(b)} /></div></Fit>
                  : <Fit><PosterBracket b={b} broadcast /></Fit>}
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

function Banner({ b, tone }: { b: Bundle; tone: typeof TONES[number] }) {
  return (
    <div className={`mb-2 flex shrink-0 items-center justify-between gap-3 rounded-xl px-3 py-1.5 ${tone.soft}`}>
      <span className="flex min-w-0 items-center gap-2">
        <span className={`h-5 w-1.5 shrink-0 rounded-full ${tone.bar}`} />
        <span className={`truncate whitespace-nowrap font-display text-xl font-bold uppercase tracking-widest lg:text-2xl ${tone.text}`}>{category(b)}</span>
        <span className="shrink-0 whitespace-nowrap font-display text-sm font-bold tracking-widest text-fg-subtle">{b.competition.code}</span>
      </span>
      <span className="shrink-0 whitespace-nowrap text-xs font-semibold text-fg-muted lg:text-sm">{stageLine(b)}</span>
    </div>
  )
}

function LiveRow({ b, tone }: { b: Bundle; tone: typeof TONES[number] }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  const next = ev ? upNext(b, ev.id, 4) : []
  const anyLive = b.courts.some(c => liveOnCourt(b, c.id))
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <Banner b={b} tone={tone} />
      <div className="relative min-h-0 flex-1">
        {anyLive || next.length
          ? <Fit><div className="w-[1800px]"><LiveGrid b={b} code={b.competition.code} tv /></div></Fit>
          : <div className="grid h-full place-items-center text-lg text-fg-subtle">No game on court right now</div>}
      </div>
    </section>
  )
}

function GroupsBlock({ b, tone }: { b: Bundle; tone: typeof TONES[number] }) {
  const ev = b.events.find(e => e.format === 'groups_ko')
  if (!ev) return null
  const tables = groupStandings(b, ev.id)
  const advance = ev.advance_per_group ?? 1
  const live = b.matches.filter(m => m.event_id === ev.id && m.status === 'live' && m.bracket_key == null)
  return (
    <section>
      <Banner b={b} tone={tone} />
      <div className="grid grid-cols-4 gap-3">
        {Object.keys(tables).sort().map(g => (
          <div key={g} className="rounded-xl border border-line bg-surface p-2">
            <GroupTable b={b} g={g} rows={tables[g]} advance={advance} big />
          </div>
        ))}
      </div>
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
function Fit({ children }: { children: ReactNode }) {
  const outer = useRef<HTMLDivElement>(null)
  const inner = useRef<HTMLDivElement>(null)
  const [s, setS] = useState(1)
  useLayoutEffect(() => {
    const fit = () => {
      const o = outer.current, i = inner.current
      if (!o || !i || !i.offsetWidth || !i.offsetHeight) return
      const k = Math.min(o.clientWidth / i.offsetWidth, o.clientHeight / i.offsetHeight) * 0.99
      if (isFinite(k) && k > 0) setS(k)
    }
    fit()
    const ro = new ResizeObserver(fit)
    if (outer.current) ro.observe(outer.current)
    if (inner.current) ro.observe(inner.current)
    const t = [150, 600, 1500].map(ms => setTimeout(fit, ms))
    ;(document as any).fonts?.ready?.then(fit).catch(() => {})
    return () => { ro.disconnect(); t.forEach(clearTimeout) }
  }, [])
  return (
    <div ref={outer} className="absolute inset-0 overflow-hidden">
      <div ref={inner} className="absolute left-1/2 top-1/2 w-max"
        style={{ transform: `translate(-50%, -50%) scale(${s})`, transformOrigin: 'center' }}>
        {children}
      </div>
    </div>
  )
}
