// YC26: the churches taking part. A team is entered under a church (dropdown in Admin > Teams);
// medals are counted per church, not per team name.
import { churchOf } from './draw.ts'

export interface Church { name: string; logo: string }
export const CHURCHES: Church[] = [
  { name: 'GMSJ', logo: '/logos/gmsj.png' },
  { name: 'Kinrara', logo: '/logos/kinrara.png' },
  { name: 'Mega', logo: '/logos/mega.png' },
  { name: 'Mega Subang', logo: '/logos/subang.png' },
  { name: 'Mega Suria', logo: '/logos/suria.png' },
  { name: 'Permai', logo: '/logos/permai.png' },
  { name: 'PJ State', logo: '/logos/pjstate.png' },
  { name: 'Putra Prima', logo: '/logos/putraprima.png' },
]
export const churchLogo = (name: string | null | undefined): string | null =>
  CHURCHES.find(c => c.name.toLowerCase() === String(name ?? '').trim().toLowerCase())?.logo ?? null

/** The church a team plays for: the chosen one, else the name without its A / B / 2 suffix. */
export const teamChurch = (t: { name: string; church?: string | null; logo?: string | null }): string =>
  (t.church ?? '').trim()
  // no church saved but the team carries a church logo: that logo names the church
  || CHURCHES.find(c => !!t.logo && c.logo === t.logo)?.name
  || churchOf(t.name)
