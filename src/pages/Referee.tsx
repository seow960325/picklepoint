/** /c/HUB/referee — the one place referees (and the organiser) start: every
 *  court of every category of the event. Each court still asks for its PIN. */
import { SportIcon } from '../components/SportIcon'
import { Link, useParams } from 'react-router-dom'
import { useCompetition } from '../lib/store'
import { hubOf, pageOnly } from '../lib/hub'
import { sportBundle } from '../lib/multisport'
import { useOthers } from '../components/HubOverview'
import { Screen, Spinner } from '../components/ui'

export default function Referee() {
  const { code = '' } = useParams()
  const hub = hubOf(code)
  const self = useCompetition(hub && pageOnly(hub) ? undefined : code)
  const others = useOthers(hub ? hub.cats.map(c => c.code).filter(c => c !== hub.code) : [], 60000)
  if (!hub) return <Screen className="p-6 text-center text-fg-muted">No referee page for {code}.</Screen>
  if (!pageOnly(hub) && self.loading) return <Screen><Spinner /></Screen>
  const own = self.bundle && hub.onlySport ? sportBundle(self.bundle, hub.onlySport) : self.bundle
  const bundleOf = (c: string) => (c === hub.code ? own : others[c] ?? null)

  return (
    <div className="min-h-screen bg-canvas px-4 py-5 text-fg" style={{ paddingTop: 'max(var(--pp-top), 1.25rem)' }}>
      <div className="mx-auto max-w-3xl">
        <div className="mb-5 flex items-center justify-between gap-2">
          <div>
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-fg-subtle">Referees only</div>
            <h1 className="font-display text-2xl font-black">{hub.title}</h1>
          </div>
          <Link to={`/c/${hub.code}`} className="rounded-lg border border-line px-3 py-2 text-sm text-fg-muted">← Board</Link>
        </div>
        <p className="mb-4 text-sm text-fg-muted">Tap your court, then enter its PIN.</p>
        <div className="space-y-4">
          {hub.cats.map(cat => {
            const b = bundleOf(cat.code)
            const courts = b ? [...b.courts].sort((x, y) => x.number - y.number) : []
            return (
              <section key={cat.code} className="rounded-xl border border-line bg-surface p-3">
                <div className="mb-2 flex items-center justify-between gap-2">
                  <div className="font-display text-lg font-bold"><SportIcon sport={cat.sport} /> {cat.label}</div>
                  <Link to={`/c/${cat.code}/admin`} className="text-xs text-fg-subtle underline underline-offset-4">organiser settings</Link>
                </div>
                {!b ? <div className="text-sm text-fg-muted">Loading…</div> : (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {courts.map(ct => {
                      const live = b.matches.find(m => m.court_id === ct.id && (m.status === 'live' || m.status === 'awaiting_confirm'))
                      return (
                        <Link key={ct.id} to={`/c/${cat.code}/court/${ct.number}`}
                          className="rounded-xl border border-line bg-canvas px-3 py-3 text-center active:bg-surface-2">
                          <div className="font-display text-lg font-bold">{ct.label ?? `Court ${ct.number}`}</div>
                          <div className={`text-[11px] ${live ? 'text-red-400' : 'text-fg-subtle'}`}>{live ? '● game on' : 'idle'}</div>
                        </Link>
                      )
                    })}
                  </div>
                )}
              </section>
            )
          })}
        </div>
      </div>
    </div>
  )
}
