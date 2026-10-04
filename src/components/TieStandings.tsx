import type { Bundle } from '../lib/types'
import { teamLogo, teamSideName } from '../lib/store'
import { Emblem } from './ui'
import { sportOf, SPORTS, SPORT_ICON, SPORT_LABEL, SPORT_TONE, tieStandings } from '../lib/multisport'

/** Multi-sport competitions only: per-sport group tables (tie points).
 *  One sport -> its groups side by side; both sports -> one column each.
 *  Tie-by-tie game scores live on the Matches tab. */
export default function TieStandings({ b }: { b: Bundle }) {
  const events = [...b.events].sort((x, y) => SPORTS.indexOf(sportOf(x)) - SPORTS.indexOf(sportOf(y)))
  const both = events.length > 1
  return (
    <div className={`p-3 lg:p-5 ${both ? 'grid gap-8 lg:grid-cols-2' : ''}`}>
      {events.map(ev => {
        const sport = sportOf(ev)
        const tone = SPORT_TONE[sport]
        const pools = tieStandings(b, ev.id)
        return (
          <section key={ev.id} className="min-w-0">
            {both && (
              <h2 className={`mb-3 flex items-center gap-2 font-display text-xl font-bold uppercase tracking-widest ${tone.text}`}>
                <span>{SPORT_ICON[sport]}</span><span>{ev.name || SPORT_LABEL[sport]}</span>
              </h2>
            )}
            <div className={`grid gap-3 ${both ? '' : 'lg:grid-cols-2'}`}>
              {Object.keys(pools).sort().map(pool => (
                <div key={pool} className="overflow-hidden rounded-xl border border-line">
                  <div className={`flex items-center justify-between px-3 py-1.5 text-xs font-bold uppercase tracking-widest ${tone.soft}`}>
                    <span className={tone.text}>Group {pool}</span>
                    <span className="text-[10px] font-semibold normal-case tracking-normal text-fg-subtle">win a game +1 · sweep +1</span>
                  </div>
                  <table className="w-full table-fixed text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
                      <tr>
                        <th className="w-7 px-2 py-1.5 text-center">#</th>
                        <th className="px-1 py-1.5 text-left">Team</th>
                        <th className="w-8 px-1 py-1.5 text-right">P</th>
                        <th className="w-8 px-1 py-1.5 text-right">W</th>
                        <th className="w-8 px-1 py-1.5 text-right">L</th>
                        <th className="w-14 px-1 py-1.5 text-right">Games</th>
                        <th className="w-11 px-2 py-1.5 text-right">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pools[pool].map((r, i) => (
                        <tr key={r.team.id}>
                          <td className="tabular px-2 py-2 text-center text-xs text-fg-subtle">{i + 1}</td>
                          <td className="px-1 py-2">
                            <span className="flex min-w-0 items-center gap-1.5">
                              <Emblem logo={teamLogo(b, r.team.id)} flagName={teamSideName(b, r.team.id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                              <span className="truncate">{r.team.name}</span>
                            </span>
                          </td>
                          <td className="tabular px-1 py-2 text-right text-fg-muted">{r.ties}</td>
                          <td className="tabular px-1 py-2 text-right text-fg-muted">{r.tieW}</td>
                          <td className="tabular px-1 py-2 text-right text-fg-muted">{r.tieL}</td>
                          <td className="tabular px-1 py-2 text-right text-fg-muted">{r.gw}–{r.gl}</td>
                          <td className={`tabular px-2 py-2 text-right font-bold ${tone.text}`}>{r.pts}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              ))}
              {Object.keys(pools).length === 0 && (
                <div className="text-sm text-fg-subtle">No teams yet.</div>
              )}
            </div>
          </section>
        )
      })}
    </div>
  )
}
