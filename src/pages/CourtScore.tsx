import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCompetition, teamName, liveOnCourt, eventOf } from '../lib/store'
import { applyPoint, applyUndo, displayScores, isGameOver, rulesOf, servingSide, serverCourt as serverCourtOf, scoreCall, activeServerNo, type UndoState } from '../lib/scoring'
import type { Match } from '../lib/types'
import * as api from '../lib/api'
import { enqueue, flush, pending, stalledCount, retryStalled, lastQueueError, isPermanentError, peekAll, drop, courtSession, saveCourtSession } from '../lib/queue'
import { useWakeLockEffect } from '../lib/wakelock'
import { useLandscape } from '../lib/orientation'
import { tapPoint, tapFault, tapUndo, hornEnd, chimeSwitch, isSoundOn, setSoundOn } from '../lib/feedback'
import { Screen, Spinner, FullscreenButton, Flag, Emblem } from '../components/ui'
import Court from '../components/Court'
import { PlayClock } from '../components/GroupsKo'
import { koCourtLabel, isCb, sportBundle } from '../lib/multisport'
import { cbKo, cbKoGame } from '../lib/captainball'
import { courtChoices, gameTitle } from '../lib/pool'
import CbScorer from './CbScorer'
import { autoSeedRows } from '../lib/autoseed'

export default function CourtScore() {
  const { code, number } = useParams()
  const { bundle, refreshLive } = useCompetition(code)
  const reload = refreshLive
  const court = bundle?.courts.find(c => c.number === Number(number))
  const [picked, setTokenState] = useState<string | null>(null)
  const [showRelogin, setShowRelogin] = useState(false)
  const [picking, setPicking] = useState(false)
  // PIN every time the court is opened — except coming straight back from the point
  // log in this same tab (short-lived session, see courtSession). Read during render
  // so the PIN pad never flashes up first.
  const token = picked ?? (court ? courtSession(court.id) : null)
  const setToken = (t: string | null) => { setTokenState(t); if (court) saveCourtSession(court.id, t) }
  // knockout seeds itself: the referee whose confirm finishes the last group game writes the draw
  const seeding = useRef(false)
  useEffect(() => {
    if (!bundle || !token || seeding.current) return
    for (const ev of bundle.events) {
      const rows = autoSeedRows(bundle, ev)
      if (!rows) continue
      seeding.current = true
      api.courtSeedBracket(token, ev.id, rows).catch(() => {}).finally(() => { seeding.current = false; refreshLive() })
      break
    }
  })
  // captain ball: the next knockout stage (playoff, semi-finals, 3rd place + Final) is created from the
  // captain ball referee's screen as soon as the stage before it is decided (needs migration 0062;
  // without it the call fails quietly and the organiser's Settings page creates it, as before)
  const cbFired = useRef('')
  useEffect(() => {
    if (!bundle || !token || court?.sport !== 'captainball') return
    const sb = sportBundle(bundle, 'captainball')
    const cev = sb.events[0]
    const k = cev ? cbKo(sb, cev) : null
    if (!cev || !k || !k.supported || !k.next?.ready) return
    const key = `${cev.id}|${k.next.label}|${Object.keys(k.games).sort().join(',')}`
    if (cbFired.current === key) return
    cbFired.current = key
    const pairs = k.next.pairs
    void (async () => {
      let pending = 0
      for (const p of pairs) {
        const g = cbKoGame({ ...sb, matches: [...sb.matches] }, p.stage, p.a, p.b, 0)
        try { await api.courtAddTieStage(token, cev.id, p.stage, [{ ...g, seq: ++pending }]) }
        catch (e: any) {
          // already there = fine; anything else (poor network): try again in a while
          if (!/STAGE_EXISTS/.test(String(e?.message))) setTimeout(() => { if (cbFired.current === key) cbFired.current = '' }, 20000)
        }
      }
      refreshLive()
    })()
  })
  // keep the session fresh while the referee is on this screen
  useEffect(() => {
    if (!token || !court) return
    const id = setInterval(() => saveCourtSession(court.id, token), 60000)
    return () => clearInterval(id)
  }, [token, court?.id])

  useEffect(useWakeLockEffect, [])

  if (!bundle) return <Screen><Spinner /></Screen>
  // multi-sport codes number courts per sport ("Captain Ball 1", "Badminton 3"), not 1..9 across all sports
  const named = !!bundle.competition.multi_sport && !!court?.label
  const cname = named ? court!.label!.toUpperCase() : `COURT ${court?.number}`
  const cshort = named ? court!.label!.toUpperCase() : `Court ${court?.number}`
  if (!court) return (
    <Screen className="flex items-center justify-center">
      <div className="text-fg-muted">Court {number} not found</div>
    </Screen>
  )

  if (!token) return (
    <PinGate courtId={court.id} courtNo={court.number} courtName={cname} code={code!}
      onUnlock={t => setToken(t)} />
  )

  const match = liveOnCourt(bundle, court.id)
  if (!match) {
    const courtDone = bundle.matches
      .filter(m => m.court_id === court.id && m.status === 'finished')
      .sort((a, b) => (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))
    // games still to come on this court: its own queue, or (shared-queue events)
    // a waiting home game that starts as soon as both teams are off court
    const waiting = bundle.matches
      .filter(m => m.status === 'scheduled' && (m.court_id === court.id || (m.court_id == null && m.home_court === court.id)))
      .sort((a, b) => a.sequence - b.sequence)[0]
    const busyOn = waiting ? bundle.matches.find(x => x.id !== waiting.id
      && (x.status === 'live' || x.status === 'awaiting_confirm')
      && [x.team_a_id, x.team_b_id].some(t => t && (t === waiting.team_a_id || t === waiting.team_b_id))) : undefined
    const busyTeam = busyOn ? [waiting!.team_a_id, waiting!.team_b_id].find(t => t === busyOn.team_a_id || t === busyOn.team_b_id) ?? null : null
    const busyCourt = busyOn ? bundle.courts.find(c => c.id === busyOn.court_id) : undefined
    // printed slots (migration 0039): the game waits for the earlier slot to finish
    const slotWait = !busyTeam && waiting?.slot != null
      ? bundle.matches.filter(x => x.event_id === waiting.event_id && x.bracket_key == null && x.slot != null
          && x.slot < waiting.slot! && x.status !== 'finished').sort((x, y) => x.slot! - y.slot!)[0]
      : undefined
    if (waiting) return (
      <Screen className="flex flex-col items-center justify-center gap-4 px-6 text-center">
        <div className="font-display text-3xl font-bold text-fg-subtle">{cname}</div>
        <div className="text-xs font-bold uppercase tracking-[0.2em] text-fg-subtle">Next game</div>
        <div className="max-w-md font-display text-2xl font-bold">
          {teamName(bundle, waiting.team_a_id)} <span className="text-fg-subtle">vs</span> {teamName(bundle, waiting.team_b_id)}
        </div>
        <div className="flex items-center gap-2 text-sm text-fg-muted">
          <span className="h-2 w-2 animate-pulse rounded-full bg-brand" />
          {busyTeam
            ? <>Waiting for {teamName(bundle, busyTeam)} to finish on {busyCourt?.label && bundle.competition.multi_sport ? busyCourt.label : `Court ${busyCourt?.number ?? ''}`} — starts by itself.</>
            : slotWait ? <>Starts by itself when slot {slotWait.slot} has finished (Court {bundle.courts.find(c => c.id === slotWait.court_id)?.number ?? '–'} still playing).</>
            : <>Starts by itself in a moment.</>}
        </div>
        <div className="flex flex-wrap items-center justify-center gap-2">
          {courtChoices(bundle, court.id).length > 1 && (
            <button onClick={() => setPicking(true)}
              className="flex min-h-[40px] items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold active:bg-surface-2">
              <PickIcon className="h-4 w-4" /> Play a different game
            </button>
          )}
          <Link to={`/c/${code}`} className="flex min-h-[40px] items-center rounded-xl border border-line px-4 py-2 text-sm">Back to board</Link>
        </div>
        {picking && <GamePicker bundle={bundle} courtId={court.id} courtName={cname} token={token}
          onClose={() => setPicking(false)} onDone={() => { setPicking(false); reload() }} />}
      </Screen>
    )
    return (
      <Screen className="flex flex-col items-center justify-center gap-4 px-6">
        <div className="font-display text-3xl font-bold text-fg-subtle">{cname}</div>
        {courtDone.length > 0 ? (
          <>
            <div className="text-center text-sm text-fg-muted">
              {bundle.matches.some(m => m.status !== 'finished' && (m.bracket_key != null || m.tie_stage != null || m.court_id == null))
                ? 'No game on this court right now — the next one appears here by itself. Tap a result to review.'
                : 'All matches complete — tap a result to review or reset.'}
            </div>
            <div className="w-full max-w-xs space-y-2">
              {courtDone.slice(0, 5).map(fm => (
                <Link key={fm.id} to={`/c/${code}/match/${fm.id}`}
                  className="flex items-center justify-between rounded-xl border border-line px-4 py-3 text-sm active:bg-surface">
                  <span className="min-w-0 truncate text-fg-muted">
                    {teamName(bundle, fm.team_a_id)} vs {teamName(bundle, fm.team_b_id)}
                  </span>
                  <span className="ml-2 shrink-0 font-bold tabular text-fg-muted">
                    {fm.score_a}–{fm.score_b}
                  </span>
                </Link>
              ))}
            </div>
          </>
        ) : (
          <div className="text-sm text-fg-muted">No match assigned yet.</div>
        )}
        <Link to={`/c/${code}`} className="rounded-xl border border-line px-4 py-2 text-sm">Back to board</Link>
      </Screen>
    )
  }

  const Sc = isCb(eventOf(bundle, match)?.sport) ? CbScorer : Scorer
  return (
    <>
      <Sc key={match.id} bundle={bundle} match={match} token={token}
        courtNo={court.number} courtName={cname} courtShort={cshort} code={code!} reload={reload}
        onRelogin={() => setShowRelogin(true)} onPick={() => setPicking(true)} />
      {picking && <GamePicker bundle={bundle} courtId={court.id} courtName={cname} token={token} current={match}
        onClose={() => setPicking(false)} onDone={() => { setPicking(false); reload() }} />}
      {showRelogin && (
        <PinModal courtId={court.id} courtNo={court.number} courtName={cname}
          onUnlock={t => { setToken(t); setShowRelogin(false) }}
          onCancel={() => setShowRelogin(false)} />
      )}
    </>
  )
}

// --------------------------------------------------------------- PIN gate
function PinGate({ courtId, courtNo, courtName, code, onUnlock }: {
  courtId: string; courtNo: number; courtName: string; code: string; onUnlock: (t: string) => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    setBusy(true)
    try { onUnlock(await api.unlockCourt(courtId, value)) }
    catch (e: any) {
      setErr(true); setPin(''); navigator.vibrate?.([60, 40, 60])
      setLocked(e?.message === 'LOCKED')
    }
    finally { setBusy(false) }
  }
  const press = (d: string) => {
    setErr(false)
    setLocked(false)
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) submit(next)
  }

  // landscape: identity on the left, keypad on the right
  return (
    <div className="fixed inset-0 flex items-center justify-center gap-10 bg-canvas px-8">
      <Link to={`/c/${code}`} className="absolute left-4 top-3 text-sm text-fg-subtle">← board</Link>

      <div className="text-right">
        <div className="font-display text-5xl font-bold tracking-widest text-fg-muted">
          {courtName}
        </div>
        <div className="mt-1 text-sm text-fg-subtle">Scorer PIN</div>
        {locked && (
          <div className="mt-2 text-xs font-semibold text-red-500">Too many attempts — try again in a minute</div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${
              err ? 'border-red-500' : pin.length > i ? 'border-brand bg-brand' : 'border-line'}`} />
          ))}
        </div>
        {api.IS_DEMO && (
          <div className="mt-5 text-xs text-fg-subtle">
            Demo PIN: <span className="font-bold text-fg-muted">{String(courtNo).padStart(4, '0')}</span>
          </div>
        )}
      </div>

      <div className="grid w-64 grid-cols-3 gap-2.5">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} disabled={!k || busy}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k && press(k)}
            className={`h-14 rounded-xl font-display text-2xl font-bold ${
              k ? 'border border-line bg-surface active:bg-surface-2' : 'invisible'}`}>
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

// ------------------------------------------------ re-login modal (in place)
function PinModal({ courtId, courtNo, courtName, onUnlock, onCancel }: {
  courtId: string; courtNo: number; courtName: string; onUnlock: (t: string) => void; onCancel: () => void
}) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [locked, setLocked] = useState(false)
  const [busy, setBusy] = useState(false)

  const submit = async (value: string) => {
    setBusy(true)
    try { onUnlock(await api.unlockCourt(courtId, value)) }
    catch (e: any) {
      setErr(true); setPin(''); navigator.vibrate?.([60, 40, 60])
      setLocked(e?.message === 'LOCKED')
    }
    finally { setBusy(false) }
  }
  const press = (d: string) => {
    setErr(false)
    setLocked(false)
    const next = (pin + d).slice(0, 4)
    setPin(next)
    if (next.length === 4) submit(next)
  }

  return (
    <div className="absolute inset-0 z-40 flex items-center justify-center gap-8 bg-canvas/95 px-8">
      <div className="text-right">
        <div className="font-display text-3xl font-bold tracking-widest text-fg-muted">
          {courtName}
        </div>
        <div className="mt-1 text-sm text-red-400">Session expired — re-enter PIN to resume</div>
        {locked && (
          <div className="mt-2 text-xs font-semibold text-red-500">Too many attempts — try again in a minute</div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${
              err ? 'border-red-500' : pin.length > i ? 'border-brand bg-brand' : 'border-line'}`} />
          ))}
        </div>
        <button type="button" onClick={onCancel} className="mt-5 text-sm text-fg-subtle underline">
          cancel
        </button>
      </div>

      <div className="grid w-64 grid-cols-3 gap-2.5">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} disabled={!k || busy}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k && press(k)}
            className={`h-14 rounded-xl font-display text-2xl font-bold ${
              k ? 'border border-line bg-surface active:bg-surface-2' : 'invisible'}`}>
            {k}
          </button>
        ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------------- scorer
function Scorer({ bundle, match, token, courtNo, courtName, courtShort, code, reload, onRelogin, onPick }: {
  bundle: any; match: Match; token: string; courtNo: number; courtName?: string; courtShort?: string; code: string; reload: () => void
  onRelogin: () => void; onPick?: () => void
}) {
  const rules = useMemo(() => rulesOf(eventOf(bundle, match), match), [bundle, match.event_id, match.bracket_key])
  const [m, setM] = useState<Match>(match)
  const [showSwitch, setShowSwitch] = useState(false)
  // First-serve picker: pops up before the court is usable, once per match —
  // dismissed the moment a side is chosen (score staying 0-0 doesn't reopen it).
  const [serverPicked, setServerPicked] = useState(false)
  const [offline, setOffline] = useState(pending() > 0)
  const [stuck, setStuck] = useState(stalledCount() > 0)
  const [errMsg, setErrMsg] = useState(lastQueueError())
  const looksLikeAuth = !!errMsg && /token|pin|unauthoriz|expired|permission|session/i.test(errMsg)
  const [ignoreRotate, setIgnoreRotate] = useState(false)

  // session expired → auto-pop the PIN modal silently (no error shown)
  useEffect(() => {
    if (looksLikeAuth) onRelogin()
  }, [looksLikeAuth])
  const landscape = useLandscape()
  const history = useRef<[number, number, UndoState][]>([])
  const prevToken = useRef(token)

  // ---- no flash-back: the screen shows the referee's own taps first ----
  // Server pushes (realtime refresh) can carry a snapshot read BEFORE the latest tap,
  // and responses can arrive out of order. So: requests go out one at a time, only the
  // newest response is shown, and a pushed copy of the match is adopted only when the
  // read that produced it started AFTER this device's last save came back (so it must
  // already contain every tap), and nothing is in flight or queued.
  const seq = useRef(0)
  const inflight = useRef(0)
  const lastSaved = useRef(0)            // Date.now() when the newest server answer arrived
  const chain = useRef<Promise<unknown>>(Promise.resolve())
  const latest = useRef({ match, at: bundle.fetched_at ?? 0 })
  latest.current = { match, at: bundle.fetched_at ?? 0 }
  const settle = useRef<ReturnType<typeof setTimeout> | undefined>(undefined)
  const adopt = () => {
    clearTimeout(settle.current)
    if (inflight.current > 0 || pending() > 0) { settle.current = setTimeout(adopt, 300); return }
    // a copy read before our last save may be missing taps: keep what is on screen
    if (latest.current.at && latest.current.at < lastSaved.current) return
    setM(latest.current.match)
  }
  useEffect(() => () => clearTimeout(settle.current), [])
  const curId = useRef(match.id)
  useEffect(() => {
    if (curId.current !== match.id) { curId.current = match.id; clearTimeout(settle.current); setM(match); return }
    adopt()
  }, [match.id, match.score_a, match.score_b, match.status, match.a_on_left, match.serving_team, match.server_no, match.initial_server, bundle.fetched_at])
  /** send one change to the server, in order; show its result only if nothing newer was tapped since */
  const send = (fn: () => Promise<Match>): Promise<Match> => {
    const my = ++seq.current
    inflight.current++
    const p = chain.current.then(fn)
    chain.current = p.catch(() => {})
    return p.then(r => { lastSaved.current = Date.now(); if (my === seq.current) setM(r); return r })
      .finally(() => { inflight.current--; if (inflight.current === 0) adopt() })
  }

  const syncing = useRef(false)
  const sync = async () => {
    if (syncing.current) return
    syncing.current = true
    try { await flushQueue() } finally { syncing.current = false }
  }
  const flushQueue = async () => {
    await flush(async op => {
      if (op.kind === 'score') await api.scorePoint(op.matchId, op.side!, token, op.id)
      if (op.kind === 'undo') await api.undoPoint(op.matchId, token)
      if (op.kind === 'confirm') await api.confirmMatch(op.matchId, token)
    })
    setOffline(pending() > 0)
    setStuck(stalledCount() > 0)
    setErrMsg(lastQueueError())
    reload()
  }

  const retrySync = () => { retryStalled(); setStuck(false); setErrMsg(undefined); sync() }

  // token changed (re-entered PIN in the modal) — resume syncing right away
  useEffect(() => {
    if (prevToken.current !== token) { prevToken.current = token; retryStalled(); setStuck(false); setErrMsg(undefined); sync() }
  }, [token])

  useEffect(() => {
    window.addEventListener('online', sync)
    const t = setInterval(() => { if (pending()) sync() }, 5000)
    // every 2 min give stalled ops a fresh start so nothing stays "stuck" for the referee
    const r = setInterval(() => { if (pending()) { retryStalled(); sync() } }, 120000)
    return () => { window.removeEventListener('online', sync); clearInterval(t); clearInterval(r) }
  }, [])

  const score = async (side: 'left' | 'right') => {
    if (m.status === 'finished' || m.status === 'awaiting_confirm') return
    const before = m
    const next = applyPoint(m, side, rules)
    history.current.push([before.score_a, before.score_b, {
      last_scorer: before.last_scorer ?? null,
      serving_team: before.serving_team ?? null,
      server_no: before.server_no ?? null,
    }])
    setM(next)
    const scored = next.score_a !== before.score_a || next.score_b !== before.score_b
    scored ? tapPoint() : tapFault()
    if (next.sides_switched && !before.sides_switched) { setShowSwitch(true); chimeSwitch() }
    if (next.status === 'awaiting_confirm') hornEnd()

    const evId = crypto.randomUUID()
    // an earlier tap is still waiting to be saved: queue behind it so the server gets them in order
    if (pending() > 0) {
      enqueue({ id: evId, kind: 'score', matchId: m.id, side, at: Date.now() })
      setOffline(true)
      void sync()
      return
    }
    try {
      await send(() => api.scorePoint(m.id, side, token, evId))
      setOffline(pending() > 0)
    } catch (e: any) {
      if (isPermanentError(String(e?.message ?? e))) { history.current.pop(); setM(before); reload(); return }   // match already finished/confirmed
      enqueue({ id: evId, kind: 'score', matchId: m.id, side, at: Date.now() })
      setOffline(true)
      setStuck(stalledCount() > 0)
      if (e?.message) setErrMsg(String(e.message))
    }
  }

  const undo = async () => {
    const snapshot = m
    const prev = history.current.pop()
    if (prev) setM(applyUndo(m, prev[0], prev[1], rules, prev[2]))
    tapUndo()
    // the tap being undone never reached the server: just take it out of the queue
    const queued = peekAll().filter(o => o.matchId === m.id && o.kind === 'score')
    if (queued.length) { drop(queued[queued.length - 1].id); setOffline(pending() > 0); return }
    try { await send(() => api.undoPoint(m.id, token)) }
    catch {
      // undo_point is not idempotent, so we never queue it — a lost response
      // would double-delete on replay. Revert so local matches the server.
      if (prev) history.current.push(prev)
      setM(snapshot)
      setOffline(pending() > 0)
    }
  }

  const pickFirstServer = async (side: 'left' | 'right') => {
    setServerPicked(true)
    if (m.score_a !== 0 || m.score_b !== 0) return   // only before the match has started
    try { await send(() => api.setFirstServer(m.id, side, token)) } catch { /* best-effort */ }
  }

  const [confirming, setConfirming] = useState(false)
  const confirm = async () => {
    if (confirming) return
    setConfirming(true)
    try {
      // every point must be on the server before the result is locked
      await chain.current
      if (pending() > 0) await sync()
      await api.confirmMatch(m.id, token); reload()
    }
    catch (e: any) {
      // server said "already confirmed" -> nothing to retry; only queue real network failures
      if (!isPermanentError(String(e?.message ?? e))) { enqueue({ id: crypto.randomUUID(), kind: 'confirm', matchId: m.id, at: Date.now() }); setOffline(true) }
      reload()
      setConfirming(false)
    }
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
    await send(() => api.resetMatch(m.id, token))
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
  const teamLogoOf = (teamId: string | null): string | null =>
    bundle.teams.find((x: typeof bundle.teams[number]) => x.id === teamId)?.logo ?? null
  const leftTeamId = m.a_on_left ? m.team_a_id : m.team_b_id
  const rightTeamId = m.a_on_left ? m.team_b_id : m.team_a_id
  // SWAP persists to the server (a_on_left) so the live board and TV mirror it.
  const swap = async () => {
    setM(prev => ({ ...prev, a_on_left: !prev.a_on_left }))
    try { await send(() => api.flipSides(m.id, token)) }
    catch { setM(prev => ({ ...prev, a_on_left: !prev.a_on_left })) } // revert; retry when online
  }
  const matchNo = bundle.matches
    .filter((x: typeof bundle.matches[number]) => x.court_id === m.court_id)
    .sort((a: typeof bundle.matches[number], b: typeof bundle.matches[number]) => a.sequence - b.sequence)
    .findIndex((x: typeof bundle.matches[number]) => x.id === m.id) + 1
  const done = m.status === 'awaiting_confirm' || isGameOver(m.score_a, m.score_b, rules)
  const serving = done ? null : servingSide(m, rules.serve_mode)
  const serverNo = rules.serve_mode === 'alternate' && !done ? activeServerNo(m) : null
  const courtSide = done ? null : serverCourtOf(m, rules.serve_mode)
  const call = done ? null : scoreCall(m, rules.serve_mode)
  const notStarted = !done && m.score_a === 0 && m.score_b === 0
  const hi = Math.max(m.score_a, m.score_b), lo = Math.min(m.score_a, m.score_b)
  const matchPoint = !done && hi >= rules.target_score - 1 && hi - lo >= rules.win_by - 1
  const recentDone = useMemo(() =>
    bundle.matches
      .filter((x: typeof bundle.matches[number]) => x.court_id === m.court_id && x.status === 'finished')
      .sort((a: typeof bundle.matches[number], b: typeof bundle.matches[number]) =>
        (b.finished_at ?? '').localeCompare(a.finished_at ?? ''))[0],
    [bundle.matches, m.court_id]
  )

  const title = gameTitle(bundle, m)
  const canPick = courtChoices(bundle, m.court_id!, m.id).length > 0
  // what this court plays after this game (its own list, in order)
  const upAfter = courtChoices(bundle, m.court_id!, m.id)[0]?.m as Match | undefined

  if (!landscape && !ignoreRotate) return <RotatePrompt onIgnore={() => setIgnoreRotate(true)} />

  const isPortrait = !landscape

  return (
    <div className={`fixed inset-0 flex ${isPortrait ? 'flex-col' : ''} bg-canvas no-select`}
      style={{
        paddingTop: 'var(--pp-top)',
        paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)',
        paddingRight: 'env(safe-area-inset-right)',
      }}>
      {/* header + court area */}
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`flex shrink-0 items-center justify-between gap-2 px-3 ${isPortrait ? 'py-1.5' : 'py-2'}`}>
          <Link to={`/c/${code}`}
            className={`flex shrink-0 items-center gap-1 rounded-xl border border-line bg-surface/80 font-display font-bold tracking-wide text-fg active:bg-surface-2 ${
              isPortrait ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}>
            ← BOARD
          </Link>
          <div className={`flex min-w-0 items-baseline gap-2 truncate font-display font-bold tracking-widest text-fg-muted ${
            isPortrait ? 'text-sm' : ''}`}>
            <span className={isPortrait ? 'text-sm' : 'text-base sm:text-lg'}>{courtShort ?? `Court ${courtNo}`} · M{matchNo}</span>
            {matchPoint && <span className="shrink-0 animate-pulse text-sm text-brand-ink">MATCH PT</span>}
            {ev.play_clock && <PlayClock m={m} className="text-xs font-semibold tracking-normal text-fg-subtle" />}
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[11px]">
            {/* landscape: swap lives in the header so it never covers the court label */}
            {!isPortrait && (
              <button onClick={swap}
                className="min-h-[30px] whitespace-nowrap rounded-lg border border-line bg-surface/80 px-3 py-1 font-display text-xs font-bold tracking-wide text-fg-muted active:scale-95">
                ⇄ SWAP
              </button>
            )}
            {notStarted && canPick && onPick && (
              <button onClick={onPick} aria-label="Play a different game" title="Play a different game"
                className="grid h-8 w-8 shrink-0 place-items-center rounded-lg border border-line bg-surface/80 text-fg-muted active:scale-95">
                <PickIcon className="h-4 w-4" />
              </button>
            )}
            <SoundToggle portrait={isPortrait} />
            {!isPortrait && <FullscreenButton className="-my-1.5 h-8 w-8 shrink-0 p-1.5 text-fg-muted active:text-fg-muted" />}
            {recentDone && (
              <Link to={`/c/${code}/match/${recentDone.id}`} className="text-fg-muted underline underline-offset-2">
                PREV
              </Link>
            )}
            <span title={errMsg ? `Syncing in background: ${errMsg}` : pending() > 0 ? 'Points saved on this device, syncing in background' : 'All points saved to the server'}
                className={pending() > 0 ? 'text-fg-muted' : 'text-fg-subtle'}>
                {pending() > 0 ? '● syncing…' : '● synced'}
              </span>
          </div>
        </div>


        {/* court area — portrait: constrained 2:1 centred; landscape: fills available space */}
        <div className={isPortrait
          ? 'relative flex min-h-0 flex-1 items-center justify-center px-3'
          : 'relative min-h-0 flex-1 px-2 pb-2'}>
          {isPortrait ? (
            <div className="relative w-full" style={{ maxHeight: '100%', aspectRatio: '2' }}>
              <Court
                leftName={leftName} rightName={rightName}
                leftScore={s.left} rightScore={s.right}
                leftFlag={sideName(leftTeamId)} rightFlag={sideName(rightTeamId)}
                leftLogo={teamLogoOf(leftTeamId)} rightLogo={teamLogoOf(rightTeamId)}
                label={koCourtLabel(m) ?? (m.bracket_key ? (m.round ?? undefined) : (m.game_label ?? undefined))}
                sport={eventOf(bundle, match).sport}
                bigEmblem
                nameHalo
                nameBelow
                serving={serving}
                serverNo={serverNo}
                serverCourt={courtSide}
                callScore={call}
                onTap={score} disabled={done}
              />
              <button onClick={swap}
                className="absolute left-1/2 -bottom-7 -translate-x-1/2 rounded-lg border border-line bg-surface/90 px-3 py-1 font-display text-xs font-bold tracking-wide text-fg-muted active:scale-95">
                ⇄ SWAP
              </button>
            </div>
          ) : (
            <>
              <Court
                leftName={leftName} rightName={rightName}
                leftScore={s.left} rightScore={s.right}
                leftFlag={sideName(leftTeamId)} rightFlag={sideName(rightTeamId)}
                leftLogo={teamLogoOf(leftTeamId)} rightLogo={teamLogoOf(rightTeamId)}
                label={koCourtLabel(m) ?? (m.bracket_key ? (m.round ?? undefined) : (m.game_label ?? undefined))}
                sport={eventOf(bundle, match).sport}
                bigEmblem
                nameHalo
                nameBelow
                serving={serving}
                serverNo={serverNo}
                serverCourt={courtSide}
                callScore={call}
                onTap={score} disabled={done}
              />

            </>
          )}
        </div>
      </div>

      {/* control rail (landscape: right column) / control bar (portrait: bottom row) */}
      <div className={isPortrait
        ? 'flex shrink-0 items-center justify-center gap-3 border-t border-line px-4 py-2.5'
        : 'flex w-[74px] shrink-0 flex-col items-center justify-center gap-2.5 border-l border-line px-2 py-2'}>
        <button onClick={undo} aria-label="Undo"
          className={`rounded-2xl border border-line bg-surface text-fg-muted active:bg-surface-2 ${
            isPortrait
              ? 'flex h-12 flex-1 items-center justify-center gap-2'
              : 'flex h-20 w-full flex-col items-center justify-center gap-1.5'}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-2" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">UNDO</span>
        </button>
        <button onClick={reset} aria-label="Reset"
          className={`rounded-2xl border active:bg-surface-2 ${
            confirmingReset
              ? 'border-red-500 bg-red-500/20 text-red-300'
              : 'border-line bg-surface text-fg-muted'} ${
            isPortrait
              ? 'flex h-12 flex-1 items-center justify-center gap-2'
              : 'flex h-20 w-full flex-col items-center justify-center gap-1.5'}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor"
            strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">
            {confirmingReset ? 'SURE?' : 'RESET'}
          </span>
        </button>
        <Link to={`/c/${code}/match/${m.id}`} aria-label="Point log"
          className={`rounded-2xl border border-line bg-surface text-fg-muted active:bg-surface-2 ${
            isPortrait
              ? 'flex h-12 flex-1 items-center justify-center gap-2'
              : 'flex h-20 w-full flex-col items-center justify-center gap-1.5'}`}>
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

      {notStarted && !serverPicked && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-4 overflow-y-auto bg-canvas px-6 py-4">
          <Link to={`/c/${code}`} aria-label="Back to board"
            className="absolute left-3 top-[max(0.75rem,env(safe-area-inset-top))] flex min-h-[40px] items-center gap-1.5 rounded-xl border border-line bg-surface px-3 py-2 text-sm font-semibold text-fg-muted active:bg-surface-2">
            ← Back to board
          </Link>
          <div className="text-center">
            <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-fg-subtle">{courtName ?? `Court ${courtNo}`} · next game</div>
            <div className="mt-1 font-display text-2xl font-bold uppercase tracking-wide text-brand-ink">{title}</div>
          </div>
          <div className="grid w-full max-w-xl grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-3">
            <NextTeam name={leftName} logo={teamLogoOf(leftTeamId)} flag={sideName(leftTeamId)} />
            <span className="font-display text-lg font-bold text-fg-subtle">VS</span>
            <NextTeam name={rightName} logo={teamLogoOf(rightTeamId)} flag={sideName(rightTeamId)} />
          </div>
          <div className="w-full max-w-xl">
            <div className="mb-2 text-center text-sm font-semibold text-fg-muted">Both teams here? Tap who serves first to start.</div>
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={() => pickFirstServer('left')}
                className="min-w-0 rounded-2xl bg-brand px-3 py-4 font-display text-xl font-bold text-brand-fg active:scale-[0.98]">
                <span className="line-clamp-2 break-words">{leftName}</span>
              </button>
              <button type="button" onClick={() => pickFirstServer('right')}
                className="min-w-0 rounded-2xl bg-brand px-3 py-4 font-display text-xl font-bold text-brand-fg active:scale-[0.98]">
                <span className="line-clamp-2 break-words">{rightName}</span>
              </button>
            </div>
          </div>
          {canPick && onPick && (
            <button type="button" onClick={onPick}
              className="flex min-h-[40px] items-center gap-2 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-semibold text-fg-muted active:bg-surface-2">
              <PickIcon className="h-4 w-4" /> A team is not here? Play a different game
            </button>
          )}
        </div>
      )}

      {showSwitch && (
        <button onClick={() => setShowSwitch(false)}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-brand px-8 text-brand-fg">
          <div className={`font-display font-bold leading-none tracking-tight ${
            isPortrait ? 'text-4xl' : 'text-6xl'}`}>SWITCH ENDS</div>
          <div className={`text-center font-semibold ${isPortrait ? 'text-sm' : 'text-base'}`}>
            Score reached {rules.switch_at}. Players change sides —
            the court has flipped to match.
          </div>
          <div className={`rounded-2xl bg-canvas/15 font-display font-bold ${
            isPortrait ? 'px-6 py-2.5 text-lg' : 'px-8 py-3 text-xl'}`}>
            TAP TO CONTINUE
          </div>
        </button>
      )}

      {done && (
        <div className={`absolute inset-0 z-30 flex items-center justify-center overflow-y-auto bg-canvas py-4 ${
          isPortrait ? 'flex-col gap-5 px-6' : 'gap-8 px-8'}`}>
          <div className={`space-y-2 ${isPortrait ? 'w-full max-w-sm' : 'w-full max-w-md'}`}>
            <div className="mb-2">
              <div className="text-[11px] font-bold uppercase tracking-[0.3em] text-fg-subtle">{courtName ?? `Court ${courtNo}`} · {title}</div>
              <div className="font-display text-3xl font-bold tracking-wide">GAME OVER</div>
            </div>
            <ResultRow name={leftName} flag={sideName(leftTeamId)} logo={teamLogoOf(leftTeamId)} score={s.left} win={s.left > s.right} />
            <ResultRow name={rightName} flag={sideName(rightTeamId)} logo={teamLogoOf(rightTeamId)} score={s.right} win={s.right > s.left} />
          </div>
          <div className={`space-y-3 ${isPortrait ? 'w-full max-w-sm' : 'w-64 shrink-0'}`}>
            <div className="text-sm text-fg-muted">
              Both captains check the score, then end the game.
            </div>
            <button onClick={confirm} disabled={confirming}
              className="w-full rounded-2xl bg-brand px-3 py-4 font-display text-xl font-bold text-brand-fg disabled:opacity-60">
              {confirming ? 'SAVING…' : upAfter ? 'END GAME · NEXT ›' : 'END GAME'}
            </button>
            <button onClick={undo} disabled={confirming}
              className="w-full rounded-2xl border border-line px-3 py-3 font-display text-base font-bold text-fg-muted">
              UNDO LAST POINT
            </button>
            <div className="rounded-xl border border-line bg-surface px-3 py-2 text-xs text-fg-muted">
              <div className="font-bold uppercase tracking-widest text-fg-subtle">Next on this court</div>
              {upAfter
                ? <div className="mt-0.5 truncate text-sm text-fg">{teamName(bundle, upAfter.team_a_id)} <span className="text-fg-subtle">vs</span> {teamName(bundle, upAfter.team_b_id)}</div>
                : <div className="mt-0.5 text-sm">Shown after you end this game.</div>}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

function NextTeam({ name, logo, flag }: { name: string; logo?: string | null; flag?: string | null }) {
  return (
    <div className="flex min-w-0 flex-col items-center gap-1.5 text-center">
      <Emblem logo={logo} flagName={flag} className="h-14 w-auto max-w-full rounded-[3px]" />
      <span className="line-clamp-2 break-words font-display text-xl font-bold leading-tight">{name}</span>
    </div>
  )
}

/** two rows trading places: "play a different game" */
function PickIcon({ className = '' }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <path d="M7 4v16M7 4 3.5 7.5M7 4l3.5 3.5" /><path d="M17 20V4m0 16 3.5-3.5M17 20l-3.5-3.5" />
    </svg>
  )
}

const PICK_ERR: Record<string, string> = {
  GAME_STARTED: 'The game on court already has points. Finish it, or RESET it first.',
  TEAM_BUSY: 'A team of that game is playing on another court right now.',
  NOT_SCHEDULED: 'That game has already started or finished.',
  NO_COURT_SESSION: 'Court PIN expired — go back and enter the PIN again.',
}

/** Sheet: the other games waiting for this court. Picking one puts it on court
 *  now; the game it replaces goes back into the list and is played after. */
function GamePicker({ bundle, courtId, courtName, token, current, onClose, onDone }: {
  bundle: any; courtId: string; courtName: string; token: string; current?: Match
  onClose: () => void; onDone: () => void
}) {
  const [sel, setSel] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const list = courtChoices(bundle, courtId, current?.id).slice(0, 12)
  const started = !!current && (current.status !== 'live' || current.score_a > 0 || current.score_b > 0)
  const go = async () => {
    if (!sel || busy) return
    setBusy(true); setErr(null)
    try { await api.courtPickMatch(sel, courtId, token); onDone() }
    catch (e: any) {
      const msg = String(e?.message ?? e)
      setErr(PICK_ERR[msg] ?? (/court_pick_match|schema cache|PGRST202/i.test(msg)
        ? 'Not switched on yet — the organiser needs to run database update 0040.'
        : `Could not change the game (${msg}).`))
      setBusy(false)
    }
  }
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 sm:items-center" onClick={onClose}>
      <div onClick={e => e.stopPropagation()}
        className="flex max-h-[92vh] w-full max-w-lg flex-col rounded-t-2xl border border-line bg-canvas sm:rounded-2xl"
        style={{ paddingBottom: 'env(safe-area-inset-bottom)' }}>
        <div className="flex items-start justify-between gap-3 border-b border-line px-4 py-3">
          <div className="min-w-0">
            <div className="text-[11px] font-bold uppercase tracking-[0.25em] text-fg-subtle">{courtName}</div>
            <div className="font-display text-xl font-bold">Play a different game</div>
            {current && !started && (
              <div className="mt-0.5 truncate text-xs text-fg-muted">
                Instead of {teamName(bundle, current.team_a_id)} vs {teamName(bundle, current.team_b_id)} — that game is played after.
              </div>
            )}
          </div>
          <button onClick={onClose} aria-label="Close" className="grid h-9 w-9 shrink-0 place-items-center rounded-lg border border-line text-fg-muted">✕</button>
        </div>
        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-2">
          {started && <div className="rounded-xl border border-line bg-surface p-3 text-sm text-fg-muted">{PICK_ERR.GAME_STARTED}</div>}
          {!started && list.length === 0 && <div className="p-3 text-sm text-fg-muted">No other game is waiting for this court.</div>}
          {!started && list.map(({ m, busy: bt }) => (
            <button key={m.id} disabled={!!bt} onClick={() => setSel(m.id)}
              className={`mb-1.5 block w-full rounded-xl border px-3 py-2 text-left ${
                sel === m.id ? 'border-brand-ink bg-brand/10' : 'border-line bg-surface'} ${bt ? 'opacity-50' : 'active:bg-surface-2'}`}>
              <span className="block truncate text-[11px] font-bold uppercase tracking-wide text-fg-subtle">{gameTitle(bundle, m)}</span>
              <span className="block min-w-0">
                <span className="block truncate text-sm font-semibold">{teamName(bundle, m.team_a_id)} <span className="font-normal text-fg-subtle">vs</span> {teamName(bundle, m.team_b_id)}</span>
                {bt && <span className="block truncate text-[11px] text-fg-subtle">{teamName(bundle, bt)} is on another court now</span>}
              </span>
            </button>
          ))}
        </div>
        {err && <div className="px-4 pb-2 text-sm font-semibold text-red-400">{err}</div>}
        {!started && list.length > 0 && (
          <div className="border-t border-line px-3 py-3">
            <button onClick={go} disabled={!sel || busy}
              className="w-full rounded-2xl bg-brand py-3.5 font-display text-lg font-bold text-brand-fg disabled:opacity-40">
              {busy ? 'CHANGING…' : sel ? 'PLAY THIS GAME NOW' : 'CHOOSE A GAME'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function ResultRow({ name, flag, logo, score, win }: {
  name: string; flag?: string | null; logo?: string | null; score: number; win: boolean
}) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${
      win ? 'border-brand-ink bg-brand/10' : 'border-line'}`}>
      <span className="flex min-w-0 items-center gap-2">
        <Emblem logo={logo} flagName={flag} className="h-5 w-auto shrink-0 rounded-[2px]" />
        <span className="truncate font-display text-xl font-bold">{name}</span>
      </span>
      <span className="tabular font-display text-4xl font-bold">{score}</span>
    </div>
  )
}

function SoundToggle({ portrait }: { portrait: boolean }) {
  const [on, setOn] = useState(isSoundOn())
  return (
    <button type="button" title={on ? 'Sound on — tap to mute' : 'Sound off — tap to unmute'}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      onClick={() => { const v = !on; setSoundOn(v); setOn(v) }}
      className="shrink-0 text-fg-muted active:text-fg">
      <svg viewBox="0 0 24 24" className={portrait ? 'h-5 w-5' : 'h-5 w-5'} fill="none"
        stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {on
          ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
          : <><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></>}
      </svg>
    </button>
  )
}

function RotatePrompt({ onIgnore }: { onIgnore: () => void }) {
  return (
    <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-canvas px-10">
      <svg viewBox="0 0 120 80" className="w-40 text-brand-ink">
        <rect x="34" y="4" width="52" height="72" rx="7" fill="none" stroke="currentColor" strokeWidth="3" opacity="0.35" />
        <rect x="8" y="20" width="104" height="40" rx="7" fill="none" stroke="currentColor" strokeWidth="3" />
        <path d="M92 12 a30 30 0 0 1 14 18" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" />
        <path d="M100 6 l7 7 -8 6" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
      <div className="text-center">
        <div className="whitespace-nowrap font-display text-2xl font-bold tracking-wide sm:text-3xl">ROTATE YOUR PHONE</div>
        <div className="mt-1 text-sm text-fg-muted">
          The court view needs landscape so both halves stay big enough to tap.
        </div>
      </div>
      <button onClick={onIgnore} className="text-xs text-fg-subtle underline underline-offset-4">
        score in portrait anyway
      </button>
    </div>
  )
}
