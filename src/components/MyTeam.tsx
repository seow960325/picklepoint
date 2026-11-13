/** "My team" bar on the front page: pin a team (kept on this phone, no login)
 *  and see at a glance whether it is on court, which court it plays on next
 *  and how many games are before it. */
import { useEffect, useMemo, useState } from 'react'
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { groupStandings, teamLogo, teamSideName } from '../lib/store'
import { usePins, MAX_PINS, type Pin } from '../lib/pin'
import { teamStatus } from '../lib/teamstatus'
import { CourtTag } from './CourtMap'
import { slotOf, slotTime, plannedCourt, clockOfCode } from '../lib/timetable'
import { stageName } from '../lib/pool'
import { isAlert, alertWord } from '../lib/alert'
import { Emblem, PairName, ScoreWL, Clock } from './ui'
import { Link } from 'react-router-dom'
import { SportIcon } from './SportIcon'

/** The phone's own clock (no database at all): ticks every second. */
function useNow() {
  const [now, setNow] = useState(() => new Date())
  useEffect(() => { const t = window.setInterval(() => setNow(new Date()), 1000); return () => window.clearInterval(t) }, [])
  return now
}
/** "9:45 am" on the event day (its date from Settings; today when unknown) as a Date. */
function dayAt(t: string, now: Date, day?: string | null): Date | null {
  const m = /^\s*(\d{1,2}):(\d{2})\s*([ap]m)\s*$/i.exec(t)
  if (!m) return null
  let h = Number(m[1]) % 12
  if (m[3].toLowerCase() === 'pm') h += 12
  const dm = /^(\d{4})-(\d{2})-(\d{2})/.exec(day ?? '')
  const d = dm ? new Date(Number(dm[1]), Number(dm[2]) - 1, Number(dm[3])) : new Date(now)
  d.setHours(h, Number(m[2]), 0, 0)
  return d
}
const hm = (d: Date) => {
  const h = d.getHours(), mi = d.getMinutes()
  return `${h % 12 === 0 ? 12 : h % 12}:${String(mi).padStart(2, '0')} ${h < 12 ? 'am' : 'pm'}`
}
/** On court but not started yet (0-0, no point) and its planned time is still ahead (e.g. the day
 *  before, or before 9:30 am): show it as "coming up" with a countdown, not as "Now". */
function waiting(g: { live: boolean; time: string; m: { score_a: number; score_b: number } }, now: Date, day?: string | null) {
  if (!g.live || g.m.score_a > 0 || g.m.score_b > 0) return false
  const at = dayAt(g.time, now, day)
  return !!at && at.getTime() > now.getTime()
}
/** Time now, small, with a blinking colon so it reads as live (phone clock: no database). */
function LiveTime() {
  const now = useNow()
  const h12 = now.getHours() % 12 === 0 ? 12 : now.getHours() % 12
  return (
    <span className="tabular shrink-0 whitespace-nowrap font-display text-base font-bold leading-none text-emerald-400">
      {h12}<span className="pp-blink">:</span>{String(now.getMinutes()).padStart(2, '0')}<span className="ml-0.5 text-[0.75em] uppercase">{now.getHours() < 12 ? 'am' : 'pm'}</span>
    </span>
  )
}
/** Countdown to this team's next planned game in a bar that FILLS as the game comes closer: empty right
 *  after the previous game, full at game time (first game of the day: empty until an hour before). */
function NextBar({ next, prev, day }: { next?: { time: string; live: boolean }; prev?: string; day?: string | null }) {
  const now = useNow()
  const at = next && !next.live ? dayAt(next.time, now, day) : null
  if (!at) return null
  const secs = Math.round((at.getTime() - now.getTime()) / 1000)
  const two = (n: number) => String(n).padStart(2, '0')
  const left = secs <= 0 ? 'NOW'
    : secs >= 86400 ? `${Math.floor(secs / 86400)}d ${two(Math.floor((secs % 86400) / 3600))}:${two(Math.floor((secs % 3600) / 60))}`
    : `${two(Math.floor(secs / 3600))}:${two(Math.floor((secs % 3600) / 60))}:${two(secs % 60)}`
  const from = prev ? dayAt(prev, now, day) : null
  const span = from && at.getTime() > from.getTime() ? (at.getTime() - from.getTime()) / 1000 : 3600
  // a sliver of green always shows, so the bar reads as a bar that will fill
  const pct = Math.max(6, Math.min(100, 100 - (secs / span) * 100))
  const warn = secs <= 600
  return (
    <span className="relative block h-6 w-full shrink-0 overflow-hidden rounded-md bg-black/50 ring-1 ring-white/15" title="Time left to your next game">
      <span className={`absolute inset-y-0 left-0 transition-[width] duration-1000 ease-linear ${warn ? 'bg-gold' : 'bg-emerald-500'}`} style={{ width: `${secs <= 0 ? 100 : pct}%` }} />
      <span className="tabular absolute inset-0 flex items-center justify-center font-display text-[13px] font-bold leading-none text-white [text-shadow:0_1px_2px_rgba(0,0,0,.9)]">{left}</span>
    </span>
  )
}

/** Every game this team still has to play (on court first, then in play order): planned time, court, opponent. */
function upcoming(b: Bundle, id: string, clock?: Hub['clock']) {
  return b.matches
    .filter(m => (m.team_a_id === id || m.team_b_id === id) && m.team_a_id && m.team_b_id
      && ['live', 'awaiting_confirm', 'scheduled', 'on_deck'].includes(m.status))
    .sort((x, y) => x.sequence - y.sequence)
    .map(m => {
      const sl = clock ? slotOf(b, m) : null, ct = plannedCourt(b, m)
      const opp = b.teams.find(t => t.id === (m.team_a_id === id ? m.team_b_id : m.team_a_id))?.name ?? ''
      return { m, oppId: m.team_a_id === id ? m.team_b_id! : m.team_a_id!, time: sl != null && clock ? slotTime(clock, sl) : '', court: ct != null ? `Court ${ct}` : 'Court to be decided', n: ct, opp, title: stageName(b, m), live: m.status === 'live' || m.status === 'awaiting_confirm' }
    })
}

/** Games already played, latest first: shown at the bottom of the highlight with the score. */
function played(b: Bundle, id: string, clock?: Hub['clock']) {
  return b.matches
    .filter(m => (m.team_a_id === id || m.team_b_id === id) && m.team_a_id && m.team_b_id && m.status === 'finished')
    .sort((x, y) => (y.finished_at ?? '').localeCompare(x.finished_at ?? '') || y.sequence - x.sequence)
    .map(m => {
      const a = m.team_a_id === id, sl = clock ? slotOf(b, m) : null
      const oppId = (a ? m.team_b_id : m.team_a_id)!
      return { m, oppId, opp: b.teams.find(t => t.id === oppId)?.name ?? '', time: sl != null && clock ? slotTime(clock, sl) : '',
        title: stageName(b, m), us: a ? m.score_a : m.score_b, them: a ? m.score_b : m.score_a, won: m.winner_id === id }
    })
}

const Star = ({ on, className = '' }: { on?: boolean; className?: string }) => (
  <svg viewBox="0 0 24 24" className={className} fill={on ? 'currentColor' : 'none'} stroke="currentColor" strokeWidth="2" strokeLinejoin="round">
    <path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z" />
  </svg>
)

/** the pin may predate a re-import of the teams: fall back to the same name */
export function resolvePin(b: Bundle | null, p: Pin): string | null {
  if (!b) return null
  if (b.teams.some(t => t.id === p.teamId)) return p.teamId
  return b.teams.find(t => t.name === p.name)?.id ?? null
}

export default function MyTeamBar({ hub, bundleOf, onOpen, compact = false }: {
  hub: Hub; bundleOf: (code: string) => Bundle | null; onOpen: (code: string) => void
  compact?: boolean   // other tabs: the status only, no "follow" invitation
}) {
  const { pins, toggle } = usePins(hub.code)
  const now = useNow()
  const [picking, setPicking] = useState(false)
  const [stack, setStack] = useState<Pin[]>([])
  const detail = stack[stack.length - 1] ?? null
  const setDetail = (p: Pin | null) => setStack(p ? [p] : [])
  if (compact && pins.length === 0) return null
  return (
    <section className="px-4 pt-3 lg:px-6">
      {pins.length === 0 ? (
        <button onClick={() => setPicking(true)}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-3 py-2.5 text-left active:bg-surface-2">
          <Star className="h-5 w-5 shrink-0 text-gold" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">Follow my team</span>
            <span className="block text-xs leading-snug text-fg-muted">See your court and how many games are before yours.</span>
          </span>
          <span className="shrink-0 text-fg-subtle">›</span>
        </button>
      ) : (
        <div className="space-y-2">
          {pins.map(p => {
            const b = bundleOf(p.code)
            const cat = hub.cats.find(c => c.code === p.code)
            const id = resolvePin(b, p)
            const ev = b?.events.find(e => e.format === 'groups_ko')
            const st = b && id ? teamStatus(b, id, ev ? groupStandings(b, ev.id) : undefined) : null
            const day = b?.competition?.event_date
            const games = (b && id ? upcoming(b, id, clockOfCode(b.competition?.code)) : []).map(g => (waiting(g, now, day) ? { ...g, live: false } : g))
            const playing = st?.state === 'playing' && games.some(g => g.live)
            const head = st?.state === 'playing' && !playing && games[0] ? `Next game ${games[0].time} · ${games[0].court}` : st?.head
            const past = b && id ? played(b, id, clockOfCode(b.competition?.code)) : []
            const alerted = games.some(g => isAlert(g.m))
            const tone = alerted ? 'border-red-500/80 bg-red-500/15'
              : playing ? 'border-blue-400 bg-blue-500/20'
              : st?.state === 'next' && (st.ahead ?? 9) <= 1 ? 'border-indigo-300/70 bg-indigo-500/15'
              : 'border-indigo-400/40 bg-indigo-500/10'
            return (
              <div key={p.code + p.teamId} role="button" tabIndex={0} onClick={() => setDetail(p)}
                className={`relative flex w-full cursor-pointer items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:opacity-90 ${tone}`}>
                {/* live time: top right corner of the card */}
                {games.length > 0 && <span className="absolute right-3 top-2"><LiveTime /></span>}
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-start justify-between gap-2">
                    {/* church logo (YC26, MC26 has none) on the left, two rows tall: names + star, then the category */}
                    <span className="flex min-w-0 items-center gap-2">
                      <Emblem logo={b && id ? teamLogo(b, id) : null} flagName={b && id ? teamSideName(b, id) ?? p.name : p.name} className="h-9 w-9 shrink-0 rounded-[3px]" />
                      <span className="min-w-0 text-[11px] font-bold uppercase leading-snug tracking-wider text-fg-subtle">
                        <span className="flex min-w-0 items-center gap-1.5">
                          <span className="min-w-0 truncate">{p.name.replace(/\s*\|\s*/g, ' / ')}</span>
                          <Star on className="h-3 w-3 shrink-0 text-gold" />
                        </span>
                        {cat && <span className="block truncate">{cat.short}</span>}
                      </span>
                    </span>
                    {games.length > 0 && <span className="w-14 shrink-0" aria-hidden="true" />}
                  </span>
                  <span className="mt-1 grid grid-cols-[minmax(0,1fr)_5rem] items-center gap-x-3">
                    <span className="block min-w-0 truncate font-display text-xl font-bold leading-tight">
                      {playing && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-blue-400 align-middle" />}
                      {!b ? 'Loading…' : st ? head : 'Team not found'}
                    </span>
                    {games.length > 0 && <span className="flex justify-center"><NextBar next={games.find(g => !g.live && g.time)} prev={(games.find(g => g.live) ?? past[0])?.time} day={day} /></span>}
                  </span>
                  {st && !games.length && <span className="line-clamp-2 text-xs leading-snug text-fg-muted">{st.sub}</span>}
                  {games.length > 0 && (
                    <span className="mt-1.5 block divide-y divide-line/70 border-t border-line/50 pt-0.5">
                      {games.map(g => (
                        <span key={g.m.id} className="grid grid-cols-[6.2rem_minmax(0,1fr)_5rem] items-center gap-x-3 py-2 text-sm leading-tight">
                          <span className="min-w-0">
                            <span className={`block font-display text-lg font-bold leading-tight ${g.live ? 'text-blue-400' : isAlert(g.m) ? 'text-red-500' : 'text-fg'}`}>{g.live ? '● Now' : <Clock t={g.time} />}</span>
                            {isAlert(g.m) ? <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-red-500">⚠ {alertWord(g.m)}</span>
                              : <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{g.title}</span>}
                          </span>
                          <span className="min-w-0">
                            <button onClick={e => { e.stopPropagation(); setStack([...(stack.length ? stack : [p]), { code: p.code, teamId: g.oppId, name: g.opp }]) }}
                              className="block w-full text-left text-[13px] font-semibold leading-snug underline decoration-line-strong decoration-dotted underline-offset-4"><span className="block truncate">{g.opp.replace(/\s*\|\s*/g, ' / ')}</span></button>
                          </span>
                          <span className={`text-center text-xs font-bold uppercase tracking-wide ${g.live ? 'text-blue-400' : isAlert(g.m) ? 'text-red-500' : 'text-fg-muted'}`}><CourtTag code={b?.competition?.code} n={g.n}>{g.court}</CourtTag></span>
                        </span>
                      ))}
                    </span>
                  )}
                  {past.length > 0 && (
                    <span className="mt-1.5 block divide-y divide-line/70 border-t border-line/50 pt-1.5">
                      <span className="block pb-1 text-[10px] font-bold uppercase tracking-wider text-fg-subtle">Played</span>
                      {past.map(g => (
                        <span key={g.m.id} className="grid grid-cols-[6.2rem_minmax(0,1fr)_5rem] items-center gap-x-3 py-2 text-sm leading-tight text-fg-muted">
                          <span className="min-w-0">
                            <span className="block font-display text-lg font-bold leading-tight"><Clock t={g.time} /></span>
                            <span className="block truncate text-[10px] font-bold uppercase tracking-wider text-fg-subtle">{g.title}</span>
                          </span>
                          <span className="min-w-0">
                            <button onClick={e => { e.stopPropagation(); setStack([...(stack.length ? stack : [p]), { code: p.code, teamId: g.oppId, name: g.opp }]) }}
                              className="block w-full text-left text-[13px] font-semibold leading-snug underline decoration-line-strong decoration-dotted underline-offset-4"><span className="block truncate">{g.opp.replace(/\s*\|\s*/g, ' / ')}</span></button>
                          </span>
                          <ScoreWL us={g.us} them={g.them} wl={g.won ? 'W' : 'L'} className={`justify-self-center font-display text-lg font-bold ${g.won ? 'text-gold' : 'text-fg-subtle'}`} />
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="-mr-1 flex min-h-[44px] w-9 shrink-0 items-center justify-center rounded-lg pl-2 text-xl text-fg-subtle active:bg-white/10" aria-label="Team details">›</span>
              </div>
            )
          })}
          {!compact && <button onClick={() => setPicking(true)} className="min-h-[30px] px-1 text-xs font-semibold text-fg-subtle underline underline-offset-4">
            Change my team
          </button>}
        </div>
      )}
      {detail && <TeamDetail hub={hub} pin={detail} b={bundleOf(detail.code)} onClose={() => setDetail(null)}
        onBack={stack.length > 1 ? () => setStack(stack.slice(0, -1)) : undefined} onTeam={q => setStack([...stack, q])} onOpen={() => { const c = detail.code; setDetail(null); onOpen(c) }} />}
      {picking && <TeamPicker hub={hub} bundleOf={bundleOf} pins={pins} toggle={toggle} onClose={() => setPicking(false)} />}
    </section>
  )
}

/** Tap on the highlighted team: every game of that team, in order. Time, court, opponent, and the result once played. */
function TeamDetail({ hub, pin, b, onClose, onOpen, onBack, onTeam }: { hub: Hub; pin: Pin; b: Bundle | null; onClose: () => void; onOpen: () => void; onBack?: () => void; onTeam: (p: Pin) => void }) {
  const id = resolvePin(b, pin)
  const cat = hub.cats.find(c => c.code === pin.code)
  const ev = b?.events.find(e => e.format === 'groups_ko')
  const st = b && id ? teamStatus(b, id, ev ? groupStandings(b, ev.id) : undefined) : null
  const now = useNow()
  const games = b && id ? b.matches
    .filter(m => (m.team_a_id === id || m.team_b_id === id) && m.team_a_id && m.team_b_id)
    .sort((x, y) => x.sequence - y.sequence)
    .map(m => {
      const a = m.team_a_id === id
      const ck = clockOfCode(b.competition?.code), sl = ck ? slotOf(b, m) : null, ct = plannedCourt(b, m)
      const oppId = a ? m.team_b_id : m.team_a_id
      return {
        m, time: sl != null && ck ? slotTime(ck, sl) : '', court: ct != null ? `Court ${ct}` : 'Court to be decided', n: ct,
        opp: b.teams.find(t => t.id === oppId)?.name ?? '', title: stageName(b, m),
        us: a ? m.score_a : m.score_b, them: a ? m.score_b : m.score_a,
        live: m.status === 'live' || m.status === 'awaiting_confirm', done: m.status === 'finished', won: m.winner_id === id,
      }
    }).map(g => (waiting(g, now, b.competition?.event_date) ? { ...g, live: false } : g)) : []
  const played = games.filter(g => g.done), won = played.filter(g => g.won).length
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-canvas sm:h-[80vh] sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
          {onBack && <button onClick={onBack} className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-lg text-fg-muted">‹</button>}
          <Emblem logo={b && id ? teamLogo(b, id) : null} flagName={b && id ? teamSideName(b, id) ?? pin.name : pin.name} className="h-10 w-10 shrink-0 rounded-[3px]" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-display text-xl font-bold leading-tight">{pin.name}</div>
            <div className="truncate text-xs text-fg-muted">{cat?.label ?? ''}{played.length ? ` · played ${played.length}, won ${won}` : ''}</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-fg">Done</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
          {!b ? <div className="py-4 text-center text-sm text-fg-muted">Loading…</div> : (
            <>
              {st && <div className="mb-3 rounded-xl border border-line bg-surface px-3 py-2">
                <div className="font-display text-lg font-bold leading-tight">{st.head}</div>
                <div className="text-xs text-fg-muted">{st.sub}</div>
              </div>}
              <div className="space-y-2">
                {games.map(g => (
                  <Link key={g.m.id} to={g.live || g.done ? `/c/${pin.code}/match/${g.m.id}` : '#'} onClick={e => { if (!g.live && !g.done) e.preventDefault() }}
                    className={`grid grid-cols-[4.6rem_minmax(0,1fr)_4.6rem] items-center gap-x-2 rounded-xl border px-3 py-2.5 ${g.live ? 'border-blue-500/50 bg-blue-500/10' : 'border-line bg-surface'}`}>
                    <span className={`font-display text-base font-bold leading-tight ${g.live ? 'text-blue-400' : g.done ? 'text-fg-subtle' : 'text-fg'}`}>{g.live ? '● Now' : <Clock t={g.time} />}</span>
                    <span className="min-w-0 text-center">
                      <span className="block text-[10px] font-bold uppercase tracking-wide text-fg-subtle">{g.title}</span>
                      <button onClick={e => { e.preventDefault(); e.stopPropagation(); const oid = g.m.team_a_id === id ? g.m.team_b_id : g.m.team_a_id; if (oid) onTeam({ code: pin.code, teamId: oid, name: g.opp }) }}
                        className={`block w-full truncate text-sm underline decoration-line-strong decoration-dotted underline-offset-4 ${g.done && !g.won ? 'text-fg-muted' : 'font-semibold'}`}><PairName name={g.opp} /></button>
                    </span>
                    <span className="text-right">
                      <span className={`block text-xs font-bold uppercase leading-tight tracking-wide ${g.live ? 'text-blue-400' : 'text-fg-muted'}`}><CourtTag code={pin.code} n={g.n}>{g.court}</CourtTag></span>
                      {(g.live || g.done) && <ScoreWL us={g.us} them={g.them} wl={g.done ? (g.won ? 'W' : 'L') : null} className={`font-display text-base font-bold leading-tight ${g.live ? 'text-blue-400' : g.won ? 'text-gold' : 'text-fg-subtle'}`} />}
                    </span>
                  </Link>
                ))}
                {games.length === 0 && <div className="py-4 text-center text-sm text-fg-muted">No games fixed yet.</div>}
              </div>
              <button onClick={onOpen} className="mt-4 min-h-[44px] w-full rounded-xl border border-line px-3 py-2 text-sm font-semibold text-fg-muted active:bg-surface-2">
                Open {cat?.short ?? 'category'} ›
              </button>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

function TeamPicker({ hub, bundleOf, pins, toggle, onClose }: {
  hub: Hub; bundleOf: (code: string) => Bundle | null; pins: Pin[]; toggle: (p: Pin) => void; onClose: () => void
}) {
  const [q, setQ] = useState('')
  const cats = useMemo(() => hub.cats.map(cat => ({ cat, b: bundleOf(cat.code) })), [hub, bundleOf])
  const needle = q.trim().toLowerCase()
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-canvas sm:h-[80vh] sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="font-display text-xl font-bold">Follow my team</div>
            <div className="truncate text-xs text-fg-muted">Tap your team. Kept on this phone only{MAX_PINS > 1 ? ` · up to ${MAX_PINS}` : ''}.</div>
          </div>
          <button onClick={onClose} className="shrink-0 rounded-lg bg-brand px-4 py-2 text-sm font-bold text-brand-fg">Done</button>
        </div>
        <div className="border-b border-line px-4 py-2">
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Search team or player"
            className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-base text-fg outline-none placeholder:text-fg-subtle" />
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {cats.map(({ cat, b }) => {
            const teams = (b?.teams ?? []).filter(t => !needle || [t.name, t.player1, t.player2].some(x => (x ?? '').toLowerCase().includes(needle)))
              .sort((x, y) => (x.pool ?? '').localeCompare(y.pool ?? '') || x.name.localeCompare(y.name))
            if (b && teams.length === 0) return null
            return (
              <div key={cat.code} className="mb-3">
                <div className="sticky top-0 z-10 flex items-center gap-1.5 bg-canvas py-1.5 text-[11px] font-bold uppercase tracking-[0.2em] text-fg-subtle">
                  <SportIcon sport={cat.sport} /> {cat.label}
                </div>
                {!b ? <div className="py-2 text-sm text-fg-muted">Loading…</div> : (
                  <div className="grid grid-cols-1 gap-1.5 sm:grid-cols-2">
                    {teams.map(t => {
                      const anyLogo = teams.some(x => !!teamLogo(b, x.id))
                      const on = pins.some(p => p.code === cat.code && (p.teamId === t.id || p.name === t.name))
                      return (
                        <button key={t.id} onClick={() => toggle({ code: cat.code, teamId: t.id, name: t.name })}
                          className={`flex w-full items-center gap-2.5 rounded-xl border px-2.5 py-2 text-left ${on ? 'border-gold bg-gold/10' : 'border-line bg-surface active:bg-surface-2'}`}>
                          {anyLogo && (teamLogo(b, t.id)
                            ? <Emblem logo={teamLogo(b, t.id)} flagName={teamSideName(b, t.id) ?? t.name} className="h-8 w-8 shrink-0 rounded-[3px]" />
                            : <span className="h-8 w-8 shrink-0" aria-hidden="true" />)}
                          <span className="block min-w-0 flex-1">
                            <span className="block w-full text-sm font-semibold"><PairName name={t.name} /></span>
                            <span className="block text-center text-[11px] leading-tight text-fg-subtle">{t.pool && t.pool !== '—' ? `Group ${t.pool}` : '\u00a0'}</span>
                          </span>
                          <Star on={on} className={`h-5 w-5 shrink-0 ${on ? 'text-gold' : 'text-fg-subtle'}`} />
                        </button>
                      )
                    })}
                  </div>
                )}
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}
