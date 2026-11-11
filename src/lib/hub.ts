// One church event split over several codes: the hub code (YC2626) is the
// front page (overview + Total Champion) and hosts Captain Ball itself; each
// pickleball / badminton category is its own code. Everything else in the
// app is untouched: codes not listed here behave exactly as before.
export interface HubCat { code: string; label: string; short: string; sport: 'pickleball' | 'badminton' | 'captainball' }
export interface Hub {
  code: string; title: string; onlySport?: 'captainball'; cats: HubCat[]
  /** not a church event: no church filter, no Total Champion / Medals tab */
  noChurch?: boolean
  /** printed timetable: first game (24 h) and minutes per slot */
  clock?: { start: string; every: number }
}

export const HUBS: Hub[] = [{
  code: 'YC2626',
  title: 'YC2626 Church Games',
  // the old badminton / pickleball ties inside YC2626 are replaced by the category codes
  onlySport: 'captainball',
  cats: [
    { code: 'YC2626', label: 'Captain Ball', short: 'Captain Ball', sport: 'captainball' },
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
  // Derek's plan: games start 9:30 am, one slot every 15 minutes
  clock: { start: '09:30', every: 15 },
  cats: [
    { code: 'MCMD', label: "Men's Doubles", short: "Men's Doubles", sport: 'pickleball' },
    { code: 'MCXD', label: 'Mixed Doubles', short: 'Mixed Doubles', sport: 'pickleball' },
  ],
}]

/** A hub that is only a front page (no competition under its own code). */
export const pageOnly = (h: Hub) => !h.cats.some(c => c.code === h.code)

const up = (c?: string) => (c ?? '').toUpperCase()
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
