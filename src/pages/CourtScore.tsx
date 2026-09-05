import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCompetition, teamName, liveOnCourt, eventOf } from '../lib/store'
import { applyPoint, applyUndo, displayScores, isGameOver, rulesOf } from '../lib/scoring'
import type { Match } from '../lib/types'
import * as api from '../lib/api'
import { enqueue, flush, pending } from '../lib/queue'
import { useWakeLockEffect } from '../lib/wakelock'
import { useLandscape } from '../lib/orientation'
import { tapPoint, tapUndo, hornEnd, chimeSwitch } from '../lib/feedback'
import { Screen, Spinner, FullscreenButton, Flag } from '../components/ui'
import Court from '../components/Court'

const tokenKey = (courtId: string) => `pp.token.${courtId}`

export default function CourtScore() {
  const { code, number } = useParams()
  const { bundle, reload } = useCompetition(code)
  const court = bundle?.courts.find(c => c.number === Number(number))
  const [token, setToken] = useState<string | null>(
    court ? localStorage.getItem(tokenKey(court.id)) : null)

  useEffect(() => { if (court) setToken(localStorage.getItem(tokenKey(court.id))) }, [court?.id])
  useEffect(useWakeLockEffect, [])

  if (!bundle) return <Screen><Spinner /></Screen>
  if (!court) return (
    <Screen className="flex items-center justify-center">
      <div className="text-gray-500">Court {number} not found</div>
    </Screen>
  )

  if (!token) return (
    <PinGate courtId={court.id} courtNo={court.number} code={code!}
      onUnlock={t => { localStorage.setItem(tokenKey(court.id), t); setToken(t) }} />
  )

  const match = liveOnCourt(bundle, court.id)
  if (!match) {
    const courtDone = bundle.matches
      .filter(m => m.court_id === court.id && m.status === 'finished')
      .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
    return (
      <Screen className="flex flex-col items-center justify-center gap-4 px-6">
        <div className="font-display text-3xl font-bold text-gray-600">COURT {court.number}</div>
        {courtDone.length > 0 ? (
          <>
            <div className="text-sm text-gray-500">All matches complete — tap a result to review or reset.</div>
            <div className="w-full max-w-xs space-y-2">
              {courtDone.slice(0, 5).map(fm => (
                <Link key={fm.id} to={`/c/${code}/match/${fm.id}`}
                  className="flex items-center justify-between rounded-xl border border-edge px-4 py-3 text-sm active:bg-panel">
                  <span className="min-w-0 truncate text-gray-300">
                    {teamName(bundle, fm.team_a_id)} vs {teamName(bundle, fm.team_b_id)}
                  </span>
                  <span className="ml-2 shrink-0 font-bold tabular text-gray-400">
                    {fm.score_a}–{fm.score_b}
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-gray-500">No match assigned yet.</div>
        )}
        <Link to={`/c/${code}`} className="rounded-xl border border-edge px-4 py-2 text-sm">Back to board</Link>
      </Screen>
    )
  }

  return (
    <Scorer key={match.id} bundle={bundle} match={match} token={token}
      courtNo={court.number} code={code!} reload={reload} />
  )
}

// --------------------------------------------------------------- PIN gate
function PinGate({ courtId, courtNo, code, onUnlock }: {
  courtId: string; courtNo: number; code: string; onUnlock: (t: string) => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    setBusy(true)
    try { onUnlock(await api.unlockCourt(courtId, value)) }
    catch { setErr(true); setPin(''); navigator.vibrate?.([60, 40, 60]) }
    finally { setBusy(false) }
  }
  const press = (d: string) => {
    setErr(false)
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) submit(next)
  }

  // landscape: identity on the left, keypad on the right
  return (
    <div className="fixed inset-0 flex items-center justify-center gap-10 bg-ink px-8">
      <Link to={`/c/${code}`} className="absolute left-4 top-3 text-sm text-gray-600">← board</Link>

      <div className="text-right">
        <div className="font-display text-5xl font-bold tracking-widest text-gray-500">
          COURT {courtNo}
        </div>
        <div className="mt-1 text-sm text-gray-600">Scorer PIN</div>
        <div className="mt-5 flex justify-end gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${
              err ? 'border-red-500' : pin.length > i ? 'border-lime bg-lime' : 'border-edge'}`} />
          ))}
        </div>
        {api.IS_DEMO && (
          <div className="mt-5 text-xs text-gray-600">
            Demo PIN: <span className="font-bold text-gray-400">{String(courtNo).padStart(4, '0')}</span>
          </div>
        )}
      </div>

      <div className="grid w-64 grid-cols-3 gap-2.5">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} disabled={!k || busy}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k && press(k)}
            className={`h-14 rounded-xl font-display text-2xl font-bold ${
              k ? 'border border-edge bg-panel active:bg-edge' : 'invisible'}`}>
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- scorer
function Scorer({ bundle, match, token, courtNo, code, reload }: {
  bundle: any; match: Match; token: string; courtNo: number; code: string; reload: () => void
}) {
  const rules = useMemo(() => rulesOf(eventOf(bundle, match)), [bundle, match.event_id])
  const [m, setM] = useState<Match>(match)
  const [showSwitch, setShowSwitch] = useState(false)
  const [offline, setOffline] = useState(pending() > 0)
  const [ignoreRotate, setIgnoreRotate] = useState(false)
  const landscape = useLandscape()
  const history = useRef<[number, number][]>([])

  useEffect(() => { setM(match) }, [match.id, match.score_a, match.score_b, match.status, match.a_on_left])

  const sync = async () => {
    await flush(async op => {
      if (op.kind === 'score') await api.scorePoint(op.matchId, op.side!, token, op.id)
      if (op.kind === 'undo') await api.undoPoint(op.matchId, token)
      if (op.kind === 'confirm') await api.confirmMatch(op.matchId, token)
    })
    setOffline(pending() > 0)
    reload()
  }

  useEffect(() => {
    window.addEventListener('online', sync)
    const t = setInterval(() => { if (pending()) sync() }, 5000)
    return () => { window.removeEventListener('online', sync); clearInterval(t) }
  }, [])

  const score = async (side: 'left' | 'right') => {
    if (m.status === 'finished' || m.status === 'awaiting_confirm') return
    const before = m
    const next = applyPoint(m, side, rules)
    history.current.push([before.score_a, before.score_b])
    setM(next)
    tapPoint()
    if (next.sides_switched && !before.sides_switched) { setShowSwitch(true); chimeSwitch() }
    if (next.status === 'awaiting_confirm') hornEnd()

    const evId = crypto.randomUUID()
    try {
      setM(await api.scorePoint(m.id, side, token, evId))
      setOffline(pending() > 0)
    } catch {
      enqueue({ id: evId, kind: 'score', matchId: m.id, side, at: Date.now() })
      setOffline(true)
    }
  }

  const undo = async () => {
    const snapshot = m
    const prev = history.current.pop()
    if (prev) setM(applyUndo(m, prev[0], prev[1], rules))
    tapUndo()
    try { setM(await api.undoPoint(m.id, token)) }
    catch {
      // undo_point is not idempotent, so we never queue it — a lost response
      // would double-delete on replay. Revert so local matches the server.
      if (prev) history.current.push(prev)
      setM(snapshot)
      setOffline(pending() > 0)
    }
  }

  const confirm = async () => {
    try { await api.confirmMatch(m.id, token); reload() }
    catch { enqueue({ id: crypto.randomUUID(), kind: 'confirm', matchId: m.id, at: Date.now() }); setOffline(true); reload() }
  }

  const [confirmingReset, setConfirmingReset] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reset = async () => {
    if (!confirmingReset) {
      setConfirmingReset(true)
      resetTimer.current = setTimeout(() => setConfirmingReset(false), 3000)
      return
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setConfirmingReset(false)
    history.current = []
    setM(await api.resetMatch(m.id, token))
  }

  const s = displayScores(m)
  const leftName = teamName(bundle, m.a_on_left ? m.team_a_id : m.team_b_id)
  const rightName = teamName(bundle, m.a_on_left ? m.team_b_id : m.team_a_id)
  const ev = eventOf(bundle, m)
  const sideName = (teamId: string | null): string | null => {
    const t = bundle.teams.find((x: typeof bundle.teams[number]) => x.id === teamId)
    if (!t?.side) return null
    return (t.side === 'A' ? ev.side_a_name : ev.side_b_name) ?? null
  }
  const leftTeamId = m.a_on_left ? m.team_a_id : m.team_b_id
  const rightTeamId = m.a_on_left ? m.team_b_id : m.team_a_id
  // SWAP persists to the server (a_on_left) so the live board and TV mirror it.
  const swap = async () => {
    setM(prev => ({ ...prev, a_on_left: !prev.a_on_left }))
    try { setM(await api.flipSides(m.id, token)) }
    catch { setM(prev => ({ ...prev, a_on_left: !prev.a_on_left })) } // revert; retry when online
  }
  const matchNo = bundle.matches
    .filter((x: typeof bundle.matches[number]) => x.court_id === m.court_id)
    .sort((a: typeof bundle.matches[number], b: typeof bundle.matches[number]) => a.sequence - b.sequence)
    .findIndex((x: typeof bundle.matches[number]) => x.id === m.id) + 1
  const done = m.status === 'awaiting_confirm' || isGameOver(m.score_a, m.score_b, rules)
  const hi = Math.max(m.score_a, m.score_b), lo = Math.min(m.score_a, m.score_b)
  const matchPoint = !done && hi >= rules.target_score - 1 && hi - lo >= rules.win_by - 1
  const recentDone = useMemo(() =>
    bundle.matches
      .filter((x: typeof bundle.matches[number]) => x.court_id === m.court_id && x.status === 'finished')
      .sort((a: typeof bundle.matches[number], b: typeof bundle.matches[number]) =>
        (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))[0],
    [bundle.matches, m.court_id]
  )

  if (!landscape && !ignoreRotate) return <RotatePrompt onIgnore={() => setIgnoreRotate(true)} />

  return (
    <div className="fixed inset-0 flex bg-ink no-select"
      style={{
        paddingTop: 'env(safe-area-inset-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}>
      {/* court fills everything left of the control rail */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex shrink-0 items-center justify-between gap-2 px-3 py-2">
          <Link to={`/c/${code}`}
            className="flex shrink-0 items-center gap-1 rounded-xl border border-edge bg-panel/80 px-4 py-2 font-display text-sm font-bold tracking-wide text-gray-200 active:bg-edge">
            ← BOARD
          </Link>
          <div className="flex min-w-0 items-baseline gap-2 truncate font-display font-bold tracking-widest text-gray-300">
            <span className="text-base sm:text-lg">COURT {courtNo} · MATCH {matchNo}</span>
            {matchPoint && <span className="shrink-0 animate-pulse text-sm text-lime">MATCH POINT</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[11px]">
            <FullscreenButton className="h-5 w-5 shrink-0 text-gray-500 active:text-gray-300" />
            {recentDone && (
              <Link to={`/c/${code}/match/${recentDone.id}`} className="text-gray-500 underline underline-offset-2">
                PREV
              </Link>
            )}
            <div title={offline ? 'Points saved on this device, waiting to reach the server' : 'All points saved to the server'}
              className={offline ? 'text-amber-400' : 'text-gray-600'}>
              {offline ? `⚠ ${pending()} to sync` : '● synced'}
            </div>
          </div>
        </div>

        <div className="relative min-h-0 flex-1 px-2 pb-2">
          <Court
            leftName={leftName} rightName={rightName}
            leftScore={s.left} rightScore={s.right}
            leftFlag={sideName(leftTeamId)} rightFlag={sideName(rightTeamId)}
            onTap={score} disabled={done}
          />

          {/* SWAP left/right — top centre of the court, persists to the board */}
          <button onClick={swap}
            className="absolute left-1/2 top-0.5 -translate-x-1/2 rounded-lg border border-edge bg-panel/90 px-3 py-1 font-display text-xs font-bold tracking-wide text-gray-300 active:scale-95">
            ⇄ SWAP
          </button>

        </div>
      </div>

      {/* control rail */}
      <div className="flex w-[74px] shrink-0 flex-col items-center justify-center gap-2.5 border-l border-edge px-2 py-2">
        <button onClick={undo} aria-label="Undo"
          className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-edge bg-panel text-gray-300 active:bg-edge">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-2" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">UNDO</span>
        </button>
        <button onClick={reset} aria-label="Reset"
          className={`flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border active:bg-edge ${
            confirmingReset
              ? 'border-red-500 bg-red-500/20 text-red-300'
              : 'border-edge bg-panel text-gray-400'}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">
            {confirmingReset ? 'SURE?' : 'RESET'}
          </span>
        </button>
        <Link to={`/c/${code}/match/${m.id}`} aria-label="Point log"
          className="flex h-20 w-full flex-col items-center justify-center gap-1.5 rounded-2xl border border-edge bg-panel text-gray-400 active:bg-edge">
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round">
            <path d="M9 6h11M9 12h11M9 18h11" />
            <circle cx="4.5" cy="6" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="12" r="1.2" fill="currentColor" stroke="none" />
            <circle cx="4.5" cy="18" r="1.2" fill="currentColor" stroke="none" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">LOG</span>
        </Link>
      </div>

      {showSwitch && (
        <button onClick={() => setShowSwitch(false)}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-lime px-8 text-ink">
          <div className="font-display text-6xl font-bold leading-none tracking-tight">SWITCH ENDS</div>
          <div className="text-center text-base font-semibold">
            Score reached {rules.switch_at}. Players change sides —
            the court has flipped to match.
          </div>
          <div className="rounded-2xl bg-ink/15 px-8 py-3 font-display text-xl font-bold">
            TAP TO CONTINUE
          </div>
        </button>
      )}

      {done && (
        <div className="absolute inset-0 z-30 flex items-center justify-center gap-10 bg-ink px-10">
          <div className="w-full max-w-sm space-y-2">
            <div className="mb-3 font-display text-xl font-bold tracking-widest text-gray-500">GAME</div>
            <ResultRow name={leftName} flag={sideName(leftTeamId)} score={s.left} win={s.left > s.right} />
            <ResultRow name={rightName} flag={sideName(rightTeamId)} score={s.right} win={s.right > s.left} />
          </div>
          <div className="w-56 space-y-3">
            <div className="text-sm text-gray-500">
              Both captains check the score before confirming.
            </div>
            <button onClick={confirm}
              className="w-full rounded-2xl bg-lime py-4 font-display text-xl font-bold text-ink">
              CONFIRM
            </button>
            <button onClick={undo}
              className="w-full rounded-2xl border border-edge py-4 font-display text-xl font-bold text-gray-300">
              REVIEW
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({ name, flag, score, win }: {
  name: string; flag?: string | null; score: number; win: boolean
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
      win ? 'border-lime bg-lime/10' : 'border-edge'}`}>
      <span className="flex min-w-0 items-center gap-2">
        <Flag name={flag} className="h-5 w-auto shrink-0 rounded-[2px]" />
        <span className="truncate font-display text-xl font-bold">{name}</span>
      </span>
      <span className="tabular font-display text-4xl font-bold">{score}</span>
    </div>
  )
}

function RotatePrompt({ onIgnore }: { onIgnore: () => void }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-ink px-10">
      <svg viewBox="0 0 120 80" className="w-40 text-lime">
        <rect x="34" y="4" width="52" height="72" rx="7" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.35" />
        <rect x="8" y="20" width="104" height="40" rx="7" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M92 12 a30 30 0 0 1 14 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M100 6 l7 7 -8 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-center">
        <div className="font-display text-3xl font-bold tracking-wide">ROTATE YOUR PHONE</div>
        <div className="mt-1 text-sm text-gray-500">
          The court view needs landscape so both halves stay big enough to tap.
        </div>
      </div>
      <button onClick={onIgnore} className="text-xs text-gray-600 underline underline-offset-4">
        score in portrait anyway
      </button>
    </div>
  )
}
