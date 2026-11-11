import type { Bundle } from '../lib/types'
import { teamName, teamLogo, teamSideName } from '../lib/store'
import { Emblem, Monogram, hasFlag } from './ui'

/** A team's picture if it has one (logo, flag), else its initials. `box` sizes the logo, `ring` the initials. */
export default function TeamMark({ b, id, box = 'h-5 w-7', ring = 'h-7 w-7 text-[11px]' }: { b: Bundle; id: string | null; box?: string; ring?: string }) {
  const logo = teamLogo(b, id), side = teamSideName(b, id)
  if (logo || hasFlag(side)) return <Emblem logo={logo} flagName={side} className={`${box} shrink-0 rounded-[3px]`} />
  return <Monogram name={teamName(b, id)} className={ring} />
}
