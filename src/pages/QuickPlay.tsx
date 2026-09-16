/** Quick Play — a single casual game with no competition, courts, teams
 *  roster, or admin PIN at all. Everything lives in local component state;
 *  nothing is written to Supabase. When a game ends, "NEXT GAME" resets the
 *  score and keeps playing with the same settings — there's no "confirm
 *  into a bracket" step because there's no bracket. */
import { useEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Field, Stepper, Choice, Warn, inputFull } from '../components/form'
import { Screen, FullscreenButton } from '../components/ui'
import Court from '../components/Court'
import {
  applyPoint, applyUndo, displayScores, isGameOver, servingSide, serverCourt as serverCourtOf,
  setFirstServer as setFirstServerPure, scoreCall, activeServerNo, type Rules, type UndoState,
} from '../lib/scoring'
import { defaultSwitchAt, validateRules } from '../lib/draw'
import type { Match, ServeMode } from '../lib/types'
import { tapPoint, tapFault, tapUndo, hornEnd, chimeSwitch, isSoundOn, setSoundOn } from '../lib/feedback'
import { useWakeLockEffect } from '../lib/wakelock'
import { useLandscape } from '../lib/orientation'

function blankMatch(): Match {
  return {
    id: 'quick', event_id: 'quick', court_id: null, round: null, sequence: 0,
    team_a_id: 'A', team_b_id: 'B', score_a: 0, score_b: 0,
    a_on_left: true, sides_switched: false,
    last_scorer: null, initial_server: null, serving_team: null, server_no: null,
    status: 'live', winner_id: null, next_match_id: null, next_slot: null,
    started_at: null, finished_at: null, duration_seconds: null,
  }
}

// Persist the in-progress game to localStorage so switching apps/tabs (the
// mobile browser can silently reload the page in the background) doesn't
// wipe the score. Nothing here ever touches Supabase — this is purely a
// same-device "resume where I left off" convenience.
const STORAGE_KEY = 'pp.quickplay.v1'
interface QuickPlayState {
  phase: 'setup' | 'playing'
  teamAName: string; teamBName: string
  target: number; winBy: number; cap: number; switchAt: number
  serveMode: ServeMode
  gameNo: number
  m: Match
}
function loadPersisted(): QuickPlayState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    return raw ? JSON.parse(raw) as QuickPlayState : null
  } catch { return null }
}
function savePersisted(s: QuickPlayState) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(s)) } catch { /* ignore (private mode etc.) */ }
}
function clearPersisted() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* ignore */ }
}

export default function QuickPlay() {
  const saved = useMemo(loadPersisted, [])
  const [phase, setPhase] = useState<'setup' | 'playing'>(saved?.phase ?? 'setup')
  const [teamAName, setTeamAName] = useState(saved?.teamAName ?? 'Team A')
  const [teamBName, setTeamBName] = useState(saved?.teamBName ?? 'Team B')
  const [target, setTarget] = useState(saved?.target ?? 11)
  const [winBy, setWinBy] = useState(saved?.winBy ?? 2)
  const [cap, setCap] = useState(saved?.cap ?? 15)
  const [switchAt, setSwitchAt] = useState(saved?.switchAt ?? 0)
  const [serveMode, setServeMode] = useState<ServeMode>(saved?.serveMode ?? 'winner')

  const ruleError = validateRules({ target_score: target, win_by: winBy, cap, switch_at: switchAt })
  const applyPreset = (t: number) => { setTarget(t); setSwitchAt(0); setCap(t + 4) }

  const [gameNo, setGameNo] = useState(saved?.gameNo ?? 1)
  const [m, setM] = useState<Match>(saved?.m ?? blankMatch)

  const rules: Rules = useMemo(
    () => ({ target_score: target, win_by: winBy, cap, switch_at: switchAt, serve_mode: serveMode }),
    [target, winBy, cap, switchAt, serveMode],
  )

  // keep localStorage in sync with whatever's on screen
  useEffect(() => {
    savePersisted({ phase, teamAName, teamBName, target, winBy, cap, switchAt, serveMode, gameNo, m })
  }, [phase, teamAName, teamBName, target, winBy, cap, switchAt, serveMode, gameNo, m])

  const start = () => { setM(blankMatch()); setGameNo(1); setPhase('playing') }
  const goHome = () => clearPersisted() // leaving Quick Play entirely — don't resume a stale game next visit

  if (phase === 'setup') {
    return (
      <Screen className="flex flex-col items-center justify-center px-6 py-10">
        <div className="w-full max-w-sm">
          <Link to="/" onClick={goHome} className="mb-4 inline-block text-sm text-fg-subtle">← back</Link>
          <div className="mb-1 font-display text-3xl font-bold tracking-wide text-brand-ink">QUICK PLAY</div>
          <p className="mb-6 text-sm text-fg-muted">One game, no setup — start scoring right away.</p>

          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field label="Team / player A">
                <input className={inputFull} value={teamAName} onChange={e => setTeamAName(e.target.value)} />
              </Field>
              <Field label="Team / player B">
                <input className={inputFull} value={teamBName} onChange={e => setTeamBName(e.target.value)} />
              </Field>
            </div>

            <Field label="Preset">
              <Choice value={target} onChange={applyPreset}
                options={[{ label: 'to 11', value: 11 }, { label: 'to 15', value: 15 }, { label: 'to 21', value: 21 }]} />
            </Field>
            <div className="grid grid-cols-2 gap-4">
              <Field label="Winning score">
                <Stepper value={target} min={1} max={99}
                  onChange={v => { setTarget(v); setSwitchAt(s => s > 0 ? defaultSwitchAt(v) : 0) }} />
              </Field>
              <Field label="Win by">
                <Stepper value={winBy} min={1} max={5} onChange={setWinBy} />
              </Field>
              <Field label="Hard cap">
                <Stepper value={cap} min={1} max={120} onChange={setCap} />
              </Field>
              <Field label="Switch ends at">
                <Stepper value={switchAt} min={0} max={target} onChange={setSwitchAt}
                  format={v => v === 0 ? 'OFF' : String(v)} />
              </Field>
            </div>
            {ruleError && <Warn>{ruleError}</Warn>}

            <Field label="Serve mode">
              <Choice value={serveMode}
                onChange={v => { setServeMode(v); if (v === 'alternate') applyPreset(11) }}
                options={[{ label: 'Serve', value: 'alternate' }, { label: 'Winner', value: 'winner' }]} />
            </Field>
            <p className="text-xs text-fg-subtle leading-relaxed">
              {serveMode === 'winner'
                ? 'Winner — every rally scores a point, for whoever wins it.'
                : 'Serve — real doubles side-out scoring: only the serving team can score. Losing a rally while serving passes serve to your partner, then to the other team.'}
            </p>

            <button onClick={start} disabled={!!ruleError}
              className="w-full rounded-2xl bg-brand py-4 font-display text-xl font-bold text-brand-fg disabled:opacity-40">
              START
            </button>
          </div>
        </div>
      </Screen>
    )
  }

  return (
    <Scorer
      key={gameNo}
      match={m} rules={rules} teamAName={teamAName} teamBName={teamBName} gameNo={gameNo}
      onChangeSettings={() => setPhase('setup')}
      onHome={goHome}
      onNextGame={loserWasA => {
        setM({ ...blankMatch(), initial_server: loserWasA === null ? null : (loserWasA ? 'a' : 'b') })
        setGameNo(n => n + 1)
      }}
      setM={setM}
    />
  )
}

// ----------------------------------------------------------------- scorer
function Scorer({ match, rules, teamAName, teamBName, gameNo, onChangeSettings, onHome, onNextGame, setM }: {
  match: Match; rules: Rules; teamAName: string; teamBName: string; gameNo: number
  onChangeSettings: () => void
  onHome: () => void
  onNextGame: (loserWasA: boolean | null) => void
  setM: (m: Match) => void
}) {
  const m = match
  const [showSwitch, setShowSwitch] = useState(false)
  // First-serve picker: pops up before the court is usable, once per game.
  const [serverPicked, setServerPicked] = useState(false)
  const [ignoreRotate, setIgnoreRotate] = useState(false)
  const landscape = useLandscape()
  const history = useRef<[number, number, UndoState][]>([])

  useEffect(useWakeLockEffect, [])

  const score = (side: 'left' | 'right') => {
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
  }

  const undo = () => {
    const prev = history.current.pop()
    if (!prev) return
    tapUndo()
    setM(applyUndo(m, prev[0], prev[1], rules, prev[2]))
  }

  const [confirmingReset, setConfirmingReset] = useState(false)
  const resetTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const reset = () => {
    if (!confirmingReset) {
      setConfirmingReset(true)
      resetTimer.current = setTimeout(() => setConfirmingReset(false), 3000)
      return
    }
    if (resetTimer.current) clearTimeout(resetTimer.current)
    setConfirmingReset(false)
    history.current = []
    setM({
      ...m, score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      last_scorer: null, serving_team: null, server_no: null,
      status: 'live', started_at: null,
    })
  }

  const pickFirstServer = (side: 'left' | 'right') => {
    setServerPicked(true)
    if (m.score_a !== 0 || m.score_b !== 0) return
    const team = (side === 'left') === m.a_on_left ? 'a' : 'b'
    setM(setFirstServerPure(m, team))
  }

  const s = displayScores(m)
  const leftName = m.a_on_left ? teamAName : teamBName
  const rightName = m.a_on_left ? teamBName : teamAName
  const swap = () => setM({ ...m, a_on_left: !m.a_on_left })

  const done = m.status === 'awaiting_confirm' || isGameOver(m.score_a, m.score_b, rules)
  const serving = done ? null : servingSide(m, rules.serve_mode)
  const serverNo = rules.serve_mode === 'alternate' && !done ? activeServerNo(m) : null
  const courtSide = done ? null : serverCourtOf(m, rules.serve_mode)
  const call = done ? null : scoreCall(m, rules.serve_mode)
  const notStarted = !done && m.score_a === 0 && m.score_b === 0
  const hi = Math.max(m.score_a, m.score_b), lo = Math.min(m.score_a, m.score_b)
  const matchPoint = !done && hi >= rules.target_score - 1 && hi - lo >= rules.win_by - 1

  if (!landscape && !ignoreRotate) {
    return (
      <div className="fixed inset-0 flex flex-col items-center justify-center gap-6 bg-canvas px-10">
        <div className="text-center">
          <div className="font-display text-3xl font-bold tracking-wide">ROTATE YOUR PHONE</div>
          <div className="mt-1 text-sm text-fg-muted">The court view needs landscape so both halves stay big enough to tap.</div>
        </div>
        <button onClick={() => setIgnoreRotate(true)} className="text-xs text-fg-subtle underline underline-offset-4">
          score in portrait anyway
        </button>
      </div>
    )
  }

  const isPortrait = !landscape
  const aWon = m.score_a > m.score_b

  return (
    <div className={`fixed inset-0 flex ${isPortrait ? 'flex-col' : ''} bg-canvas no-select`}
      style={{
        paddingTop: 'env(safe-area-inset-top)', paddingBottom: 'env(safe-area-inset-bottom)',
        paddingLeft: 'env(safe-area-inset-left)', paddingRight: 'env(safe-area-inset-right)',
      }}>
      <div className="flex min-w-0 flex-1 flex-col">
        <div className={`flex shrink-0 items-center justify-between gap-2 px-3 ${isPortrait ? 'py-1.5' : 'py-2'}`}>
          <Link to="/" onClick={onHome}
            className={`flex shrink-0 items-center gap-1 rounded-xl border border-line bg-surface/80 font-display font-bold tracking-wide text-fg active:bg-surface-2 ${
              isPortrait ? 'px-3 py-1.5 text-xs' : 'px-4 py-2 text-sm'}`}>
            ← HOME
          </Link>
          <div className={`flex min-w-0 items-baseline gap-2 truncate font-display font-bold tracking-widest text-fg-muted ${
            isPortrait ? 'text-sm' : ''}`}>
            <span className={isPortrait ? 'text-sm' : 'text-base sm:text-lg'}>GAME {gameNo}</span>
            {matchPoint && <span className="shrink-0 animate-pulse text-sm text-brand-ink">MATCH PT</span>}
          </div>
          <div className="flex shrink-0 items-center gap-2.5 text-[11px]">
            <SoundToggle />
            {!isPortrait && <FullscreenButton className="h-5 w-5 shrink-0 text-fg-muted active:text-fg-muted" />}
            <button type="button" onClick={onChangeSettings} className="text-fg-muted underline underline-offset-2">
              SETTINGS
            </button>
          </div>
        </div>

        <div className={isPortrait
          ? 'relative flex min-h-0 flex-1 items-center justify-center px-3'
          : 'relative min-h-0 flex-1 px-2 pb-2'}>
          {isPortrait ? (
            <div className="relative w-full" style={{ maxHeight: '100%', aspectRatio: '2' }}>
              <Court leftName={leftName} rightName={rightName} leftScore={s.left} rightScore={s.right}
                serving={serving} serverNo={serverNo} serverCourt={courtSide} callScore={call} onTap={score} disabled={done} />
              <button onClick={swap}
                className="absolute left-1/2 -bottom-7 -translate-x-1/2 rounded-lg border border-line bg-surface/90 px-3 py-1 font-display text-xs font-bold tracking-wide text-fg-muted active:scale-95">
                ⇄ SWAP
              </button>
            </div>
          ) : (
            <>
              <Court leftName={leftName} rightName={rightName} leftScore={s.left} rightScore={s.right}
                serving={serving} serverNo={serverNo} serverCourt={courtSide} callScore={call} onTap={score} disabled={done} />
              <button onClick={swap}
                className="absolute left-1/2 top-0.5 -translate-x-1/2 rounded-lg border border-line bg-surface/90 px-3 py-1 font-display text-xs font-bold tracking-wide text-fg-muted active:scale-95">
                ⇄ SWAP
              </button>
            </>
          )}
        </div>
      </div>

      <div className={isPortrait
        ? 'flex shrink-0 items-center justify-center gap-3 border-t border-line px-4 py-2.5'
        : 'flex w-[74px] shrink-0 flex-col items-center justify-center gap-2.5 border-l border-line px-2 py-2'}>
        <button onClick={undo} aria-label="Undo"
          className={`rounded-2xl border border-line bg-surface text-fg-muted active:bg-surface-2 ${
            isPortrait ? 'flex h-12 flex-1 items-center justify-center gap-2' : 'flex h-20 w-full flex-col items-center justify-center gap-1.5'}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M9 14 4 9l5-5" /><path d="M4 9h11a5 5 0 0 1 0 10h-2" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">UNDO</span>
        </button>
        <button onClick={reset} aria-label="Reset"
          className={`rounded-2xl border active:bg-surface-2 ${
            confirmingReset ? 'border-red-500 bg-red-500/20 text-red-300' : 'border-line bg-surface text-fg-muted'} ${
            isPortrait ? 'flex h-12 flex-1 items-center justify-center gap-2' : 'flex h-20 w-full flex-col items-center justify-center gap-1.5'}`}>
          <svg viewBox="0 0 24 24" className="h-6 w-6" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 12a9 9 0 1 0 2.6-6.4L3 8" /><path d="M3 3v5h5" />
          </svg>
          <span className="font-display text-xs font-bold tracking-wide">{confirmingReset ? 'SURE?' : 'RESET'}</span>
        </button>
      </div>

      {notStarted && !serverPicked && (
        <div className="absolute inset-0 z-40 flex flex-col items-center justify-center gap-6 bg-canvas px-8">
          <div className="text-center">
            <div className="font-display text-3xl font-bold tracking-wide">WHO SERVES FIRST?</div>
            <div className="mt-1 text-sm text-fg-muted">Referee picks before the game starts.</div>
          </div>
          <div className="flex w-full max-w-sm gap-3">
            <button type="button" onClick={() => pickFirstServer('left')}
              className="flex-1 rounded-2xl bg-brand py-6 font-display text-xl font-bold text-brand-fg active:scale-[0.98]">
              {leftName}
            </button>
            <button type="button" onClick={() => pickFirstServer('right')}
              className="flex-1 rounded-2xl bg-brand py-6 font-display text-xl font-bold text-brand-fg active:scale-[0.98]">
              {rightName}
            </button>
          </div>
        </div>
      )}

      {showSwitch && (
        <button onClick={() => setShowSwitch(false)}
          className="absolute inset-0 z-20 flex flex-col items-center justify-center gap-4 bg-brand px-8 text-brand-fg">
          <div className={`font-display font-bold leading-none tracking-tight ${isPortrait ? 'text-4xl' : 'text-6xl'}`}>SWITCH ENDS</div>
          <div className={`text-center font-semibold ${isPortrait ? 'text-sm' : 'text-base'}`}>
            Score reached {rules.switch_at}. Players change sides — the court has flipped to match.
          </div>
          <div className={`rounded-2xl bg-canvas/15 font-display font-bold ${isPortrait ? 'px-6 py-2.5 text-lg' : 'px-8 py-3 text-xl'}`}>
            TAP TO CONTINUE
          </div>
        </button>
      )}

      {done && (
        <div className={`absolute inset-0 z-30 flex items-center justify-center bg-canvas ${isPortrait ? 'flex-col gap-6 px-8' : 'gap-10 px-10'}`}>
          <div className={`space-y-2 ${isPortrait ? 'w-full max-w-xs' : 'w-full max-w-sm'}`}>
            <div className="mb-3 font-display text-xl font-bold tracking-widest text-fg-muted">GAME {gameNo}</div>
            <ResultRow name={teamAName} score={m.score_a} win={aWon} />
            <ResultRow name={teamBName} score={m.score_b} win={!aWon} />
          </div>
          <div className={`space-y-3 ${isPortrait ? 'w-full max-w-xs' : 'w-56'}`}>
            <button onClick={() => onNextGame(aWon)}
              className="w-full rounded-2xl bg-brand py-4 font-display text-xl font-bold text-brand-fg">
              NEXT GAME
            </button>
            <button onClick={undo}
              className="w-full rounded-2xl border border-line py-4 font-display text-xl font-bold text-fg-muted">
              REVIEW
            </button>
            <button onClick={onChangeSettings}
              className="w-full rounded-2xl border border-line py-3 font-display text-sm font-bold text-fg-subtle">
              CHANGE SETTINGS
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

function ResultRow({ name, score, win }: { name: string; score: number; win: boolean }) {
  return (
    <div className={`flex items-center justify-between rounded-xl border px-4 py-3 ${win ? 'border-brand-ink bg-brand/10' : 'border-line'}`}>
      <span className="truncate font-display text-xl font-bold">{name}</span>
      <span className="tabular font-display text-4xl font-bold">{score}</span>
    </div>
  )
}

function SoundToggle() {
  const [on, setOn] = useState(isSoundOn())
  return (
    <button type="button" title={on ? 'Sound on — tap to mute' : 'Sound off — tap to unmute'}
      aria-label={on ? 'Mute sound' : 'Unmute sound'}
      onClick={() => { const v = !on; setSoundOn(v); setOn(v) }}
      className="shrink-0 text-fg-muted active:text-fg">
      <svg viewBox="0 0 24 24" className="h-5 w-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <path d="M11 5 6 9H2v6h4l5 4V5z" />
        {on
          ? <><path d="M15.5 8.5a5 5 0 0 1 0 7" /><path d="M18.5 5.5a9 9 0 0 1 0 13" /></>
          : <><line x1="22" y1="9" x2="16" y2="15" /><line x1="16" y1="9" x2="22" y2="15" /></>}
      </svg>
    </button>
  )
}
