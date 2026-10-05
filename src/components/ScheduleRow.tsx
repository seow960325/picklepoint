import type { ReactNode } from 'react'
import { teamName, teamLogo, teamSideName } from '../lib/store'
import { Emblem } from './ui'

/** One row of an admin schedule list. Every column has a FIXED track, so the
 *  team names and "vs" line up down the whole list whatever the status text
 *  says (see UI_RULES.md — never put a variable-width cell next to flex-1).
 *  Phones: status drops under the names; arrows span both lines. */
export function ScheduleRow({ bundle, a, b, meta, status, live, canUp, canDown, onUp, onDown }: {
  bundle: any; a: string | null; b: string | null; meta: ReactNode
  status: string; live?: boolean
  canUp: boolean; canDown: boolean; onUp: () => void; onDown: () => void
}) {
  const arrow = 'grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2 disabled:opacity-20'
  return (
    <div className="grid grid-cols-[2.75rem_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-0.5 px-3 py-2 sm:grid-cols-[2.75rem_minmax(0,1fr)_6.5rem_auto]">
      <span className="row-span-2 min-w-0 text-center text-xs leading-tight text-fg-subtle sm:row-span-1">{meta}</span>
      <span className="col-start-2 row-start-1 grid min-w-0 grid-cols-[minmax(0,1fr)_1.5rem_minmax(0,1fr)] items-center gap-1">
        <span className="flex min-w-0 items-center justify-end gap-1.5">
          <span className="truncate text-right">{teamName(bundle, a)}</span>
          <Emblem logo={teamLogo(bundle, a)} flagName={teamSideName(bundle, a)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
        </span>
        <span className="text-center text-xs text-fg-subtle">vs</span>
        <span className="flex min-w-0 items-center gap-1.5">
          <Emblem logo={teamLogo(bundle, b)} flagName={teamSideName(bundle, b)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
          <span className="truncate">{teamName(bundle, b)}</span>
        </span>
      </span>
      <span className={`tabular col-start-2 row-start-2 truncate whitespace-nowrap text-center text-[11px] sm:col-start-3 sm:row-start-1 sm:text-right sm:text-xs ${
        live ? 'font-bold text-brand-ink' : 'text-fg-muted'}`}>
        {status}
      </span>
      <span className="col-start-3 row-span-2 row-start-1 flex items-center gap-1 sm:col-start-4 sm:row-span-1">
        <button disabled={!canUp} onClick={onUp} aria-label="Move up" className={arrow}>▲</button>
        <button disabled={!canDown} onClick={onDown} aria-label="Move down" className={arrow}>▼</button>
      </span>
    </div>
  )
}

/** Short status for a schedule row: live / final score, else the round. */
export function scheduleStatus(m: any, round: string): { text: string; live: boolean } {
  if (m.status === 'live') return { text: `● ${m.score_a}–${m.score_b}`, live: true }
  if (m.status === 'finished') return { text: `${m.score_a}–${m.score_b}`, live: false }
  return { text: round, live: false }
}
