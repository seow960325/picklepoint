// One church event split over several codes: the hub code (YC2626) is the
// front page (overview + Total Champion) and hosts Captain Ball itself; each
// pickleball / badminton category is its own code. Everything else in the
// app is untouched: codes not listed here behave exactly as before.
export interface HubCat { code: string; label: string; icon: string }
export interface Hub { code: string; title: string; onlySport?: 'captainball'; cats: HubCat[] }

export const HUBS: Hub[] = [{
  code: 'YC2626',
  title: 'YC2626 Church Games',
  // the old badminton / pickleball ties inside YC2626 are replaced by the category codes
  onlySport: 'captainball',
  cats: [
    { code: 'YC2626', label: 'Captain Ball', icon: '🏐' },
    { code: 'BMMD', label: "Badminton Men's Doubles", icon: '🏸' },
    { code: 'BMXD', label: 'Badminton Mixed Doubles', icon: '🏸' },
    { code: 'PBMD', label: "Pickleball Men's Doubles", icon: '🏓' },
    { code: 'PBXD', label: 'Pickleball Mixed Doubles', icon: '🏓' },
  ],
}]

const up = (c?: string) => (c ?? '').toUpperCase()
/** The hub a code is the front page of. */
export const hubOf = (code?: string): Hub | null => HUBS.find(h => h.code === up(code)) ?? null
/** The hub a category code belongs to (not the hub itself). */
export const parentHub = (code?: string): Hub | null =>
  HUBS.find(h => h.code !== up(code) && h.cats.some(c => c.code === up(code))) ?? null
