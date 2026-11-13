/** Players entered in two categories that run at the same time (Christmas
 *  Outreach: Men's Doubles on Courts 1-3 and Mixed Doubles on Courts 4-6, same
 *  printed time slots). The random group draw deals such a player's team into a
 *  group place whose time slots do not collide with their other team's, and,
 *  where it can, not back to back and without a long idle gap.
 *
 *  The fixtures and the timetable never change: only WHO sits in which group
 *  place. So a team in one category only keeps the rest its place already has;
 *  the draw can improve things for the players who are in both. */
import type { Bundle } from './types'

export interface Seat { id: string; pool: string; slots: number[] }      // a group place and when it plays
export interface Entry { id: string; name: string; players: string[] }   // a team to deal into a place
export interface Fixed { label: string; pool: string; players: string[]; slots: number[] }   // team of the other category

export const playerKey = (s: string | null | undefined): string => (s ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** the two players of a team: the registered names, else the team name split at "&", "/", "+" or "," */
export function playersOf(t: { name: string; player1?: string | null; player2?: string | null }): string[] {
  const reg = [t.player1, t.player2].map(playerKey).filter(Boolean)
  if (reg.length) return reg
  const parts = t.name.split(/\s*(?:&|\/|\+|,| and )\s*/i).map(playerKey).filter(Boolean)
  return parts.length > 1 ? parts : []
}

const groupGames = (b: Bundle, eventId: string) =>
  b.matches.filter(m => m.event_id === eventId && !m.bracket_key && !m.tie_stage)

/** time slots of a team's group games (empty when the event has no printed slots) */
export function teamSlots(b: Bundle, teamId: string): number[] {
  return b.matches.filter(m => !m.bracket_key && !m.tie_stage && m.slot != null && (m.team_a_id === teamId || m.team_b_id === teamId))
    .map(m => m.slot as number).sort((x, y) => x - y)
}

export function seatsOf(b: Bundle, eventId: string): Seat[] {
  const timed = groupGames(b, eventId).some(m => m.slot != null)
  return b.teams.filter(t => t.event_id === eventId)
    .map(t => ({ id: t.id, pool: t.pool ?? 'A', slots: timed ? teamSlots(b, t.id) : [] }))
}
export const entriesOf = (b: Bundle, eventId: string): Entry[] =>
  b.teams.filter(t => t.event_id === eventId).map(t => ({ id: t.id, name: t.name, players: playersOf(t) }))

/** every team of another category, with its time slots as it stands now */
export function fixedOf(b: Bundle, label: string): Fixed[] {
  return b.teams.map(t => ({ label: `${label} · ${t.name}`, pool: t.pool ?? '', players: playersOf(t), slots: teamSlots(b, t.id) }))
    .filter(f => f.players.length > 0 && f.slots.length > 0)
}

export interface Meet { player: string; team: string; pool: string; slots: number[]; other: string; otherPool: string; otherSlots: number[]; clash: number[]; tight: number[]; longest: number }

/** how one team placed on `slots` fits with a team the same player has elsewhere */
function meet(slots: number[], f: Fixed) {
  const clash = slots.filter(s => f.slots.includes(s))
  const tight = slots.filter(s => f.slots.some(o => Math.abs(o - s) === 1))
  const all = [...new Set([...slots, ...f.slots])].sort((x, y) => x - y)
  let longest = 0
  for (let i = 1; i < all.length; i++) longest = Math.max(longest, all[i] - all[i - 1])
  return { clash, tight, longest }
}

/** Longest wait (in slots) that is still fine; beyond it every slot costs a little. */
const IDLE_OK = 4
const costOf = (slots: number[], fs: Fixed[]): number => {
  let c = 0
  for (const f of fs) {
    const m = meet(slots, f)
    c += m.clash.length * 100000 + m.tight.length * 300 + Math.max(0, m.longest - IDLE_OK) * 10
  }
  return c
}

export interface Draw { map: Array<{ slot: string; src: string }>; meets: Meet[]; clashes: number; tight: number }

const byPlayer = (fixed: Fixed[]) => {
  const m = new Map<string, Fixed[]>()
  for (const f of fixed) for (const p of f.players) m.set(p, [...(m.get(p) ?? []), f])
  return m
}

/** what the players in two categories get from an arrangement (seat i holds entry order[i]) */
export function meetsOf(seats: Seat[], entries: Entry[], order: number[], fixed: Fixed[]): Meet[] {
  const idx = byPlayer(fixed)
  const out: Meet[] = []
  seats.forEach((seat, i) => {
    const e = entries[order[i]]
    for (const p of e.players) for (const f of idx.get(p) ?? []) {
      const m = meet(seat.slots, f)
      out.push({ player: p, team: e.name, pool: seat.pool, slots: seat.slots, other: f.label, otherPool: f.pool, otherSlots: f.slots, ...m })
    }
  })
  return out.sort((x, y) => y.clash.length - x.clash.length || y.tight.length - x.tight.length || x.player.localeCompare(y.player))
}

/** A random draw; when players are in both categories, the best of many random
 *  draws after trading places until nothing improves. Without such players (or
 *  without printed slots) it is a plain shuffle, exactly as before. */
export function smartDraw(seats: Seat[], entries: Entry[], fixed: Fixed[], rng: () => number = Math.random, tries = 80): Draw {
  const n = seats.length
  const idx = byPlayer(fixed)
  const mine = entries.map(e => e.players.flatMap(p => idx.get(p) ?? []))
  const dual = mine.some(f => f.length > 0) && seats.some(s => s.slots.length > 0)
  const shuffle = () => {
    const a = entries.map((_, i) => i)
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [a[i], a[j]] = [a[j], a[i]] }
    return a
  }
  const cost = (seat: number, entry: number) => (mine[entry].length ? costOf(seats[seat].slots, mine[entry]) : 0)
  let best = shuffle(), bestCost = dual ? best.reduce((s, e, i) => s + cost(i, e), 0) : 0
  for (let t = 0; dual && t < tries && bestCost > 0; t++) {
    const a = t === 0 ? best.slice() : shuffle()
    for (let improved = true; improved;) {
      improved = false
      for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
        if (!mine[a[i]].length && !mine[a[j]].length) continue
        const now = cost(i, a[i]) + cost(j, a[j]), then = cost(i, a[j]) + cost(j, a[i])
        if (then < now) { [a[i], a[j]] = [a[j], a[i]]; improved = true }
      }
    }
    const c = a.reduce((s, e, i) => s + cost(i, e), 0)
    if (c < bestCost) { best = a; bestCost = c }
  }
  const meets = meetsOf(seats, entries, best, fixed)
  return {
    map: seats.map((s, i) => ({ slot: s.id, src: entries[best[i]].id })),
    meets,
    clashes: meets.reduce((s, m) => s + m.clash.length, 0),
    tight: meets.reduce((s, m) => s + m.tight.length, 0),
  }
}

/** the arrangement as it stands now */
export function currentMeets(b: Bundle, eventId: string, fixed: Fixed[]): Meet[] {
  const seats = seatsOf(b, eventId), entries = entriesOf(b, eventId)
  return meetsOf(seats, entries, entries.map((_, i) => i), fixed)
}

/** printed start time of a slot (Christmas Outreach: 9:30 am, every 15 minutes) */
const CLOCK: Record<string, { start: number; every: number }> = { MCMD: { start: 570, every: 15 }, MCXD: { start: 570, every: 15 }, TESTMD: { start: 570, every: 15 }, TESTXD: { start: 570, every: 15 } }
export function slotClock(code: string | null | undefined, slot: number): string {
  const c = CLOCK[(code ?? '').toUpperCase()]
  if (!c) return `slot ${slot}`
  const t = c.start + (slot - 1) * c.every, h = Math.floor(t / 60), m = t % 60
  return `${((h + 11) % 12) + 1}:${String(m).padStart(2, '0')}`
}

// ------------------------------------------------- both categories together
export interface Side { label: string; seats: Seat[]; entries: Entry[] }
const fixedFrom = (s: Side, map: Draw['map']): Fixed[] => map.map(({ slot, src }) => {
  const seat = s.seats.find(x => x.id === slot)!, e = s.entries.find(x => x.id === src)!
  return { label: `${s.label} · ${e.name}`, pool: seat.pool, players: e.players, slots: seat.slots }
}).filter(f => f.players.length > 0 && f.slots.length > 0)

const pairCost = (x: number[], y: number[]): number => {
  let clash = 0, tight = 0
  for (const s of x) for (const o of y) { if (s === o) clash++; else if (Math.abs(s - o) === 1) tight++ }
  const all = [...new Set([...x, ...y])].sort((p, q) => p - q)
  let longest = 0
  for (let i = 1; i < all.length; i++) longest = Math.max(longest, all[i] - all[i - 1])
  return clash * 100000 + tight * 300 + Math.max(0, longest - IDLE_OK) * 10
}

/** Draws both categories together: both start from a random deal, then teams of
 *  the players who are in both trade group places (in either category) while
 *  that removes a collision, a back-to-back or a long wait. The best of several
 *  fresh random starts is kept, so it is still a random draw. */
export function jointDraw(a: Side, b: Side, rng: () => number = Math.random, starts = 40): { a: Draw; b: Draw } {
  const sides = [a, b]
  // links[k][i] = for entry i of side k: the entries of the other side sharing a player (once per shared player)
  const links = sides.map((s, k) => s.entries.map(e => e.players.flatMap(p =>
    sides[1 - k].entries.flatMap((o, j) => (o.players.includes(p) ? [j] : [])))))
  const timed = a.seats.some(s => s.slots.length) && b.seats.some(s => s.slots.length)
  const shuffle = (n: number) => {
    const x = [...Array(n).keys()]
    for (let i = n - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [x[i], x[j]] = [x[j], x[i]] }
    return x
  }
  let best: number[][] | null = null, bestCost = Infinity
  for (let st = 0; st < starts; st++) {
    const ord = [shuffle(a.seats.length), shuffle(b.seats.length)]            // ord[k][seat] = entry
    const seatOf = ord.map(o => { const r: number[] = []; o.forEach((e, seat) => { r[e] = seat }); return r })
    const cost = (k: number, e: number) => {
      let c = 0
      for (const j of links[k][e]) c += pairCost(sides[k].seats[seatOf[k][e]].slots, sides[1 - k].seats[seatOf[1 - k][j]].slots)
      return c
    }
    const total = () => a.entries.reduce((sum, _, e) => sum + cost(0, e), 0)
    for (let improved = timed; improved;) {
      improved = false
      for (const k of [0, 1]) {
        const n = ord[k].length
        for (let i = 0; i < n; i++) for (let j = i + 1; j < n; j++) {
          const e1 = ord[k][i], e2 = ord[k][j]
          if (!links[k][e1].length && !links[k][e2].length) continue
          const now = cost(k, e1) + cost(k, e2)
          ord[k][i] = e2; ord[k][j] = e1; seatOf[k][e1] = j; seatOf[k][e2] = i
          if (cost(k, e1) + cost(k, e2) < now) improved = true
          else { ord[k][i] = e1; ord[k][j] = e2; seatOf[k][e1] = i; seatOf[k][e2] = j }
        }
      }
    }
    const c = timed ? total() : 0
    if (c < bestCost) { best = ord.map(o => o.slice()); bestCost = c }
    if (bestCost < 100000 && st >= 5) break     // nobody on two courts at once: a few more starts only to trim back-to-backs
  }
  const out = (k: number): Draw => {
    const s = sides[k], o = sides[1 - k]
    const map = s.seats.map((seat, i) => ({ slot: seat.id, src: s.entries[best![k][i]].id }))
    const omap = o.seats.map((seat, i) => ({ slot: seat.id, src: o.entries[best![1 - k][i]].id }))
    const meets = meetsOf(s.seats, s.entries, best![k], fixedFrom(o, omap))
    return { map, meets, clashes: meets.reduce((x, m) => x + m.clash.length, 0), tight: meets.reduce((x, m) => x + m.tight.length, 0) }
  }
  return { a: out(0), b: out(1) }
}
