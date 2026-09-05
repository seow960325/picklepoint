import { useEffect, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useCompetition, teamName } from '../lib/store'
import * as api from '../lib/api'
import type { PointEvent } from '../lib/types'
import { Screen, TopBar, Spinner } from '../components/ui'

const tokenKey = (courtId: string) => `pp.token.${courtId}`
const adminTokKey = (code: string) => `pp.admin.${code}`

export default function MatchDetail() {
  const { code, id } = useParams()
  const navigate = useNavigate()
  const { bundle } = useCompetition(code)
  const [events, setEvents] = useState<PointEvent[]>([])
  const [confirmingReset, setConfirmingReset] = useState(false)
  const [busy, setBusy] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => { if (id) api.matchEvents(id).then(setEvents) }, [id])

  if (!bundle) return <Screen><Spinner /></Screen>
  const m = bundle.matches.find(x => x.id === id)
  if (!m) return <Screen><TopBar title="Match not found" back={`/c/${code}`} /></Screen>

  const court = bundle.courts.find(c => c.id === m.court_id)
  const courtToken = court ? localStorage.getItem(tokenKey(court.id)) : null
  const adminToken = code ? localStorage.getItem(adminTokKey(code)) : null
  const canReset = m.status === 'finished' && !!(courtToken || adminToken)

  const reset = async () => {
    if (!confirmingReset) {
      setConfirmingReset(true)
      resetTimer.current = setTimeout(() => setConfirmingReset(false), 3000)
      return
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setConfirmingReset(false)
    setBusy(true)
    try {
      if (courtToken) {
        await api.resetMatch(m.id, courtToken)
      } else {
        await api.adminResetMatch(adminToken!, m.id)
      }
      if (court) navigate(`/c/${code}/court/${court.number}`)
      else navigate(`/c/${code}`)
    } catch {
      setBusy(false)
    }
  }

  return (
    <Screen>
      <TopBar
        title={`${teamName(bundle, m.team_a_id)} vs ${teamName(bundle, m.team_b_id)}`}
        sub={`${m.round ?? ''} · ${m.status.replace(/_/g, ' ')}`}
        back={`/c/${code}`}
      />

      <div className="flex items-center justify-center gap-6 border-b border-edge py-6">
        <div className="tabular font-display text-6xl font-bold">{m.score_a}</div>
        <div className="text-2xl text-gray-700">–</div>
        <div className="tabular font-display text-6xl font-bold">{m.score_b}</div>
      </div>

      {canReset && (
        <div className="border-b border-edge px-4 py-4">
          <div className="mb-2 text-xs font-bold uppercase tracking-widest text-gray-600">
            Referee controls
          </div>
          <button
            onClick={reset}
            disabled={busy}
            className={`w-full rounded-xl border px-4 py-3 font-display text-sm font-bold tracking-wide transition-colors ${
              confirmingReset
                ? 'border-red-500 bg-red-500/20 text-red-300'
                : 'border-edge bg-panel text-gray-400 active:bg-edge'
            }`}>
            {busy ? 'Resetting…' : confirmingReset ? 'TAP AGAIN TO RESET TO 0–0' : 'RESET MATCH'}
          </button>
          {confirmingReset && (
            <p className="mt-1.5 text-center text-[11px] text-gray-600">
              Tap again to confirm · cancels in 3 s
            </p>
          )}
        </div>
      )}

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
