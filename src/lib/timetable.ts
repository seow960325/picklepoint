/** Printed timetable: which game is on which court at which planned time.
 *  A slot is one round of games (one per court); the clock comes from the hub
 *  (first game + minutes per slot), so it is a reference, not a countdown. */
import type { Bundle, Match } from './types'
import { hubOf, parentHub } from './hub'

export interface SlotClock { start: string; every: number }
export interface SlotCell { court: number; m: Match | null }
export interface SlotRow { slot: number; time: string; cells: SlotCell[]; state: 'done' | 'now' | 'later' }

/** knockout games come after the last group slot: QF1-3, QF4, SF1, SF2, 3rd place, Final */
const KO_OFFSET: Record<string, number> = { 'KO-8-0': 1, 'KO-8-1': 1, 'KO-8-2': 1, 'KO-8-3': 2, 'KO-4-0': 3, 'KO-4-1': 4, 'KO-3P': 5, 'KO-2-0': 6 }

/** "9:30 am" for slot 1, "9:45 am" for slot 2 … */
export function slotTime(c: SlotClock, slot: number): string {
  const [h, mi] = c.start.split(':').map(Number)
  const t = h * 60 + mi + (slot - 1) * c.every
  const hh = Math.floor(t / 60) % 24, mm = t % 60
  return `${hh % 12 === 0 ? 12 : hh % 12}:${String(mm).padStart(2, '0')} ${hh < 12 ? 'am' : 'pm'}`
}

const courtNo = (c: Bundle['courts'][number]) => Number(/(\d+)\s*$/.exec(c.label ?? '')?.[1] ?? c.number)

/** The slot a game belongs to (printed group slot, or its place after the groups); null = not on the timetable. */
export function slotOf(b: Bundle, m: Match): number | null {
  if (m.bracket_key == null) return m.slot ?? null
  const off = KO_OFFSET[m.bracket_key]
  if (off == null) return null
  const last = Math.max(0, ...b.matches.filter(x => x.event_id === m.event_id && x.bracket_key == null && x.slot != null).map(x => x.slot!))
  return last ? last + off : null
}

/** The court a game is planned on: where it is, else its home court, else the printed knockout court. */
export function plannedCourt(b: Bundle, m: Match): number | null {
  const c = b.courts.find(x => x.id === (m.court_id ?? m.home_court))
  if (c) return courtNo(c)
  return b.events.find(e => e.id === m.event_id)?.ko_court_plan?.[m.bracket_key ?? ''] ?? null
}

/** The planned clock time of a game ("9:30 am"), from the event's printed timetable; '' when the event has none. */
export function plannedTime(b: Bundle, m: Match): string {
  const code = b.competition?.code
  const clock = (parentHub(code) ?? hubOf(code))?.clock
  const sl = clock ? slotOf(b, m) : null
  return sl != null && clock ? slotTime(clock, sl) : ''
}

/** Every slot with one cell per court (m = null: that court has no game in this slot). null = no printed slots. */
export function slotRows(b: Bundle, clock: SlotClock): SlotRow[] | null {
  const courts = [...new Set(b.courts.map(courtNo))].sort((x, y) => x - y)
  const by = new Map<number, Map<number, Match>>()
  for (const m of b.matches) {
    const s = slotOf(b, m), c = plannedCourt(b, m)
    if (s == null || c == null) continue
    if (!by.has(s)) by.set(s, new Map())
    if (!by.get(s)!.has(c)) by.get(s)!.set(c, m)
  }
  if (!by.size) return null
  const rows: SlotRow[] = [...by.keys()].sort((x, y) => x - y).map(slot => {
    const cells = courts.map(court => ({ court, m: by.get(slot)!.get(court) ?? null }))
    const done = cells.every(c => !c.m || c.m.status === 'finished')
    return { slot, time: slotTime(clock, slot), cells, state: done ? 'done' : 'later' }
  })
  const first = rows.find(r => r.state !== 'done')
  for (const r of rows) {
    if (r === first || r.cells.some(c => c.m && (c.m.status === 'live' || c.m.status === 'awaiting_confirm'))) r.state = 'now'
  }
  return rows
}
