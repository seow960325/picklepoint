/** "My team" bar on the front page: pin a team (kept on this phone, no login)
 *  and see at a glance whether it is on court, which court it plays on next
 *  and how many games are before it. */
import { useMemo, useState } from 'react'
import type { Bundle } from '../lib/types'
import type { Hub } from '../lib/hub'
import { groupStandings, teamLogo, teamSideName } from '../lib/store'
import { usePins, MAX_PINS, type Pin } from '../lib/pin'
import { teamStatus } from '../lib/teamstatus'
import { Emblem } from './ui'
import { SportIcon } from './SportIcon'

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
  if (compact && pins.length === 0) return null
  return (
    <section className="px-4 pt-3 lg:px-6">
      {pins.length === 0 ? (
        <button onClick={() => setPicking(true)}
          className="flex min-h-[48px] w-full items-center gap-3 rounded-xl border border-dashed border-line-strong bg-surface px-3 py-2.5 text-left active:bg-surface-2">
          <Star className="h-5 w-5 shrink-0 text-gold" />
          <span className="min-w-0 flex-1">
            <span className="block text-sm font-bold">Follow my team</span>
            <span className="block truncate text-xs text-fg-muted">See your court and how many games before your turn.</span>
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
            const tone = st?.state === 'playing' ? 'border-red-500/60 bg-red-500/10'
              : st?.state === 'next' && (st.ahead ?? 9) <= 1 ? 'border-gold/70 bg-gold/10'
              : 'border-brand-ink/40 bg-brand/[0.07]'
            return (
              <button key={p.code + p.teamId} onClick={() => onOpen(p.code)}
                className={`flex w-full items-center gap-3 rounded-xl border px-3 py-2.5 text-left active:opacity-90 ${tone}`}>
                <Emblem logo={b && id ? teamLogo(b, id) : null} flagName={b && id ? teamSideName(b, id) ?? p.name : p.name} className="h-10 w-10 shrink-0 rounded-[3px]" />
                <span className="min-w-0 flex-1">
                  <span className="flex min-w-0 items-center gap-1.5 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                    <Star on className="h-3 w-3 shrink-0 text-gold" />
                    <span className="truncate">{p.name}{cat ? ` · ${cat.short}` : ''}</span>
                  </span>
                  <span className="block truncate font-display text-xl font-bold leading-tight">
                    {st?.state === 'playing' && <span className="mr-1.5 inline-block h-2 w-2 animate-pulse rounded-full bg-red-500 align-middle" />}
                    {!b ? 'Loading…' : st ? st.head : 'Team not found'}
                  </span>
                  {st && <span className="line-clamp-2 text-xs leading-snug text-fg-muted">{st.sub}</span>}
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
      {picking && <TeamPicker hub={hub} bundleOf={bundleOf} pins={pins} toggle={toggle} onClose={() => setPicking(false)} />}
    </section>
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
