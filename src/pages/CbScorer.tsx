/** Court scorer for captain ball (multi-sport, migration 0031). One referee
 *  device runs the whole game: game clock, +1 (boy) / +2 (girl) / −1, team
 *  fouls, team calls (each team's time-out, with its own countdown), clock
 *  corrections, half-time rest and swapping ends. Every action produces the
 *  full new game state, which is sent to the server (cb_save); the board and
 *  TV read it and tick the clock themselves.
 *
 *  Layout rule: every row has a fixed height and every number a fixed-width
 *  cell, so nothing on this screen moves when a value or a state changes.
 *  All small components live at module level — defining them inside the
 *  scorer re-created the buttons on every clock tick, which swallowed taps
 *  (the "STOP / RESUME lags" bug). */
import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { Link } from 'react-router-dom'
import type { Bundle, Match } from '../lib/types'
import { teamName, eventOf } from '../lib/store'
import * as api from '../lib/api'
import { tapPoint, tapUndo, chimeSwitch } from '../lib/feedback'
import { CB_TEAM_COLOR, CB_CLOCK_COLOR, CB_FOUL_COLOR, CB_CALL_COLOR, useHorn, useNow, tickMs } from '../components/CaptainBall'
import { SevenSeg, segClock, segScore } from '../components/SevenSeg'
import {
  cbStateOf, cbView, cbScore, cbRun, cbStop, cbPoint, cbUndo, cbFoul, cbTimeout, cbEndTimeout,
  cbTimeoutBack, cbGrantTimeout, cbAdjust, cbEndHalf, cbNextHalf, cbExtraTime, cbReopen, cbRestart,
  cbFlip, fmtClock, toLeft, toAllowed, ordinal, isLastPeriod, type Act, type CbSnap, type CbState, type Side,
} from '../lib/captainball'

type Tone = 'base' | 'go' | 'stop' | 'warn' | 'call' | 'ghost' | 'danger'
const TONE: Record<Tone, string> = {
  base: 'bg-[#1b1f27] text-white border border-[#2b313c]',
  go: 'bg-[#22c55e] text-black',
  stop: 'bg-[#ef4444] text-white',
  warn: 'bg-[#f59e0b] text-black',
  call: 'bg-[#ff9f0a]/15 text-[#ffb340] border border-[#ff9f0a]/60',
  ghost: 'bg-transparent text-white/85 border border-white/15',
  danger: 'bg-transparent text-[#f87171] border border-[#ef4444]/50',
}

function Btn({ children, onClick, tone = 'base', className = '', disabled = false }: {
  children: ReactNode; onClick: () => void; tone?: Tone; className?: string; disabled?: boolean
}) {
  return (
    <button type="button" disabled={disabled} onClick={onClick}
      style={{ touchAction: 'manipulation' }}
      className={`flex select-none items-center justify-center rounded-xl font-display font-bold uppercase tracking-wide transition-transform active:scale-[0.97] disabled:opacity-25 ${TONE[tone]} ${className}`}>
      {children}
    </button>
  )
}

function Lamps({ total, lit, color }: { total: number; lit: number; color: string }) {
  if (total <= 0) return <span className="text-xs text-white/40">none</span>
  return (
    <span className="inline-flex items-center gap-1.5">
      {Array.from({ length: total }, (_, i) => (
        <span key={i} className="h-3 w-3 rounded-full"
          style={{ background: i < lit ? color : '#30353f', boxShadow: i < lit ? `0 0 6px ${color}` : undefined }} />
      ))}
    </span>
  )
}

const PANEL = 'rounded-2xl border border-[#1f242d] bg-[#0c0f14]'
const LABEL = 'font-display text-[11px] font-bold uppercase tracking-[0.2em] text-[#8b93a1]'

/** One team's column: name, score, +1 / +2 / −1, fouls, team call. */
function TeamPanel({ name, side, st, score, callMs, callSide, apply }: {
  name: string; side: Side; st: CbState; score: number; callMs: number; callSide: Side | null
  apply: (a: Act, feel?: () => void) => void
}) {
  const col = CB_TEAM_COLOR[side]
  const allowed = Math.max(0, toAllowed(st, side)), left = toLeft(st, side)
  const mine = callMs > 0 && callSide === side
  const other = callMs > 0 && callSide !== side
  const live = st.phase !== 'over' && st.phase !== 'break'
  return (
    <div className={`${PANEL} flex min-w-0 flex-1 flex-col gap-2 p-2`}>
      <div className="flex h-8 shrink-0 items-center gap-2 px-1">
        <span className="h-6 w-1.5 shrink-0 rounded" style={{ background: col, boxShadow: `0 0 8px ${col}` }} />
        <span className="min-w-0 truncate font-display text-base font-bold uppercase tracking-wide landscape:text-lg">{name}</span>
      </div>
      <div className="flex shrink-0 justify-center rounded-xl bg-black/60 py-1.5 text-[min(13vh,21vw)] landscape:text-[min(16vh,8vw)]">
        <SevenSeg text={segScore(score)} color={col} size="1em" label={`${name} ${score}`} />
      </div>
      <div className="grid h-20 shrink-0 grid-cols-[minmax(0,1fr)_minmax(0,1fr)_2.75rem] gap-2 landscape:h-[min(16vh,4rem)]">
        <Btn onClick={() => apply(cbPoint(side, 1), tapPoint)} className="flex-col leading-none" tone="base">
          <span className="text-3xl">+1</span><span className="mt-0.5 text-[10px] tracking-[0.2em] text-white/50">boy</span>
        </Btn>
        <Btn onClick={() => apply(cbPoint(side, 2), tapPoint)} className="flex-col leading-none" tone="base">
          <span className="text-3xl">+2</span><span className="mt-0.5 text-[10px] tracking-[0.2em] text-white/50">girl</span>
        </Btn>
        <Btn onClick={() => apply(cbPoint(side, -1), tapUndo)} tone="ghost" className="text-lg" disabled={score < 1}>−1</Btn>
      </div>
      <div className="grid h-12 shrink-0 grid-cols-[2.75rem_minmax(0,1fr)_2.75rem] items-center gap-2 landscape:h-10">
        <Btn onClick={() => apply(cbFoul(side, -1))} tone="ghost" className="h-full text-xl" disabled={st.f[side] < 1}>−</Btn>
        <span className="flex h-full min-w-0 flex-col items-center justify-center gap-0.5 rounded-xl border border-[#2b313c] bg-[#14171d] landscape:flex-row landscape:gap-2">
          <span className="font-display text-[9px] font-bold uppercase tracking-[0.18em] text-[#8b93a1] landscape:text-[11px]">Fouls</span>
          <span className="text-[20px] leading-none landscape:text-[22px]"><SevenSeg text={segScore(st.f[side])} color={CB_FOUL_COLOR} size="1em" glow={false} /></span>
        </span>
        <Btn onClick={() => apply(cbFoul(side, 1), tapPoint)} tone="ghost" className="h-full text-xl">+</Btn>
      </div>
      <Btn tone={mine ? 'warn' : 'call'} className="h-14 shrink-0 gap-3 text-base landscape:h-12"
        disabled={!mine && (other || !live || left < 1)}
        onClick={() => apply(mine ? cbEndTimeout : cbTimeout(side), chimeSwitch)}>
        {mine
          ? <><span>End call</span><span className="tabular inline-block w-[3.2rem] text-left text-xl">{fmtClock(callMs, false)}</span></>
          : <><span>Team call</span><Lamps total={allowed} lit={left} color={CB_CALL_COLOR} /></>}
      </Btn>
    </div>
  )
}

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
  const now = useNow(true, tickMs(st, Date.now()))
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
          sentRev.current = Math.max(sentRev.current, s.st.rev); setOffline(false)
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

  // the screen updates at once; saving happens behind it
  const apply = (act: Act, feel?: () => void) => {
    const next = act(latest.current, Date.now())
    if (next === latest.current) return
    latest.current = next; setSnap(next); feel?.(); void flush()
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
  const nm = (s: Side) => teamName(bundle, tid(s))
  const level = sc.a === sc.b
  const last = isLastPeriod(st)
  const clockOpen = st.phase === 'play' || st.phase === 'ready'
  const endWord = last ? 'Full time' : `End ${ordinal(st.half)} half`
  const matchNo = useMemo(() => bundle.matches
    .filter(x => x.court_id === match.court_id).sort((a, b) => a.sequence - b.sequence)
    .findIndex(x => x.id === match.id) + 1, [bundle.matches, match.id])

  const statusColor = v.running ? '#30d158' : v.toMs > 0 ? CB_CALL_COLOR : v.expired || st.phase === 'over' ? '#ffffff' : '#ffd60a'
  const adj = st.adj
  const adjTxt = `${adj > 0 ? '+' : adj < 0 ? '−' : '±'}${fmtClock(Math.abs(adj), false)}`

  // ---------------------------------------------------------- main button
  const main = (() => {
    const k = 'h-14 w-full text-2xl'
    if (st.phase === 'break') {
      return <Btn tone="go" className={k} onClick={() => apply(cbNextHalf, chimeSwitch)}>▶ Start {ordinal(st.half + 1)} half</Btn>
    }
    if (st.phase === 'over') {
      return level
        ? <div className="grid h-14 grid-cols-2 gap-2">
            <Btn tone="go" className="text-lg" onClick={() => apply(cbExtraTime)}>Extra time {st.r.extra_min}:00</Btn>
            <Btn tone="warn" className="text-lg" onClick={() => setConfirm('finish')}>Finish · draw</Btn>
          </div>
        : <Btn tone="go" className={k} onClick={() => setConfirm('finish')}>Finish game · {sc[left]}–{sc[right]}</Btn>
    }
    if (v.expired) return <Btn tone="warn" className={`${k} animate-pulse`} onClick={() => apply(cbEndHalf)}>{endWord}</Btn>
    if (v.running) return <Btn tone="stop" className={k} onClick={() => apply(cbStop)}>■ Stop clock</Btn>
    return (
      <Btn tone="go" className={k} onClick={() => apply(cbRun)} disabled={v.clock <= 0}>
        ▶ {st.phase === 'ready' ? `Start ${st.et ? 'extra time' : `${ordinal(st.half)} half`}` : 'Resume clock'}
      </Btn>
    )
  })()

  // ------------------------------------------------- info slot (fixed height)
  const info = (() => {
    const base = 'flex h-12 items-center justify-between gap-2 rounded-xl px-3'
    if (v.toMs > 0) {
      return (
        <div className={`${base} border border-[#ff9f0a]/60 bg-[#ff9f0a]/15`}>
          <span className="min-w-0 truncate font-display text-base font-bold uppercase tracking-wide text-[#ffb340]">Team call · {nm(v.toSide!)}</span>
          <span className="shrink-0 text-[30px]"><SevenSeg text={segClock(v.toMs, false)} color={CB_CALL_COLOR} size="1em" /></span>
        </div>
      )
    }
    if (st.phase === 'break') {
      return (
        <div className={`${base} justify-center border border-[#64d2ff]/50 bg-[#64d2ff]/10`}>
          <span className="min-w-0 truncate font-display text-base font-bold uppercase tracking-wide text-[#64d2ff]">Half-time · tap ⇄ SWAP ENDS if needed</span>
        </div>
      )
    }
    const msg = st.phase === 'over' ? (level ? 'Full time · level score' : 'Full time · confirm the result')
      : v.expired ? 'Time up'
      : st.phase === 'ready' ? 'Ready'
      : v.running ? 'Clock running' : 'Clock stopped'
    return (
      <div className={`${base} border border-[#1f242d] bg-black/30`}>
        <span className="min-w-0 truncate font-display text-base font-bold uppercase tracking-wide text-white/70">{msg}</span>
        <span className="shrink-0 text-xs text-white/40">clock adj <span className="tabular inline-block w-12 text-right font-bold text-white/70">{adjTxt}</span></span>
      </div>
    )
  })()

  return (
    <div className="fixed inset-0 flex flex-col gap-2 overflow-y-auto bg-[#06070a] p-2 text-white select-none"
      style={{ paddingTop: 'max(env(safe-area-inset-top), 0.5rem)', paddingBottom: 'max(env(safe-area-inset-bottom), 0.5rem)' }}>
      {/* top bar */}
      <div className="grid h-9 shrink-0 grid-cols-[auto_minmax(0,1fr)_auto] items-center gap-2">
        <Link to={`/c/${code}`} className="rounded-lg border border-white/15 px-3 py-1.5 font-display text-sm font-bold tracking-wide">← BOARD</Link>
        <div className="truncate text-center font-display text-sm font-bold uppercase tracking-[0.12em] text-white/60">
          Court {courtNo} · Game {matchNo || match.sequence}
        </div>
        <span className={`inline-block w-16 text-right text-[11px] ${offline ? 'font-bold text-[#fbbf24]' : 'text-white/40'}`}>
          {offline ? '● saving…' : '● synced'}
        </span>
      </div>

      <div className="my-auto grid shrink-0 grid-cols-2 gap-2 landscape:grid-cols-[minmax(0,1fr)_minmax(0,1.12fr)_minmax(0,1fr)]">
        {/* centre: clock + game controls */}
        <div className={`${PANEL} col-span-2 flex flex-col gap-2 p-2 landscape:order-2 landscape:col-span-1`}>
          <div className="grid h-8 shrink-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)] items-center gap-2 px-1">
            <span className="whitespace-nowrap font-display text-sm font-bold uppercase tracking-[0.06em] text-white">{v.periodLabel}</span>
            <Btn tone={st.phase === 'break' ? 'call' : 'ghost'} className="h-8 px-3 text-xs" onClick={() => apply(cbFlip)}>⇄ SWAP</Btn>
            <span className="flex items-center justify-end gap-1.5 font-display text-sm font-bold uppercase tracking-[0.06em]" style={{ color: statusColor }}>
              <span className={`h-2 w-2 rounded-full ${v.running ? 'animate-pulse' : ''}`} style={{ background: statusColor }} />
              <span className="whitespace-nowrap">{v.status}</span>
            </span>
          </div>
          <div className="flex shrink-0 justify-center rounded-xl bg-black/60 py-2 text-[min(12vh,23vw)] landscape:text-[min(16vh,8vw)]">
            <SevenSeg text={segClock(st.phase === 'break' ? v.brkMs : v.clock)} color={CB_CLOCK_COLOR} size="1em" label={fmtClock(v.clock)} />
          </div>
          {info}
          {main}
          <div className="grid h-11 shrink-0 grid-cols-5 gap-2">
            {[-10000, -1000, 0, 1000, 10000].map(d => d === 0
              ? <Btn key="menu" tone="ghost" className="px-0 text-xl" onClick={() => setMenu(true)} aria-label="Settings">⚙</Btn>
              : (
                <Btn key={d} tone="ghost" className="tabular px-0 text-base" disabled={!clockOpen} onClick={() => apply(cbAdjust(d))}>
                  {d < 0 ? '−' : '+'}{Math.abs(d) / 1000}s
                </Btn>
              ))}
          </div>
        </div>

        <div className="flex min-w-0 landscape:order-1">
          <TeamPanel name={nm(left)} side={left} st={st} score={sc[left]} callMs={v.toMs} callSide={v.toSide} apply={apply} />
        </div>
        <div className="flex min-w-0 landscape:order-3">
          <TeamPanel name={nm(right)} side={right} st={st} score={sc[right]} callMs={v.toMs} callSide={v.toSide} apply={apply} />
        </div>
      </div>

      {conflict && (
        <div className="fixed inset-x-2 bottom-2 z-40 rounded-lg bg-[#f59e0b] px-3 py-2 text-sm font-semibold text-black" onClick={() => setConflict(false)}>
          Another device changed this game — showing the latest. Tap to close.
        </div>
      )}

      {/* more: a sheet over the screen, so the layout under it never moves */}
      {menu && (
        <div className="fixed inset-0 z-40 grid place-items-center bg-black/70 p-4" onClick={() => setMenu(false)}>
          <div className="w-full max-w-md space-y-3 rounded-2xl border border-[#2b313c] bg-[#0f1218] p-4" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between">
              <span className="font-display text-xl font-bold uppercase tracking-wide">More</span>
              <Btn tone="ghost" className="h-9 px-3 text-sm" onClick={() => setMenu(false)}>Close</Btn>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="ghost" className="h-11 text-sm" onClick={() => apply(cbUndo, tapUndo)} disabled={!st.log.length}>↶ Undo last</Btn>
              <Btn tone="ghost" className="h-11 text-sm" onClick={() => { setMenu(false); setConfirm('endhalf') }} disabled={!(st.phase === 'play' && !v.expired)}>{endWord}</Btn>
            </div>
            {(['a', 'b'] as Side[]).map(s => (
              <div key={s} className="grid grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2">
                <span className="truncate text-sm font-semibold"><span className="mr-2 inline-block h-3 w-1.5 rounded align-middle" style={{ background: CB_TEAM_COLOR[s] }} />{nm(s)}</span>
                <Btn tone="ghost" className="h-10 px-3 text-xs" onClick={() => apply(cbGrantTimeout(s, 1))}>+1 team call</Btn>
                <Btn tone="ghost" className="h-10 px-3 text-xs" onClick={() => apply(cbTimeoutBack(s))}
                  disabled={!(st.tou[s][st.et ? st.r.halves : st.half - 1] > 0)}>Give call back</Btn>
              </div>
            ))}
            {st.phase === 'over' && <Btn tone="ghost" className="h-11 w-full text-sm" onClick={() => { apply(cbReopen); setMenu(false) }}>Reopen — not full time yet</Btn>}
            <Btn tone="danger" className="h-11 w-full text-sm" onClick={() => { setMenu(false); setConfirm('restart') }}>Restart game from 0–0</Btn>
          </div>
        </div>
      )}

      {confirm && (
        <div className="fixed inset-0 z-50 grid place-items-center bg-black/75 p-6">
          <div className="w-full max-w-sm space-y-4 rounded-2xl border border-[#2b313c] bg-[#0f1218] p-5 text-center">
            <div className="font-display text-2xl font-bold uppercase">
              {confirm === 'finish' ? `Finish game ${sc[left]}–${sc[right]}?` : confirm === 'endhalf' ? `${endWord} now?` : 'Restart the game?'}
            </div>
            <div className="text-sm text-white/60">
              {confirm === 'finish' && <>The result is locked and the next game starts on this court.{level ? ' Level score = draw.' : ''}</>}
              {confirm === 'endhalf' && (last
                ? <>Stops the game here, before the clock reaches 0:00.</>
                : <>Ends the {ordinal(st.half).toLowerCase()} half before the clock reaches 0:00. Half-time rest ({st.r.rest_min} min) starts. Use ⇄ SWAP ENDS if the teams change sides.</>)}
              {confirm === 'restart' && <>Score, fouls, team calls and the clock go back to the start.</>}
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Btn tone="ghost" className="h-12 text-lg" onClick={() => setConfirm(null)}>Cancel</Btn>
              <Btn tone={confirm === 'restart' ? 'stop' : 'go'} className="h-12 text-lg" onClick={() => {
                if (confirm === 'finish') finish()
                else if (confirm === 'endhalf') { setConfirm(null); apply(cbEndHalf) }
                else { setConfirm(null); apply(cbRestart(st.r)) }
              }}>Yes</Btn>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
