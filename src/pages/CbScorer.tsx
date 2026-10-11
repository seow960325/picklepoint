/** Court scorer for captain ball (multi-sport, migration 0031). One referee
 *  device runs the whole game: clock, +1 / +2 / −1 points, fouls, per-team
 *  time-outs, adding time back, half-time rest and swapping ends. Every action
 *  produces the full new game state, which is sent to the server (cb_save);
 *  the board and TV read it and tick the clock themselves. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, Match } from '../lib/types'
import { teamName, teamLogo, eventOf } from '../lib/store'
import * as api from '../lib/api'
import { Emblem } from '../components/ui'
import { tapPoint, tapUndo, chimeSwitch } from '../lib/feedback'
import { CB_TEAM_COLOR, useHorn, useNow } from '../components/CaptainBall'
import {
  cbStateOf, cbView, cbScore, cbRun, cbStop, cbPoint, cbUndo, cbFoul, cbTimeout, cbEndTimeout,
  cbTimeoutBack, cbGrantTimeout, cbAdjust, cbEndHalf, cbNextHalf, cbExtraTime, cbReopen, cbRestart,
  cbFlip, fmtClock, toLeft, toAllowed, type Act, type CbSnap, type Side,
} from '../lib/captainball'

export default function CbScorer({ bundle, match, token, courtNo, code, reload, onRelogin }: {
  bundle: Bundle; match: Match; token: string; courtNo: number; code: string
  reload: () => void; onRelogin: () => void
}) {
  const ev = eventOf(bundle, match)
  const [snap, setSnap] = useState<CbSnap>(() => ({ st: cbStateOf(match, ev), aOnLeft: match.a_on_left }))
  const latest = useRef(snap)
  const sentRev = useRef(match.started_at ? (match.cb?.rev ?? 0) : 0)
  const busy = useRef(false)
  const [offline, setOffline] = useState(false)
  const [conflict, setConflict] = useState(false)
  const [confirm, setConfirm] = useState<null | 'finish' | 'restart' | 'endhalf'>(null)
  const [menu, setMenu] = useState(false)

  const st = snap.st
  const now = useNow(true, 200)
  const v = cbView(st, now)
  useHorn(st, now, true)
  const sc = cbScore(st)

  // another device (or an admin reset) moved the game on: adopt it
  useEffect(() => {
    const serverRev = match.started_at ? (match.cb?.rev ?? 0) : 0
    if (serverRev > latest.current.st.rev || (!match.started_at && latest.current.st.rev > 0 && sentRev.current > 0)) {
      const next = { st: cbStateOf(match, ev), aOnLeft: match.a_on_left }
      latest.current = next; sentRev.current = serverRev; setSnap(next); setConflict(false)
    }
  }, [match.cb?.rev, match.started_at])

  const flush = async () => {
    if (busy.current) return
    busy.current = true
    try {
      while (latest.current.st.rev > sentRev.current) {
        const s = latest.current
        const c = cbScore(s.st)
        try {
          await api.cbSave(match.id, token, s.st, c.a, c.b, s.aOnLeft)
          sentRev.current = s.st.rev; setOffline(false)
        } catch (e: any) {
          const msg = String(e?.message ?? e)
          if (msg.includes('CB_STALE')) { sentRev.current = s.st.rev; setConflict(true); reload(); break }
          if (/NO_COURT_SESSION/.test(msg)) { onRelogin(); setOffline(true); break }
          if (/MATCH_NOT_LIVE|WRONG_COURT|NOT_CAPTAIN_BALL/.test(msg)) { reload(); break }
          setOffline(true); break
        }
      }
    } finally { busy.current = false }
  }
  useEffect(() => {
    const t = setInterval(() => { if (latest.current.st.rev > sentRev.current) flush() }, 3000)
    window.addEventListener('online', flush)
    return () => { clearInterval(t); window.removeEventListener('online', flush) }
  }, [token])

  const apply = (act: Act, feel?: () => void) => {
    const next = act(latest.current, Date.now())
    if (next === latest.current) return
    latest.current = next; setSnap(next); feel?.(); flush()
  }

  const finish = async () => {
    setConfirm(null)
    await flush()
    try { await api.cbFinish(match.id, token) } catch { /* reload shows the truth */ }
    reload()
  }

  const left: Side = snap.aOnLeft ? 'a' : 'b'
  const right: Side = left === 'a' ? 'b' : 'a'
  const tid = (s: Side) => (s === 'a' ? match.team_a_id : match.team_b_id)
  const level = sc.a === sc.b
  const lastHalf = st.et || st.half >= st.r.halves
  const clockOpen = st.phase === 'play' || st.phase === 'ready'
  const canRun = clockOpen && !v.running && st.ms > 0 && v.clock > 0 && st.phase !== 'break'
  const wasAdded = st.adj !== 0
  const matchNo = useMemo(() => bundle.matches
    .filter(x => x.court_id === match.court_id).sort((a, b) => a.sequence - b.sequence)
    .findIndex(x => x.id === match.id) + 1, [bundle.matches, match.id])

  const Btn = ({ children, onClick, tone = 'base', className = '', disabled = false }: {
    children: React.ReactNode; onClick: () => void; tone?: 'base' | 'go' | 'stop' | 'warn' | 'ghost'; className?: string; disabled?: boolean
  }) => (
    <button disabled={disabled} onClick={onClick}
      className={`rounded-xl font-display font-bold uppercase tracking-wide active:scale-[0.97] disabled:opacity-30 ${
        tone === 'go' ? 'bg-[#22c55e] text-black' : tone === 'stop' ? 'bg-[#ef4444] text-white'
        : tone === 'warn' ? 'bg-[#f59e0b] text-black' : tone === 'ghost' ? 'border border-white/20 text-white/80'
        : 'bg-white/10 text-white'} ${className}`}>
      {children}
    </button>
  )

  const team = (s: Side) => {
    const col = CB_TEAM_COLOR[s]
    const allowed = toAllowed(st, s), have = toLeft(st, s)
    return (
      <div className="flex min-w-0 flex-1 flex-col gap-2 rounded-2xl bg-white/[0.04] p-2.5">
        <div className="flex items-center gap-2">
          <span className="h-6 w-1.5 shrink-0 rounded" style={{ background: col }} />
          <Emblem logo={teamLogo(bundle, tid(s))} className="h-6 w-6 shrink-0 rounded-[3px]" />
          <span className="min-w-0 truncate font-display text-lg font-bold uppercase tracking-wide">{teamName(bundle, tid(s))}</span>
        </div>
        <div className="tabular text-center font-display text-[min(24vh,7rem)] landscape:text-[min(22vh,6rem)] font-bold leading-none"
          style={{ color: col, textShadow: `0 0 18px ${col}44` }}>{sc[s]}</div>
        <div className="grid grid-cols-[1fr_1fr_auto] gap-2">
          <Btn onClick={() => apply(cbPoint(s, 1), tapPoint)} className="py-4 text-3xl" tone="base">+1</Btn>
          <Btn onClick={() => apply(cbPoint(s, 2), tapPoint)} className="py-4 text-3xl" tone="base">+2</Btn>
          <Btn onClick={() => apply(cbPoint(s, -1), tapUndo)} tone="ghost" className="px-3 text-xl" disabled={sc[s] < 1}>−1</Btn>
        </div>
        <div className="grid grid-cols-[auto_1fr_auto] items-center gap-2">
          <Btn onClick={() => apply(cbFoul(s, -1))} tone="ghost" className="h-9 w-9 text-lg" disabled={st.f[s] < 1}>−</Btn>
          <button onClick={() => apply(cbFoul(s, 1), tapPoint)}
            className="rounded-xl bg-[#facc15]/15 py-2 font-display text-base font-bold uppercase tracking-wider text-[#facc15] active:scale-[0.97]">
            Foul <span className="tabular text-2xl">{st.f[s]}</span>
          </button>
          <span className="w-9" />
        </div>
        <div className="flex items-center gap-2">
          <Btn onClick={() => apply(cbTimeout(s), chimeSwitch)} tone="warn" className="flex-1 py-2.5 text-base"
            disabled={have < 1 || st.phase === 'over' || st.phase === 'break'}>
            Time-out
            <span className="ml-2 inline-flex gap-1 align-middle">
              {Array.from({ length: allowed }, (_, i) => (
                <span key={i} className={`h-2.5 w-2.5 rounded-full ${i < have ? 'bg-black' : 'bg-black/25'}`} />
              ))}
            </span>
          </Btn>
        </div>
      </div>
    )
  }

  const bar = 'rounded-lg px-3 py-2 text-sm'
  return (
    <div className="fixed inset-0 flex flex-col gap-2 overflow-y-auto bg-[#07090d] p-2 text-white no-select"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)', paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}>
      {/* header */}
      <div className="flex shrink-0 items-center justify-between gap-2">
        <Link to={`/c/${code}`} className="rounded-xl border border-white/20 px-3 py-1.5 font-display text-sm font-bold tracking-wide">← BOARD</Link>
        <div className="min-w-0 truncate font-display text-sm font-bold tracking-widest text-white/60">
          CT{courtNo} · G{matchNo || match.sequence}
        </div>
        <span className={`text-[11px] ${offline ? 'font-bold text-[#fbbf24]' : 'text-white/40'}`}>
          {offline ? '● offline — saving…' : '● synced'}
        </span>
      </div>

      {conflict && (
        <div className="shrink-0 rounded-lg bg-[#f59e0b]/20 px-3 py-2 text-sm text-[#fbbf24]">
          Another device changed this game. Screen refreshed to the latest.
        </div>
      )}

      <div className="grid min-h-0 flex-1 grid-cols-2 content-start gap-2 landscape:grid-cols-[minmax(0,1fr)_minmax(0,1.15fr)_minmax(0,1fr)]">
        <div className="col-span-2 flex flex-col gap-2 landscape:order-2 landscape:col-span-1">
      {/* clock */}
      <div className="shrink-0 rounded-2xl bg-white/[0.04] px-3 py-2 text-center">
        <div className="flex items-center justify-center gap-3 font-display text-sm font-bold uppercase tracking-[0.22em] text-white/70">
          <span>{v.periodLabel}</span>
          <span className={v.running ? 'text-[#4ade80]' : v.expired || st.phase === 'over' ? 'text-white' : 'text-[#fbbf24]'}>
            {v.running ? '● RUNNING' : v.status}
          </span>
        </div>
        <div className="tabular font-display text-[min(14vh,5.5rem)] landscape:text-[min(20vh,6rem)] font-bold leading-none"
          style={{ color: '#ff3b30', textShadow: '0 0 16px #ff3b3077' }}>
          {st.phase === 'break' ? fmtClock(v.brkMs, false) : fmtClock(v.clock)}
        </div>
        {st.phase === 'break' && <div className="text-sm font-semibold text-[#38bdf8]">HALF-TIME REST · teams swap ends for the next half</div>}
        {v.toMs > 0 && (
          <div className="mx-auto mt-1 flex max-w-md items-center justify-center gap-3 rounded-xl bg-[#f59e0b]/20 px-3 py-1.5 font-display text-xl font-bold uppercase text-[#fbbf24]">
            <span className="truncate">Time-out · {teamName(bundle, tid(v.toSide!))}</span>
            <span className="tabular text-3xl text-white">{fmtClock(v.toMs, false)}</span>
            <button onClick={() => apply(cbEndTimeout)} className="rounded-lg border border-[#fbbf24]/50 px-2 py-0.5 text-sm">END</button>
          </div>
        )}
        {wasAdded && st.phase !== 'break' && (
          <div className="mt-1 text-xs text-white/50">time added back this game: {st.adj > 0 ? '+' : '−'}{fmtClock(Math.abs(st.adj), false)}</div>
        )}
      </div>

      {/* main controls */}
      <div className="grid shrink-0 gap-2">
        {st.phase === 'break' ? (
          <Btn tone="go" onClick={() => apply(cbNextHalf, chimeSwitch)} className="py-4 text-2xl">
            START HALF {st.half + 1} · SWAP ENDS
          </Btn>
        ) : st.phase === 'over' ? (
          level
            ? <div className="grid grid-cols-2 gap-2">
                <Btn tone="go" onClick={() => apply(cbExtraTime)} className="py-4 text-xl">EXTRA TIME {st.r.extra_min}:00</Btn>
                <Btn tone="warn" onClick={() => setConfirm('finish')} className="py-4 text-xl">FINISH · DRAW</Btn>
              </div>
            : <Btn tone="go" onClick={() => setConfirm('finish')} className="py-4 text-2xl">FINISH GAME · {sc[left]}–{sc[right]}</Btn>
        ) : v.expired ? (
          <Btn tone="warn" onClick={() => apply(cbEndHalf)} className="animate-pulse py-4 text-2xl">
            {lastHalf ? 'FULL TIME' : `END HALF ${st.half}`}
          </Btn>
        ) : v.running ? (
          <Btn tone="stop" onClick={() => apply(cbStop)} className="py-4 text-2xl">■ STOP CLOCK</Btn>
        ) : (
          <Btn tone="go" onClick={() => apply(cbRun)} disabled={!canRun} className="py-4 text-2xl">
            ▶ {st.phase === 'ready' ? 'START' : 'RESUME'}
          </Btn>
        )}
        <div className="grid grid-cols-[1fr_auto] gap-2">
          <Btn tone="ghost" onClick={() => apply(cbUndo, tapUndo)} disabled={!st.log.length} className="py-2 text-base">↶ UNDO LAST SCORE</Btn>
          <Btn tone="ghost" onClick={() => setMenu(m => !m)} className="px-5 py-2 text-base">⋯</Btn>
        </div>
      </div>

      {/* time add-back */}
      {clockOpen && (
        <div className="flex shrink-0 flex-wrap items-center justify-center gap-1.5">
          <span className="mr-1 text-xs font-semibold uppercase tracking-widest text-white/50">Clock</span>
          {[-60000, -10000, 10000, 30000, 60000].map(d => (
            <Btn key={d} tone="ghost" onClick={() => apply(cbAdjust(d))} className={`${bar} min-w-[3.4rem] tabular`}>
              {d < 0 ? '−' : '+'}{Math.abs(d) >= 60000 ? `${Math.abs(d) / 60000}m` : `${Math.abs(d) / 1000}s`}
            </Btn>
          ))}
          {!v.expired && st.phase === 'play' && (
            <Btn tone="ghost" onClick={() => setConfirm('endhalf')} className={`${bar}`}>
              {lastHalf ? 'End game' : `End half ${st.half}`}
            </Btn>
          )}
        </div>
      )}

      {menu && (
        <div className="grid shrink-0 grid-cols-2 gap-2 rounded-2xl bg-white/[0.06] p-2.5 sm:grid-cols-4">
          <Btn tone="ghost" onClick={() => apply(cbFlip)} className={bar}>⇄ Swap sides on screen</Btn>
          {(['a', 'b'] as Side[]).map(s => (
            <Btn key={s} tone="ghost" className={bar} onClick={() => apply(cbGrantTimeout(s, 1))}>
              + time-out · {teamName(bundle, tid(s))}
            </Btn>
          ))}
          {(['a', 'b'] as Side[]).map(s => (
            <Btn key={`b${s}`} tone="ghost" className={bar} onClick={() => apply(cbTimeoutBack(s))} disabled={!(st.tou[s][st.et ? st.r.halves : st.half - 1] > 0)}>
              give back time-out · {teamName(bundle, tid(s))}
            </Btn>
          ))}
          {st.phase === 'over' && <Btn tone="ghost" onClick={() => apply(cbReopen)} className={bar}>Reopen (not full time yet)</Btn>}
          <Btn tone="ghost" onClick={() => setConfirm('restart')} className={`${bar} !border-[#ef4444]/50 text-[#f87171]`}>Restart game 0–0</Btn>
        </div>
      )}

        </div>
        <div className="flex min-w-0 landscape:order-1">{team(left)}</div>
        <div className="flex min-w-0 landscape:order-3">{team(right)}</div>
      </div>

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/70 p-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl bg-[#11151c] p-5 text-center">
            <div className="font-display text-2xl font-bold uppercase">
              {confirm === 'finish' ? `Finish game ${sc.a}–${sc.b}?` : confirm === 'endhalf' ? (lastHalf ? 'End the game now?' : `End half ${st.half} now?`) : 'Restart the game?'}
            </div>
            {confirm === 'finish' && <div className="text-sm text-white/60">The result is locked and the next game starts on this court.{level ? ' Level score = draw.' : ''}</div>}
            {confirm === 'restart' && <div className="text-sm text-white/60">Score, fouls, time-outs and the clock go back to the start.</div>}
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="ghost" onClick={() => setConfirm(null)} className="py-3 text-lg">Cancel</Btn>
              <Btn tone={confirm === 'restart' ? 'stop' : 'go'} className="py-3 text-lg" onClick={() => {
                if (confirm === 'finish') finish()
                else if (confirm === 'endhalf') { setConfirm(null); apply(cbEndHalf) }
                else { setConfirm(null); setMenu(false); apply(cbRestart(st.r)) }
              }}>Yes</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
