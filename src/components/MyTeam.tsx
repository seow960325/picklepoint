/** "My team" bar on the front page: pin a team (kept on this phone, no login)
 *  and see at a glance whether it is on court, which court it plays on next
 *  and how many games are before it. */
import { useMemo, useState } from 'react'
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { groupStandings, teamLogo, teamSideName } from '../lib/store'
import { usePins, MAX_PINS, type Pin } from '../lib/pin'
import { teamStatus } from '../lib/teamstatus'
import { slotOf, slotTime, plannedCourt } from '../lib/timetable'
import { gameTitle } from '../lib/pool'
import { Emblem } from './ui'
import { Link } from 'react-router-dom'
import { SportIcon } from './SportIcon'

/** Every game this team still has to play (on court first, then in play order): planned time, court, opponent. */
function upcoming(b: Bundle, id: string, clock?: Hub['clock']) {
  return b.matches
    .filter(m => (m.team_a_id === id || m.team_b_id === id) && m.team_a_id && m.team_b_id
      && ['live', 'awaiting_confirm', 'scheduled', 'on_deck'].includes(m.status))
    .sort((x, y) => x.sequence - y.sequence)
    .map(m => {
      const sl = clock ? slotOf(b, m) : null, ct = plannedCourt(b, m)
      const opp = b.teams.find(t => t.id === (m.team_a_id === id ? m.team_b_id : m.team_a_id))?.name ?? ''
      return { m, time: sl != null && clock ? slotTime(clock, sl) : '', court: ct != null ? `Court ${ct}` : 'Court to be decided', opp, title: gameTitle(b, m).replace(/ · Slot \d+$/, ''), live: m.status === 'live' || m.status === 'awaiting_confirm' }
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
  const [picking, setPicking] = useState(false)
  const [detail, setDetail] = useState<Pin | null>(null)
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
            const games = b && id ? upcoming(b, id, hub.clock) : []
            const tone = st?.state === 'playing' ? 'border-emerald-500/60 bg-emerald-500/10'
              : st?.state === 'next' && (st.ahead ?? 9) <= 1 ? 'border-gold/70 bg-gold/10'
              : 'border-brand-ink/40 bg-brand/[0.07]'
            return (
              <button key={p.code + p.teamId} onClick={() => setDetail(p)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:opacity-90 ${tone}`}>
                <Emblem logo={b && id ? teamLogo(b, id) : null} flagName={b && id ? teamSideName(b, id) ?? p.name : p.name} className="h-10 w-10 shrink-0 rounded-[3px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                    <Star on className="h-3 w-3 shrink-0 text-gold" />
                    <span className="truncate">{p.name}{cat ? ` · ${cat.short}` : ''}</span>
                  </span>
                  <span className="block truncate font-display text-xl font-bold leading-tight">
                    {st?.state === 'playing' && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-emerald-400 align-middle" />}
                    {!b ? 'Loading…' : st ? st.head : 'Team not found'}
                  </span>
                  {st && !games.length && <span className="line-clamp-2 text-xs leading-snug text-fg-muted">{st.sub}</span>}
                  {games.length > 0 && (
                    <span className="mt-1.5 block space-y-1 border-t border-line/50 pt-1.5">
                      {games.map(g => (
                        <span key={g.m.id} className="grid grid-cols-[4.6rem_minmax(0,1fr)] gap-x-2 text-xs leading-tight">
                          <span className={`font-display text-sm font-bold ${g.live ? 'text-emerald-400' : 'text-fg'}`}>{g.live ? '● Now' : g.time || '—'}</span>
                          <span className="min-w-0">
                            <span className={`block font-semibold ${g.live ? 'text-emerald-400' : 'text-fg-muted'}`}>{g.court} · {g.title}</span>
                            <span className="block truncate text-fg-subtle">vs {g.opp}</span>
                          </span>
                        </span>
                      ))}
                    </span>
                  )}
                </span>
                <span className="shrink-0 text-fg-subtle">›</span>
              </button>
            )
          })}
          {!compact && <button onClick={() => setPicking(true)} className="min-h-[30px] px-1 text-xs font-semibold text-fg-subtle underline underline-offset-4">
            Change my team
          </button>}
        </div>
      )}
      {detail && <TeamDetail hub={hub} pin={detail} b={bundleOf(detail.code)} onClose={() => setDetail(null)} onOpen={() => { const c = detail.code; setDetail(null); onOpen(c) }} />}
      {picking && <TeamPicker hub={hub} bundleOf={bundleOf} pins={pins} toggle={toggle} onClose={() => setPicking(false)} />}
    </section>
  )
}

/** Tap on the highlighted team: every game of that team, in order. Time, court, opponent, and the result once played. */
function TeamDetail({ hub, pin, b, onClose, onOpen }: { hub: Hub; pin: Pin; b: Bundle | null; onClose: () => void; onOpen: () => void }) {
  const id = resolvePin(b, pin)
  const cat = hub.cats.find(c => c.code === pin.code)
  const ev = b?.events.find(e => e.format === 'groups_ko')
  const st = b && id ? teamStatus(b, id, ev ? groupStandings(b, ev.id) : undefined) : null
  const games = b && id ? b.matches
    .filter(m => (m.team_a_id === id || m.team_b_id === id) && m.team_a_id && m.team_b_id)
    .sort((x, y) => x.sequence - y.sequence)
    .map(m => {
      const a = m.team_a_id === id
      const sl = hub.clock ? slotOf(b, m) : null, ct = plannedCourt(b, m)
      const oppId = a ? m.team_b_id : m.team_a_id
      return {
        m, time: sl != null && hub.clock ? slotTime(hub.clock, sl) : '', court: ct != null ? `Court ${ct}` : 'Court to be decided',
        opp: b.teams.find(t => t.id === oppId)?.name ?? '', title: gameTitle(b, m).replace(/ · Slot \d+$/, ''),
        us: a ? m.score_a : m.score_b, them: a ? m.score_b : m.score_a,
        live: m.status === 'live' || m.status === 'awaiting_confirm', done: m.status === 'finished', won: m.winner_id === id,
      }
    }) : []
  const played = games.filter(g => g.done), won = played.filter(g => g.won).length
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex h-[88vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-canvas sm:h-[80vh] sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-center gap-3 border-b border-line px-4 py-3">
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
                    className={`grid grid-cols-[4.6rem_minmax(0,1fr)_auto] items-center gap-x-2 rounded-xl border px-3 py-2.5 ${g.live ? 'border-emerald-500/50 bg-emerald-500/10' : 'border-line bg-surface'}`}>
                    <span className={`font-display text-base font-bold leading-tight ${g.live ? 'text-emerald-400' : g.done ? 'text-fg-subtle' : 'text-fg'}`}>{g.live ? '● Now' : g.time || '—'}</span>
                    <span className="min-w-0">
                      <span className={`block text-[11px] font-bold uppercase tracking-wide ${g.live ? 'text-emerald-400' : 'text-fg-subtle'}`}>{g.court} · {g.title}</span>
                      <span className={`block truncate text-sm ${g.done && !g.won ? 'text-fg-muted' : 'font-semibold'}`}>vs {g.opp}</span>
                    </span>
                    {(g.live || g.done) && (
                      <span className="text-right">
                        <span className={`tabular block font-display text-lg font-bold leading-none ${g.live ? 'text-emerald-400' : g.won ? 'text-gold' : 'text-fg-subtle'}`}>{g.us}–{g.them}</span>
                        {g.done && <span className={`block text-[10px] font-bold uppercase tracking-wider ${g.won ? 'text-gold' : 'text-fg-subtle'}`}>{g.won ? 'Won' : 'Lost'}</span>}
                      </span>
                    )}
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
                      const on = pins.some(p => p.code === cat.code && (p.teamId === t.id || p.name === t.name))
                      return (
                        <button key={t.id} onClick={() => toggle({ code: cat.code, teamId: t.id, name: t.name })}
                          className={`grid grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2 rounded-xl border px-2.5 py-2 text-left ${on ? 'border-gold bg-gold/10' : 'border-line bg-surface active:bg-surface-2'}`}>
                          <Emblem logo={teamLogo(b, t.id)} flagName={teamSideName(b, t.id) ?? t.name} className="h-8 w-8 shrink-0 rounded-[3px]" />
                          <span className="min-w-0">
                            <span className="block truncate text-sm font-semibold">{t.name}</span>
                            <span className="block truncate text-[11px] text-fg-subtle">{t.pool && t.pool !== '—' ? `Group ${t.pool}` : ''}</span>
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
