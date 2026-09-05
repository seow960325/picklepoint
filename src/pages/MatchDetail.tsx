import { useEffect, useState } from 'react'
import { useParams } from 'react-router-dom'
import { useCompetition, teamName } from '../lib/store'
import * as api from '../lib/api'
import type { PointEvent } from '../lib/types'
import { Screen, TopBar, Spinner } from '../components/ui'

export default function MatchDetail() {
  const { code, id } = useParams()
  const { bundle } = useCompetition(code)
  const [events, setEvents] = useState<PointEvent[]>([])

  useEffect(() => { if (id) api.matchEvents(id).then(setEvents) }, [id])

  if (!bundle) return <Screen><Spinner /></Screen>
  const m = bundle.matches.find(x => x.id === id)
  if (!m) return <Screen><TopBar title="Match not found" back={`/c/${code}`} /></Screen>

  return (
    <Screen>
      <TopBar
        title={`${teamName(bundle, m.team_a_id)} vs ${teamName(bundle, m.team_b_id)}`}
        sub={`${m.round ?? ''} · ${m.status.replace('_', ' ')}`}
        back={`/c/${code}`}
      />

      <div className="flex items-center justify-center gap-6 border-b border-edge py-6">
        <div className="tabular font-display text-6xl font-bold">{m.score_a}</div>
        <div className="text-2xl text-gray-700">–</div>
        <div className="tabular font-display text-6xl font-bold">{m.score_b}</div>
      </div>

      <div className="p-4">
        <div className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-600">
          Point by point
        </div>
        {events.length === 0 && <div className="py-8 text-center text-sm text-gray-600">No points yet.</div>}
        <div className="space-y-1">
          {events.map((e, i) => (
            <div key={e.id} className="flex items-center gap-3 text-sm">
              <span className="w-8 shrink-0 text-right text-gray-700">{i + 1}</span>
              <span className="min-w-0 flex-1 truncate text-gray-300">{teamName(bundle, e.team_id)}</span>
              <span className="tabular shrink-0 font-semibold">
                {e.score_a_after} – {e.score_b_after}
              </span>
            </div>
          ))}
        </div>
      </div>
    </Screen>
  )
}
