// One church event split over several codes: the hub code (YC26) is the
// front page (overview + Total Champion) and hosts Captain Ball itself; each
// pickleball / badminton category is its own code. Everything else in the
// app is untouched: codes not listed here behave exactly as before.
import type { SlotClock } from './timetable'
import { YC26_CLOCKS } from './yc26plan.ts'
export interface HubCat { code: string; label: string; short: string; sport: 'pickleball' | 'badminton' | 'captainball' }
export interface Hub {
  code: string; title: string; onlySport?: 'captainball'; cats: HubCat[]
  /** not a church event: no church filter, no Total Champion / Medals tab */
  noChurch?: boolean
  /** printed timetable: first game (24 h) and minutes per slot */
  clock?: { start: string; every: number; breakAt?: string; breakMins?: number }
  /** per-category printed timetable (YC26): slot start times, knockout slots, real courts */
  clocks?: Record<string, SlotClock>
  /** the day's fixed items before the games (24 h from / to), shown above the categories */
  program?: Array<{ from: string; to: string; label: string; zh?: string }>
  /** venue map image */
  map?: string
  /** event logo (transparent PNG): header and podium */
  logo?: string
  /** header: logo to the right of the title instead of the left */
  logoRight?: boolean
  /** the title split over two rows on a phone */
  titleLines?: [string, string]
  /** draw the event cross as the last letter of this word in the title (YC26: the T of Methodist) */
  crossT?: string
  /** courts of each category on the map (when the category has no printed clock of its own) */
  mapCourts?: Record<string, { sport: 'pickleball' | 'badminton' | 'captainball'; courts: number[] }>
}

export const HUBS: Hub[] = [{
  code: 'YC26',
  title: 'Methodist Games 26',
  crossT: 'Methodist',
  logo: '/logos/yc26.png',
  // the old badminton / pickleball ties inside YC26 are replaced by the category codes
  onlySport: 'captainball',
  clocks: YC26_CLOCKS,
  program: [
    { from: '07:45', to: '08:15', label: 'Registration' },
    { from: '08:15', to: '08:45', label: 'Opening' },
  ],
  map: '/yc26-map.jpg',
  cats: [
    { code: 'YC26', label: 'Captain Ball', short: 'Captain Ball', sport: 'captainball' },
    { code: 'BMMD', label: "Badminton Men's Doubles", short: 'Badminton MD', sport: 'badminton' },
    { code: 'BMXD', label: 'Badminton Mixed Doubles', short: 'Badminton XD', sport: 'badminton' },
    { code: 'PBMD', label: "Pickleball Men's Doubles", short: 'Pickleball MD', sport: 'pickleball' },
    { code: 'PBXD', label: 'Pickleball Mixed Doubles', short: 'Pickleball XD', sport: 'pickleball' },
  ],
}, {
  // Christmas Outreach Pickleball Fundraiser, 14 Nov 2026: one entry for players and
  // supporters. MC26 is only the front page (no competition of its own);
  // Men's Doubles = MCMD (courts 1-3), Mixed Doubles = MCXD (courts 4-6).
  code: 'MC26',
  title: 'Christmas Outreach',
  noChurch: true,
  logo: '/logos/mc26.png',
  map: '/mc26-map.jpg',
  mapCourts: { MCMD: { sport: 'pickleball', courts: [1, 2, 3] }, MCXD: { sport: 'pickleball', courts: [4, 5, 6] } },
  // Derek's plan: games start 9:30 am, one slot every 15 minutes
  // lunch break 12:30, play resumes 12:45: every slot from 12:30 on shifts by 15 min
  clock: { start: '09:30', every: 15, breakAt: '12:30', breakMins: 15 },
  cats: [
    { code: 'MCMD', label: "Men's Doubles", short: "Men's Doubles", sport: 'pickleball' },
    { code: 'MCXD', label: 'Mixed Doubles', short: 'Mixed Doubles', sport: 'pickleball' },
  ],
}, {
  // Hidden test copy of MC26 (no link anywhere; open /c/TESTMC yourself). Filled by the
  // clone SQL: TESTMD = copy of MCMD, TESTXD = copy of MCXD. Delete the two codes after testing.
  code: 'TESTMC',
  title: 'TEST Christmas Outreach',
  noChurch: true,
  logo: '/logos/mc26.png',
  map: '/mc26-map.jpg',
  mapCourts: { TESTMD: { sport: 'pickleball', courts: [1, 2, 3] }, TESTXD: { sport: 'pickleball', courts: [4, 5, 6] } },
  clock: { start: '09:30', every: 15, breakAt: '12:30', breakMins: 15 },
  cats: [
    { code: 'TESTMD', label: "Men's Doubles", short: "Men's Doubles", sport: 'pickleball' },
    { code: 'TESTXD', label: 'Mixed Doubles', short: 'Mixed Doubles', sport: 'pickleball' },
  ],
}]

/** A hub that is only a front page (no competition under its own code). */
export const pageOnly = (h: Hub) => !h.cats.some(c => c.code === h.code)

const up = (c?: string) => (c ?? '').toUpperCase()

/** MC26 Men's / Mixed Doubles (MCMD, MCXD) and their hidden TEST copies (TESTMD,
 *  TESTXD) run a fixed printed draw, so the group regenerate / redraw controls are
 *  greyed out and disabled in the UI. No other competition is affected. */
export const GROUPS_LOCKED_CODES = new Set(['MCMD', 'MCXD', 'TESTMD', 'TESTXD'])
export const groupsLocked = (code?: string) => GROUPS_LOCKED_CODES.has(up(code))
/** The hub a code is the front page of. */
export const hubOf = (code?: string): Hub | null => HUBS.find(h => h.code === up(code)) ?? null
/** The hub a category code belongs to (not the hub itself). */
export const parentHub = (code?: string): Hub | null =>
  HUBS.find(h => h.code !== up(code) && h.cats.some(c => c.code === up(code))) ?? null

/** Fixed colour per category: Men's = blue, Mixed = pink (by name or code); null = not either. */
export function catHue(nameOrCode?: string | null): 0 | 1 | null {
  const x = (nameOrCode ?? '').trim()
  if (/mix|xd$/i.test(x)) return 1
  if (/\bmen|md$/i.test(x)) return 0
  return null
}

/** The page title of a front-page-only hub (MC26) follows the name set in Settings: each category's
 *  competition name is "<title> · <category>", so take the part before the category. The seeded
 *  default name is used only when nobody has renamed anything. */
export function hubTitle(h: Hub, names: Array<string | null | undefined>): string {
  if (!pageOnly(h)) return h.title
  const clean = names.map(n => (n ?? '').trim()).filter(Boolean).map(n => {
    const i = n.lastIndexOf(' · ')
    return (i > 0 ? n.slice(0, i) : n).trim()
  })
  return clean.find(n => n.toLowerCase() !== h.title.toLowerCase()) ?? clean[0] ?? h.title
}
