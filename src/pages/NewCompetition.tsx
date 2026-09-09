import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import {
  buildDuelDraw, buildGroupKoDraw, defaultSwitchAt, validateRules,
  validateDuelSquads, validateGroupKo,
  type DuelTeam,
} from '../lib/draw'
import { rememberCode } from '../lib/store'
import { Section, Field, Stepper, Choice, Select, Warn, input, inputFull } from '../components/form'

const today = () => new Date().toISOString().slice(0, 10)
const pin4 = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0')
const CATEGORY_PRESETS = [
  'Mixed Doubles', "Men's Doubles", "Women's Doubles",
  "Men's Singles", "Women's Singles", 'Open / Team Event',
]
type Format = 'duel' | 'groups_ko'

const TOTAL_STEPS = 5

/* ── step indicator ────────────────────────────────────── */
const StepBar = ({ current, total }: { current: number; total: number }) => (
  <div className="flex items-center justify-center gap-1.5 py-4">
    {Array.from({ length: total }, (_, i) => (
      <div key={i} className={`h-1.5 rounded-full transition-all duration-300 ${
        i + 1 === current ? 'w-8 bg-brand' : i + 1 < current ? 'w-4 bg-brand/60' : 'w-4 bg-line'
      }`} />
    ))}
  </div>
)

/* ── nav buttons ───────────────────────────────────────── */
const NavButtons = ({ step, setStep, canNext, onSubmit, busy }: {
  step: number; setStep: (s: number) => void; canNext: boolean
  onSubmit: () => void; busy: boolean
}) => (
  <div className="flex items-center justify-between gap-3 px-1 pt-4">
    {step > 1 ? (
      <button type="button" onClick={() => setStep(step - 1)}
        className="rounded-xl border border-line bg-surface px-6 py-3 font-display text-sm font-bold uppercase tracking-wider text-fg-muted active:bg-surface-2">
        ← Back
      </button>
    ) : (
      <Link to="/"
        className="rounded-xl border border-line bg-surface px-6 py-3 font-display text-sm font-bold uppercase tracking-wider text-fg-muted active:bg-surface-2 text-center">
        Cancel
      </Link>
    )}
    {step < TOTAL_STEPS ? (
      <button type="button" onClick={() => setStep(step + 1)} disabled={!canNext}
        className="rounded-xl bg-brand px-8 py-3 font-display text-sm font-bold uppercase tracking-wider text-brand-fg disabled:opacity-30">
        Next →
      </button>
    ) : (
      <button type="button" onClick={onSubmit} disabled={!canNext || busy}
        className="rounded-xl bg-brand px-8 py-3 font-display text-sm font-bold uppercase tracking-wider text-brand-fg disabled:opacity-30">
        {busy ? 'Creating…' : 'Create Competition'}
      </button>
    )}
  </div>
)

/* ── format card ───────────────────────────────────────── */
const FormatCard = ({ label, desc, icon, active, onClick }: {
  label: string; desc: string; icon: string; active: boolean; onClick: () => void
}) => (
  <button type="button" onClick={onClick}
    className={`flex flex-col items-center gap-2 rounded-2xl border-2 p-6 text-center transition-all ${
      active
        ? 'border-brand bg-brand/10 shadow-lg shadow-brand/10'
        : 'border-line bg-surface hover:border-fg-subtle'
    }`}>
    <span className="text-4xl">{icon}</span>
    <span className="font-display text-lg font-bold tracking-wide">{label}</span>
    <span className="text-xs leading-relaxed text-fg-muted">{desc}</span>
  </button>
)

/* ── main component ────────────────────────────────────── */
export default function NewCompetition() {
  const nav = useNavigate()
  const [step, setStep] = useState(1)

  const [format, setFormat] = useState<Format>('duel')

  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState(today())
  const [code, setCode] = useState('')
  const [eventName, setEventName] = useState('Mixed Doubles')

  const [target, setTarget] = useState(15)
  const [winBy, setWinBy] = useState(2)
  const [cap, setCap] = useState(17)
  const [switchAt, setSwitchAt] = useState(0)

  const [courtCount, setCourtCount] = useState(6)
  const [pins, setPins] = useState<string[]>(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0')))
  const [adminPin, setAdminPin] = useState(pin4)

  // groups_ko mode
  const [groupSize, setGroupSize] = useState(4)
  const [advancePerGroup, setAdvancePerGroup] = useState(2)
  const [thirdPlace, setThirdPlace] = useState(true)
  const [koTeamCount, setKoTeamCount] = useState(16)
  const [koTeamNames, setKoTeamNames] = useState<string[]>(
    () => Array.from({ length: 16 }, () => ''))

  const setKoCount = (n: number) => {
    setKoTeamCount(n)
    setKoTeamNames(prev => {
      const next = prev.slice(0, n)
      while (next.length < n) next.push('')
      return next
    })
  }
  const setKoTeamName = (i: number, v: string) => setKoTeamNames(prev => {
    const next = [...prev]; next[i] = v; return next
  })

  // duel mode
  const [sideAName, setSideAName] = useState('Cambodia')
  const [sideBName, setSideBName] = useState('Malaysia')
  const [sideAText, setSideAText] = useState('')
  const [sideBText, setSideBText] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<api.CreateResult | null>(null)

  const applyPreset = (t: number) => {
    setTarget(t); setSwitchAt(0); setCap(t + 2)
  }


  const sideANames = useMemo(
    () => sideAText.split('\n').map(s => s.trim()).filter(Boolean), [sideAText])
  const sideBNames = useMemo(
    () => sideBText.split('\n').map(s => s.trim()).filter(Boolean), [sideBText])
  const duelTeams: DuelTeam[] = useMemo(() => [
    ...sideANames.map(name => ({ name, side: 'A' as const })),
    ...sideBNames.map(name => ({ name, side: 'B' as const })),
  ], [sideANames, sideBNames])
  const duelError = format === 'duel'
    ? validateDuelSquads(sideANames.length, sideBNames.length) : null

  const koNames = useMemo(
    () => koTeamNames.map(s => s.trim()).filter(Boolean), [koTeamNames])
  const koError = format === 'groups_ko'
    ? validateGroupKo(koNames.length, groupSize, advancePerGroup) : null
  const ko = useMemo(
    () => format === 'groups_ko' && !koError
      ? buildGroupKoDraw(koNames, courtCount,
          { groupSize, advancePerGroup, thirdPlacePlayoff: thirdPlace })
      : null,
    [format, koError, koNames, courtCount, groupSize, advancePerGroup, thirdPlace])

  const teams = format === 'duel' ? duelTeams : (ko?.teams ?? [])
  const draw = useMemo(() => {
    if (format === 'duel') return !duelError && duelTeams.length >= 4
      ? buildDuelDraw(duelTeams, courtCount) : []
    return ko?.groupMatches ?? []
  }, [format, duelTeams, duelError, courtCount, ko])

  const ruleError = validateRules({ target_score: target, win_by: winBy, cap, switch_at: switchAt })
  const codeError = code.trim() && (code.trim().length < 3 || code.trim().length > 12)
    ? 'Join code must be 3-12 letters/numbers.' : null

  /* per-step "can proceed" checks */
  const canStep: Record<number, boolean> = {
    1: true,                                     // format — always valid, one is always selected
    2: !codeError,                               // details — code is the only thing that can be wrong
    3: !ruleError,                               // scoring
    4: true,                                     // courts — always valid
    5: format === 'duel'
      ? (!duelError && !busy)
      : (!koError && !busy),
  }

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await api.createCompetition({
        name, venue, event_date: date, admin_pin: adminPin,
        ...(code.trim() ? { code: code.trim() } : {}),
        event: {
          name: eventName, target_score: target, win_by: winBy, cap, switch_at: switchAt,
          format,
          ...(format === 'duel' ? { side_a_name: sideAName, side_b_name: sideBName } : {}),
          ...(format === 'groups_ko'
            ? { group_size: groupSize, advance_per_group: advancePerGroup, third_place: thirdPlace }
            : {}),
        },
        courts: Array.from({ length: courtCount }, (_, i) => ({
          number: i + 1, label: `Court ${i + 1}`, scorer_pin: pins[i],
        })),
        teams, matches: draw,
        ...(format === 'groups_ko' ? { bracket: ko?.bracket ?? [] } : {}),
      })
      rememberCode(res.code)
      setResult(res)
    } catch (e: any) {
      setErr(e.message === 'CODE_TAKEN' ? 'That join code is already taken — try another.'
        : e.message === 'BAD_CODE' ? 'Join code must be 3-12 letters/numbers.'
        : e.message === 'FROZEN' ? 'New competitions are temporarily paused — please try again later.'
        : e.message)
    }
    finally { setBusy(false) }
  }

  if (result) return <Created res={result} onOpen={() => nav(`/c/${result.code}`)} />

  return (
    <div className="flex min-h-screen flex-col bg-canvas">
      {/* header */}
      <div className="border-b border-line bg-surface px-5 pt-4 pb-1">
        <div className="mx-auto max-w-lg">
          <div className="font-display text-xl font-bold tracking-wide text-brand-ink">
            NEW COMPETITION
          </div>
          <StepBar current={step} total={TOTAL_STEPS} />
        </div>
      </div>

      {/* step content */}
      <div className="mx-auto w-full max-w-lg flex-1 px-5 py-5">

        {/* ── STEP 1: Format ──────────────────────────── */}
        {step === 1 && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Choose a format</h2>
            <p className="mb-5 text-sm text-fg-muted">How should the competition be structured?</p>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <FormatCard icon="⚔️" label="Team Battle"
                desc="Two sides face off — every team from one side plays every team from the other."
                active={format === 'duel'} onClick={() => setFormat('duel')} />
              <FormatCard icon="🏆" label="Groups + Knockout"
                desc="FIFA-style. Group round robin, then a knockout bracket with a final."
                active={format === 'groups_ko'} onClick={() => setFormat('groups_ko')} />
            </div>
          </div>
        )}

        {/* ── STEP 2: Details ─────────────────────────── */}
        {step === 2 && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Competition details</h2>
            <p className="mb-5 text-sm text-fg-muted">Name it, set the date and venue.</p>
            <div className="space-y-4">
              <Field label="Competition name">
                <input className={inputFull} value={name} onChange={e => setName(e.target.value)}
                  placeholder="Puchong Open 2026" />
              </Field>
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field label="Date" className="min-w-0">
                  <input type="date" className={inputFull + ' min-w-0'} value={date} onChange={e => setDate(e.target.value)} />
                </Field>
                <Field label="Venue">
                  <input className={inputFull} value={venue} onChange={e => setVenue(e.target.value)}
                    placeholder="IOI Mall Courts" />
                </Field>
              </div>
              <Field label="Event / category">
                <Select
                  value={CATEGORY_PRESETS.includes(eventName) ? eventName : '__custom__'}
                  onChange={v => setEventName(v === '__custom__' ? '' : v)}
                  options={[
                    ...CATEGORY_PRESETS.map(c => ({ label: c, value: c })),
                    { label: 'Custom…', value: '__custom__' },
                  ]} />
                {!CATEGORY_PRESETS.includes(eventName) && (
                  <input className={`${inputFull} mt-2`} value={eventName}
                    onChange={e => setEventName(e.target.value)} placeholder="Type a category name" />
                )}
              </Field>
              <Field label="Join code (optional)">
                <input className={`${inputFull} font-mono uppercase tracking-wider`}
                  value={code} maxLength={12}
                  onChange={e => setCode(e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, ''))}
                  placeholder="Auto-generated if left blank" />
              </Field>
              {codeError && <Warn>{codeError}</Warn>}
            </div>
          </div>
        )}

        {/* ── STEP 3: Scoring ─────────────────────────── */}
        {step === 3 && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Scoring rules</h2>
            <p className="mb-5 text-sm text-fg-muted">Applies to every match in this competition.</p>
            <div className="space-y-5">
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
              <p className="text-xs text-fg-subtle leading-relaxed">
                First to {target}, must lead by {winBy}. If it drags on, first to {cap} wins outright.
                {switchAt > 0
                  ? ` Players change ends when either side reaches ${switchAt}.`
                  : ' End-switching is off — teams stay on the same side for the whole game.'}
              </p>
            </div>
          </div>
        )}

        {/* ── STEP 4: Courts ──────────────────────────── */}
        {step === 4 && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Courts</h2>
            <p className="mb-5 text-sm text-fg-muted">Set how many courts and their scorer PINs.</p>
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-6">
                <Field label="How many courts">
                  <Stepper value={courtCount} min={1} max={12} onChange={setCourtCount} />
                </Field>
                <Field label="Admin PIN">
                  <input className={`${input} w-28 tabular`} value={adminPin} maxLength={4}
                    inputMode="numeric"
                    onChange={e => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
                </Field>
              </div>
              <div className="grid grid-cols-3 gap-2 sm:grid-cols-4">
                {Array.from({ length: courtCount }, (_, i) => (
                  <Field key={i} label={`Court ${i + 1} PIN`}>
                    <input className={`${inputFull} tabular text-center`} value={pins[i]} maxLength={4}
                      inputMode="numeric"
                      onChange={e => setPins(p => {
                        const n = [...p]; n[i] = e.target.value.replace(/\D/g, '').slice(0, 4); return n
                      })} />
                  </Field>
                ))}
              </div>
            </div>
          </div>
        )}

        {/* ── STEP 5: Teams ───────────────────────────── */}
        {step === 5 && format === 'duel' && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Sides</h2>
            <p className="mb-5 text-sm text-fg-muted">One team per line, both sides equal & even.</p>
            <div className="space-y-4">
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Field label="Side A name">
                  <input className={inputFull} value={sideAName} onChange={e => setSideAName(e.target.value)}
                    placeholder="Cambodia" />
                </Field>
                <Field label="Side B name">
                  <input className={inputFull} value={sideBName} onChange={e => setSideBName(e.target.value)}
                    placeholder="Malaysia" />
                </Field>
                <Field label={`${sideAName || 'Side A'} teams — ${sideANames.length}`}>
                  <textarea className={`${inputFull} h-44 resize-y font-mono text-[13px] leading-relaxed`}
                    value={sideAText} onChange={e => setSideAText(e.target.value)}
                    placeholder={'Team A\nTeam B\nTeam E\nTeam F'} />
                </Field>
                <Field label={`${sideBName || 'Side B'} teams — ${sideBNames.length}`}>
                  <textarea className={`${inputFull} h-44 resize-y font-mono text-[13px] leading-relaxed`}
                    value={sideBText} onChange={e => setSideBText(e.target.value)}
                    placeholder={'Team C\nTeam D\nTeam G\nTeam H'} />
                </Field>
              </div>
              {duelError && <Warn>{duelError}</Warn>}
              {!duelError && draw.length > 0 && (
                <div className="rounded-lg border border-line bg-surface p-3 text-xs">
                  <div className="mb-1.5 font-bold uppercase tracking-wider text-fg-muted">Draw preview</div>
                  <div className="text-fg-muted">
                    {draw.length / 4} pod{draw.length / 4 > 1 ? 's' : ''} × 4 games = {draw.length} total,
                    across {courtCount} court{courtCount > 1 ? 's' : ''}.
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {step === 5 && format === 'groups_ko' && (
          <div>
            <h2 className="mb-1 font-display text-2xl font-bold tracking-wide">Teams & groups</h2>
            <p className="mb-5 text-sm text-fg-muted">Groups are drawn at random.</p>
            <div className="space-y-5">
              <div className="flex flex-wrap items-end gap-4">
                <Field label="How many teams">
                  <Stepper value={koTeamCount} min={6} max={64} onChange={setKoCount} />
                </Field>
                <Field label="Per group">
                  <Stepper value={groupSize} min={3} max={8} onChange={setGroupSize} />
                </Field>
                <Field label="Advance">
                  <Stepper value={advancePerGroup} min={1} max={Math.max(1, groupSize - 1)}
                    onChange={setAdvancePerGroup} />
                </Field>
                <Field label="3rd place">
                  <Choice value={thirdPlace ? 1 : 0} onChange={v => setThirdPlace(v === 1)}
                    options={[{ label: 'Yes', value: 1 }, { label: 'No', value: 0 }]} />
                </Field>
              </div>

              <Field label={`Team names — ${koNames.length} of ${koTeamCount}`}>
                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
                  {Array.from({ length: koTeamCount }, (_, i) => (
                    <input key={i} className={inputFull} value={koTeamNames[i] ?? ''}
                      onChange={e => setKoTeamName(i, e.target.value)}
                      placeholder={`Team ${i + 1}`} />
                  ))}
                </div>
              </Field>

              {koError && <Warn>{koError}</Warn>}
              {ko && (
                <div className="rounded-lg border border-line bg-surface p-3 text-xs">
                  <div className="mb-1.5 font-bold uppercase tracking-wider text-fg-muted">Draw preview</div>
                  <div className="text-fg-muted">
                    {ko.groupCount} group{ko.groupCount > 1 ? 's' : ''} ·{' '}
                    {ko.groupMatches.length} group matches ·{' '}
                    {ko.qualifiers} qualifiers → bracket of {ko.bracketSize}
                    {ko.byes > 0 && `, ${ko.byes} bye${ko.byes > 1 ? 's' : ''}`}.
                  </div>
                  <div className="mt-1.5 flex flex-wrap gap-1">
                    {[...new Set(ko.teams.map(t => t.pool))].sort().map(g => (
                      <span key={g} className="rounded bg-canvas px-1.5 py-0.5 text-fg-subtle">
                        Group {g}: {ko.teams.filter(t => t.pool === g).length}
                      </span>
                    ))}
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

        {/* error from submit */}
        {err && <Warn>{err}</Warn>}

        {/* nav */}
        <NavButtons step={step} setStep={setStep} canNext={canStep[step] ?? true}
          onSubmit={create} busy={busy} />
      </div>
    </div>
  )
}

function Created({ res, onOpen }: { res: api.CreateResult; onOpen: () => void }) {
  return (
    <div className="flex min-h-screen items-center justify-center gap-12 bg-canvas px-10">
      <div className="text-center">
        <div className="text-xs font-bold uppercase tracking-[0.3em] text-fg-subtle">Join code</div>
        <div className="my-2 font-display text-8xl font-bold tracking-[0.15em] text-brand-ink">
          {res.code}
        </div>
        <div className="text-sm text-fg-muted">
          Anyone with this code can watch. Scoring needs a court PIN.
        </div>
        <button onClick={onOpen}
          className="mt-7 rounded-xl bg-brand px-10 py-3.5 font-display text-lg font-bold text-brand-fg">
          OPEN LIVE BOARD
        </button>
      </div>

      <div className="w-72 rounded-2xl border border-line bg-surface p-5">
        <div className="mb-3 flex justify-between text-sm">
          <span className="text-fg-muted">Admin PIN</span>
          <span className="tabular font-display text-xl font-bold text-accent">{res.admin_pin}</span>
        </div>
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
          Court PINs
        </div>
        <div className="grid grid-cols-2 gap-1.5 text-sm">
          {res.courts.map(c => (
            <div key={c.number} className="flex justify-between rounded-lg bg-canvas px-2.5 py-1.5">
              <span className="text-fg-muted">Court {c.number}</span>
              <span className="tabular font-bold">{c.scorer_pin}</span>
            </div>
          ))}
        </div>
        <p className="mt-3 text-[11px] leading-relaxed text-fg-subtle">
          Write these on the scoreboard at each court. Change them any time from
          Admin on the live board.
        </p>
      </div>
    </div>
  )
}
