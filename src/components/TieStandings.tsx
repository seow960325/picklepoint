import type { Bundle } from '../lib/types'
import { teamName } from '../lib/store'
import { sportOf, SPORT_ICON, SPORT_LABEL, tieStandings, tiesOf } from '../lib/multisport'

/** Multi-sport competitions only: per-sport group tables (tie points) and the
 *  list of ties with their game scores. */
export default function TieStandings({ b }: { b: Bundle }) {
  return (
    <div className="space-y-8 p-3 lg:p-5">
      {b.events.map(ev => {
        const sport = sportOf(ev)
        const pools = tieStandings(b, ev.id)
        const ties = tiesOf(b, ev.id)
        return (
          <section key={ev.id}>
            <h2 className="mb-3 font-display text-xl font-bold uppercase tracking-widest text-accent">
              {SPORT_ICON[sport]} {ev.name || SPORT_LABEL[sport]}
            </h2>
            <div className="grid gap-3 lg:grid-cols-2">
              {Object.keys(pools).sort().map(pool => (
                <div key={pool} className="overflow-hidden rounded-xl border border-line">
                  <div className="bg-surface px-3 py-1.5 text-xs font-bold uppercase tracking-widest text-fg-muted">
                    Group {pool}
                  </div>
                  <table className="w-full text-sm">
                    <thead className="text-[10px] uppercase tracking-wider text-fg-subtle">
                      <tr>
                        <th className="px-3 py-1.5 text-left">Team</th>
                        <th className="px-2 py-1.5 text-right">P</th>
                        <th className="px-2 py-1.5 text-right">W</th>
                        <th className="px-2 py-1.5 text-right">L</th>
                        <th className="px-2 py-1.5 text-right">Games</th>
                        <th className="px-2 py-1.5 text-right">Pts</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-line">
                      {pools[pool].map(r => (
                        <tr key={r.team.id}>
                          <td className="truncate px-3 py-2">{r.team.name}</td>
                          <td className="tabular px-2 py-2 text-right text-fg-muted">{r.ties}</td>
                          <td className="tabular px-2 py-2 text-right text-fg-muted">{r.tieW}</td>
                          <td className="tabular px-2 py-2 text-right text-fg-muted">{r.tieL}</td>
                          <td className="tabular px-2 py-2 text-right text-fg-muted">{r.gw}–{r.gl}</td>
                          <td className="tabular px-2 py-2 text-right font-bold">{r.pts}</td>
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

            {ties.length > 0 && (
              <div className="mt-4 divide-y divide-line rounded-xl border border-line">
                {ties.map(t => (
                  <div key={t.id} className="px-3 py-2.5 text-sm">
                    <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
                      <span className="truncate text-right">{teamName(b, t.a)}</span>
                      <span className={`tabular font-display font-bold ${t.done ? 'text-brand-ink' : 'text-fg-muted'}`}>
                        {t.aGames}–{t.bGames}
                      </span>
                      <span className="truncate">{teamName(b, t.b)}</span>
                    </div>
                    <div className="mt-1 flex flex-wrap justify-center gap-x-3 text-[11px] text-fg-subtle">
                      {t.games.map(g => (
                        <span key={g.id} className="tabular">
                          {g.game_label} {g.status === 'finished' || g.status === 'live'
                            ? `${g.score_a}–${g.score_b}` : '·'}
                        </span>
                      ))}
                      {t.done && (t.aGames === t.games.length || t.bGames === t.games.length) && (
                        <span className="font-bold text-gold">sweep +1</span>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </section>
        )
      })}
    </div>
  )
}
