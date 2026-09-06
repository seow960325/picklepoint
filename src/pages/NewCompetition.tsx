import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import * as api from '../lib/api'
import {
  buildDraw, buildDuelDraw, defaultSwitchAt, validateRules, validateDuelSquads,
  type DraftTeam, type DuelTeam,
} from '../lib/draw'
import { rememberCode } from '../lib/store'
import { Section, Field, Stepper, Choice, Warn, input, inputFull } from '../components/form'

const today = () => new Date().toISOString().slice(0, 10)
const pin4 = () => String(Math.floor(Math.random() * 10000)).padStart(4, '0')
type Format = 'round_robin' | 'duel'

export default function NewCompetition() {
  const nav = useNavigate()

  const [format, setFormat] = useState<Format>('round_robin')

  const [name, setName] = useState('')
  const [venue, setVenue] = useState('')
  const [date, setDate] = useState(today())
  const [eventName, setEventName] = useState('Mixed Doubles')

  const [target, setTarget] = useState(15)
  const [winBy, setWinBy] = useState(2)
  const [cap, setCap] = useState(17)
  const [switchAt, setSwitchAt] = useState(8)

  const [courtCount, setCourtCount] = useState(6)
  const [pins, setPins] = useState<string[]>(
    () => Array.from({ length: 12 }, (_, i) => String(i + 1).padStart(4, '0')))
  const [adminPin, setAdminPin] = useState(pin4)

  // round-robin mode
  const [teamText, setTeamText] = useState('')
  const [poolCount, setPoolCount] = useState(1)

  // duel mode
  const [sideAName, setSideAName] = useState('Cambodia')
  const [sideBName, setSideBName] = useState('Malaysia')
  const [sideAText, setSideAText] = useState('')
  const [sideBText, setSideBText] = useState('')

  const [busy, setBusy] = useState(false)
  const [err, setErr] = useState<string | null>(null)
  const [result, setResult] = useState<api.CreateResult | null>(null)

  const applyPreset = (t: number) => {
    setTarget(t); setSwitchAt(defaultSwitchAt(t)); setCap(t + 2)
  }

  const rrTeams: DraftTeam[] = useMemo(() => {
    const names = teamText.split('\n').map(s => s.trim()).filter(Boolean)
    const per = Math.ceil(names.length / poolCount)
    return names.map((n, i) => ({
      name: n,
      pool: poolCount === 1 ? 'A' : String.fromCharCode(65 + Math.floor(i / per)),
    }))
  }, [teamText, poolCount])

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

  const teams = format === 'duel' ? duelTeams : rrTeams
  const draw = useMemo(() => {
    if (format === 'duel') return !duelError && duelTeams.length >= 4
      ? buildDuelDraw(duelTeams, courtCount) : []
    return rrTeams.length >= 2 ? buildDraw(rrTeams, courtCount) : []
  }, [format, duelTeams, duelError, rrTeams, courtCount])

  const ruleError = validateRules({ target_score: target, win_by: winBy, cap, switch_at: switchAt })
  const canCreate = format === 'duel'
    ? (!duelError && !ruleError && !busy)
    : (rrTeams.length >= 2 && !ruleError && !busy)

  const create = async () => {
    setBusy(true); setErr(null)
    try {
      const res = await api.createCompetition({
        name, venue, event_date: date, admin_pin: adminPin,
        event: {
          name: eventName, target_score: target, win_by: winBy, cap, switch_at: switchAt,
          format,
          ...(format === 'duel' ? { side_a_name: sideAName, side_b_name: sideBName } : {}),
        },
        courts: Array.from({ length: courtCount }, (_, i) => ({
          number: i + 1, label: `Court ${i + 1}`, scorer_pin: pins[i],
        })),
        teams, matches: draw,
      })
      rememberCode(res.code)
      setResult(res)
    } catch (e: any) { setErr(e.message) }
    finally { setBusy(false) }
  }

  if (result) return <Created res={result} onOpen={() => nav(`/c/${result.code}`)} />

  return (
    <div className="flex h-full min-h-screen bg-canvas">
      {/* summary rail */}
      <aside className="hidden w-72 shrink-0 flex-col border-r border-line bg-surface p-5 md:flex">
        <Link to="/" className="mb-6 text-xs text-fg-subtle">← back</Link>
        <div className="font-display text-3xl font-bold leading-none tracking-tight text-brand-ink">
          NEW<br />COMPETITION
        </div>

        <dl className="mt-7 space-y-2.5 text-sm">
          <Sum k="Format" v={format === 'duel' ? 'Team Battle' : 'Round Robin'} />
          <Sum k="Name" v={name || '—'} />
          <Sum k="Event" v={eventName || '—'} />
          <Sum k="Scoring" v={`to ${target}, win by ${winBy}, cap ${cap}`} />
          <Sum k="Switch ends" v={`at ${switchAt}`} />
          <Sum k="Courts" v={String(courtCount)} />
          {format === 'duel' ? (
            <>
              <Sum k={sideAName || 'Side A'} v={`${sideANames.length} teams`} />
              <Sum k={sideBName || 'Side B'} v={`${sideBNames.length} teams`} />
              <Sum k="Pods" v={draw.length ? String(draw.length / 4) : '—'} />
            </>
          ) : (
            <>
              <Sum k="Teams" v={String(teams.length)} />
              <Sum k="Pools" v={poolCount === 1 ? 'single' : `${poolCount} pools`} />
            </>
          )}
          <Sum k="Fixtures" v={draw.length ? `${draw.length} matches` : '—'} />
        </dl>

        <div className="mt-auto pt-6">
          {ruleError && <Warn>{ruleError}</Warn>}
          {format === 'duel' && duelError && <Warn>{duelError}</Warn>}
          {format === 'round_robin' && teams.length < 2 && (
            <div className="mb-2 text-xs text-fg-subtle">Add at least two teams.</div>
          )}
          {err && <Warn>{err}</Warn>}
          <button onClick={create} disabled={!canCreate}
            className="mt-2 w-full rounded-xl bg-brand py-3.5 font-display text-lg font-bold tracking-wide text-brand-fg disabled:opacity-30">
            {busy ? 'CREATING…' : 'CREATE COMPETITION'}
          </button>
        </div>
      </aside>

      {/* form */}
      <div className="min-w-0 flex-1 overflow-y-auto">
        <Section n={1} title="Competition">
          <div className="mb-4">
            <Field label="Format">
              <Choice value={format} onChange={setFormat}
                options={[
                  { label: 'Round Robin', value: 'round_robin' },
                  { label: 'Team Battle', value: 'duel' },
                ]} />
            </Field>
            {format === 'duel' && (
              <p className="mt-2 text-xs text-fg-subtle">
                Two sides face off — every team from one side plays every team from
                the other once. Each game's winner scores a point for their side; most
                games won overall wins the whole thing.
              </p>
            )}
          </div>
          <div className="grid gap-3 sm:grid-cols-3">
            <Field label="Competition name" className="sm:col-span-2">
              <input className={inputFull} value={name} onChange={e => setName(e.target.value)}
                placeholder="Puchong Open 2026" />
            </Field>
            <Field label="Date">
              <input type="date" className={inputFull} value={date} onChange={e => setDate(e.target.value)} />
            </Field>
            <Field label="Venue" className="sm:col-span-2">
              <input className={inputFull} value={venue} onChange={e => setVenue(e.target.value)}
                placeholder="IOI Mall Courts" />
            </Field>
            <Field label="Event / category">
              <input className={inputFull} value={eventName} onChange={e => setEventName(e.target.value)}
                placeholder="Mixed Doubles" />
            </Field>
          </div>
        </Section>

        <Section n={2} title="Scoring" hint="applies to every match">
          <div className="mb-4">
            <Field label="Preset">
              <Choice value={target} onChange={applyPreset}
                options={[{ label: 'to 11', value: 11 }, { label: 'to 15', value: 15 }, { label: 'to 21', value: 21 }]} />
            </Field>
          </div>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Winning score"><Stepper value={target} min={1} max={99}
              onChange={v => { setTarget(v); setSwitchAt(defaultSwitchAt(v)) }} /></Field>
            <Field label="Win by"><Stepper value={winBy} min={1} max={5} onChange={setWinBy} /></Field>
            <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
            <Field label="Switch ends at">
              <Stepper value={switchAt} min={0} max={target} onChange={setSwitchAt}
                format={v => v === 0 ? 'OFF' : String(v)} />
            </Field>
          </div>
          {ruleError && <Warn>{ruleError}</Warn>}
          <p className="mt-3 text-xs text-fg-subtle">
            First to {target}, must lead by {winBy}. If it drags on, first to {cap} wins outright.
            {switchAt > 0
              ? ` Players change ends when either side reaches ${switchAt} — the court flips on
                 screen so the buttons keep matching what the referee sees.`
              : ' End-switching is off — teams stay on the same side for the whole game.'}
          </p>
        </Section>

        <Section n={3} title="Courts">
          <div className="flex flex-wrap items-end gap-6">
            <Field label="How many courts"><Stepper value={courtCount} min={1} max={12} onChange={setCourtCount} /></Field>
            <Field label="Admin PIN" >
              <input className={`${input} w-28 tabular`} value={adminPin} maxLength={4}
                inputMode="numeric"
                onChange={e => setAdminPin(e.target.value.replace(/\D/g, '').slice(0, 4))} />
            </Field>
          </div>
          <div className="mt-4 grid grid-cols-3 gap-2 sm:grid-cols-6">
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
        </Section>

        {format === 'round_robin' ? (
          <Section n={4} title="Teams" hint="one per line">
            <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
              <Field label={`Team names — ${teams.length} entered`}>
                <textarea className={`${inputFull} h-44 resize-y font-mono text-[13px] leading-relaxed`}
                  value={teamText} onChange={e => setTeamText(e.target.value)}
                  placeholder={'Smash Bros\nDink Dynasty\nNet Ninjas\nKitchen Kings'} />
              </Field>
              <div className="space-y-4">
                <Field label="Pools">
                  <Choice value={poolCount} onChange={setPoolCount}
                    options={[{ label: 'One group', value: 1 }, { label: '2 pools', value: 2 },
                              { label: '3 pools', value: 3 }, { label: '4 pools', value: 4 }]} />
                </Field>
                {teams.length >= 2 && (
                  <div className="rounded-lg border border-line bg-surface p-3 text-xs">
                    <div className="mb-1.5 font-bold uppercase tracking-wider text-fg-muted">Draw preview</div>
                    <div className="text-fg-muted">{draw.length} matches, {new Set(draw.map(d => d.round)).size} rounds</div>
                    <div className="mt-1 text-fg-subtle">
                      Round robin inside each pool, spread across {courtCount} court{courtCount > 1 ? 's' : ''}.
                      No team is booked on two courts at once.
                    </div>
                  </div>
                )}
              </div>
            </div>
          </Section>
        ) : (
          <Section n={4} title="Sides" hint="one team per line, both sides equal & even">
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Side A name">
                <input className={inputFull} value={sideAName} onChange={e => setSideAName(e.target.value)}
                  placeholder="Cambodia" />
              </Field>
              <Field label="Side B name">
                <input className={inputFull} value={sideBName} onChange={e => setSideBName(e.target.value)}
                  placeholder="Malaysia" />
              </Field>
              <Field label={`${sideAName || 'Side A'} teams — ${sideANames.length} entered`}>
                <textarea className={`${inputFull} h-44 resize-y font-mono text-[13px] leading-relaxed`}
                  value={sideAText} onChange={e => setSideAText(e.target.value)}
                  placeholder={'Team A\nTeam B\nTeam E\nTeam F'} />
              </Field>
              <Field label={`${sideBName || 'Side B'} teams — ${sideBNames.length} entered`}>
                <textarea className={`${inputFull} h-44 resize-y font-mono text-[13px] leading-relaxed`}
                  value={sideBText} onChange={e => setSideBText(e.target.value)}
                  placeholder={'Team C\nTeam D\nTeam G\nTeam H'} />
              </Field>
            </div>
            {duelError && <Warn>{duelError}</Warn>}
            {!duelError && draw.length > 0 && (
              <div className="mt-3 rounded-lg border border-line bg-surface p-3 text-xs">
                <div className="mb-1.5 font-bold uppercase tracking-wider text-fg-muted">Draw preview</div>
                <div className="text-fg-muted">
                  {draw.length / 4} pod{draw.length / 4 > 1 ? 's' : ''} × 4 games = {draw.length} total games,
                  spread across {courtCount} court{courtCount > 1 ? 's' : ''}.
                </div>
                <div className="mt-1 text-fg-subtle">
                  Each pod is 2 {sideAName || 'Side A'} teams vs 2 {sideBName || 'Side B'} teams — every
                  team meets every opposing team in the pod exactly once. Final result is total games won,
                  summed across every pod.
                </div>
              </div>
            )}
          </Section>
        )}

        {/* mobile create button */}
        <div className="p-5 md:hidden">
          {ruleError && <Warn>{ruleError}</Warn>}
          {err && <Warn>{err}</Warn>}
          <button onClick={create} disabled={!canCreate}
            className="w-full rounded-xl bg-brand py-4 font-display text-lg font-bold text-brand-fg disabled:opacity-30">
            {busy ? 'CREATING…' : 'CREATE COMPETITION'}
          </button>
        </div>
      </div>
    </div>
  )
}

const Sum = ({ k, v }: { k: string; v: string }) => (
  <div className="flex justify-between gap-3 border-b border-line/60 pb-1.5">
    <dt className="shrink-0 text-[11px] uppercase tracking-wider text-fg-subtle">{k}</dt>
    <dd className="truncate text-right text-fg">{v}</dd>
  </div>
)

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
