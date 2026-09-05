import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useCompetition, teamName } from '../lib/store'
import * as api from '../lib/api'
import {
  buildDraw, buildDuelDraw, defaultSwitchAt, validateRules, validateDuelSquads,
  type DraftTeam, type DuelTeam,
} from '../lib/draw'
import { Screen, Spinner } from '../components/ui'
import { Flag } from '../components/ui'
import { Field, Stepper, Choice, Warn, input, inputFull } from '../components/form'

const tokKey = (code: string) => `pp.admin.${code}`
type Tab = 'competition' | 'scoring' | 'teams' | 'courts' | 'schedule'

export default function Admin() {
  const { code } = useParams()
  const { bundle, reload } = useCompetition(code)
  const [token, setToken] = useState<string | null>(() => localStorage.getItem(tokKey(code!)))

  if (!bundle) return <Screen><Spinner /></Screen>
  if (!token) return <AdminGate code={code!} onIn={t => {
    localStorage.setItem(tokKey(code!), t); setToken(t)
  }} />

  return <Panel bundle={bundle} token={token} code={code!} reload={reload}
    onLogout={() => { localStorage.removeItem(tokKey(code!)); setToken(null) }} />
}

function AdminGate({ code, onIn }: { code: string; onIn: (t: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)

  const submit = async (v: string) => {
    try { onIn(await api.adminLogin(code, v)) }
    catch { setErr(true); setPin('') }
  }
  const press = (d: string) => {
    setErr(false)
    const n = (pin + d).slice(0, 4)
    setPin(n)
    if (n.length === 4) submit(n)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center gap-10 bg-ink px-8">
      <Link to={`/c/${code}`} className="absolute left-4 top-3 text-sm text-gray-600">← board</Link>
      <div className="text-right">
        <div className="font-display text-4xl font-bold tracking-widest text-gray-500">SETTINGS</div>
        <div className="mt-1 text-sm text-gray-600">Admin PIN for {code}</div>
        <div className="mt-5 flex justify-end gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${
              err ? 'border-red-500' : pin.length > i ? 'border-cyan bg-cyan' : 'border-edge'}`} />
          ))}
        </div>
      </div>
      <div className="grid w-64 grid-cols-3 gap-2.5">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} disabled={!k}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k && press(k)}
            className={`h-14 rounded-xl font-display text-2xl font-bold ${
              k ? 'border border-edge bg-panel active:bg-edge' : 'invisible'}`}>{k}</button>
        ))}
      </div>
    </div>
  )
}

function Panel({ bundle, token, code, reload, onLogout }: {
  bundle: any; token: string; code: string; reload: () => void; onLogout: () => void
}) {
  const [tab, setTab] = useState<Tab>('competition')
  const [msg, setMsg] = useState<string | null>(null)
  const [err, setErr] = useState<string | null>(null)
  const [secrets, setSecrets] = useState<api.AdminBundle | null>(null)

  useEffect(() => { api.adminBundle(token).then(setSecrets).catch(() => {}) }, [token])

  const run = async (fn: () => Promise<any>, ok: string) => {
    setErr(null); setMsg(null)
    try { await fn(); reload(); setMsg(ok); setTimeout(() => setMsg(null), 2500) }
    catch (e: any) { setErr(readable(e.message)) }
  }

  const ev = bundle.events[0]

  return (
    <div className="flex min-h-screen bg-ink">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-edge bg-panel p-4 md:flex">
        <Link to={`/c/${code}`} className="mb-5 text-xs text-gray-600">← live board</Link>
        <div className="mb-1 font-display text-2xl font-bold tracking-wide">SETTINGS</div>
        <div className="mb-5 text-xs text-gray-600">
          code <span className="font-bold text-lime">{code}</span>
        </div>
        <nav className="space-y-1">
          {(['competition','scoring','teams','courts','schedule'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold capitalize ${
                tab === t ? 'bg-lime text-ink' : 'text-gray-400 hover:text-white'}`}>
              {t}
            </button>
          ))}
        </nav>
        <button onClick={onLogout} className="mt-auto text-xs text-gray-600 underline underline-offset-4">
          lock settings
        </button>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
          {(['competition','scoring','teams','courts','schedule'] as Tab[]).map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold uppercase ${
                tab === t ? 'bg-lime text-ink' : 'text-gray-500'}`}>{t}</button>
          ))}
        </div>

        {msg && <div className="mb-4 rounded-lg border border-lime/40 bg-lime/10 px-3 py-2 text-sm text-lime">{msg}</div>}
        {err && <Warn>{err}</Warn>}

        {tab === 'competition' && <CompetitionTab bundle={bundle} token={token} run={run} secrets={secrets} />}
        {tab === 'scoring' && <ScoringTab ev={ev} token={token} run={run} />}
        {tab === 'teams' && <TeamsTab bundle={bundle} ev={ev} token={token} run={run} />}
        {tab === 'courts' && <CourtsTab bundle={bundle} token={token} run={run} secrets={secrets}
          refreshSecrets={() => api.adminBundle(token).then(setSecrets)} />}
        {tab === 'schedule' && <ScheduleTab bundle={bundle} ev={ev} token={token} run={run} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ tabs
function CompetitionTab({ bundle, token, run, secrets }: any) {
  const c = bundle.competition
  const [name, setName] = useState(c.name)
  const [venue, setVenue] = useState(c.venue ?? '')
  return (
    <div className="max-w-xl space-y-4">
      <H>Competition</H>
      <Field label="Name">
        <input className={inputFull} value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label="Venue">
        <input className={inputFull} value={venue} onChange={e => setVenue(e.target.value)} />
      </Field>
      <Save onClick={() => run(() => api.adminUpdateCompetition(token, name, venue), 'Competition updated')} />

      <div className="mt-8 rounded-xl border border-edge bg-panel p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-gray-600">Access</div>
        <Row k="Join code (share freely)" v={c.code} accent="lime" />
        {secrets && <Row k="Admin PIN (keep private)" v={secrets.competition.admin_pin} accent="cyan" />}
      </div>
    </div>
  )
}

function ScoringTab({ ev, token, run }: any) {
  const [name, setName] = useState(ev.name)
  const [t, setT] = useState(ev.target_score)
  const [w, setW] = useState(ev.win_by)
  const [cap, setCap] = useState(ev.cap)
  const [sw, setSw] = useState(ev.switch_at)
  const [aName, setAName] = useState(ev.side_a_name ?? '')
  const [bName, setBName] = useState(ev.side_b_name ?? '')
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: sw })
  const isDuel = ev.format === 'duel'

  return (
    <div className="max-w-2xl space-y-5">
      <H>Scoring</H>
      <Field label="Event name">
        <input className={`${inputFull} max-w-sm`} value={name} onChange={e => setName(e.target.value)} />
      </Field>
      {isDuel && (
        <div className="grid gap-3 sm:grid-cols-2">
          <Field label="Side A name">
            <input className={inputFull} value={aName} onChange={e => setAName(e.target.value)} />
          </Field>
          <Field label="Side B name">
            <input className={inputFull} value={bName} onChange={e => setBName(e.target.value)} />
          </Field>
        </div>
      )}
      <Field label="Preset">
        <Choice value={t} onChange={(v: number) => { setT(v); setSw(defaultSwitchAt(v)); setCap(v + 2) }}
          options={[{ label: 'to 11', value: 11 }, { label: 'to 15', value: 15 }, { label: 'to 21', value: 21 }]} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-4">
        <Field label="Winning score">
          <Stepper value={t} min={1} max={99} onChange={v => { setT(v); setSw(defaultSwitchAt(v)) }} />
        </Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
        <Field label="Switch ends at">
          <Stepper value={sw} min={0} max={t} onChange={setSw} format={v => v === 0 ? 'OFF' : String(v)} />
        </Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-gray-600">
        Changes apply to every match, including ones already in progress.
      </p>
      <Save disabled={!!bad}
        onClick={() => run(() => api.adminUpdateEvent(token, ev.id, name,
          { target_score: t, win_by: w, cap, switch_at: sw, side_a_name: aName, side_b_name: bName }),
          'Scoring updated')} />
    </div>
  )
}

function TeamsTab({ bundle, ev, token, run }: any) {
  const isDuel = ev.format === 'duel'
  const teams = bundle.teams.filter((t: any) => t.event_id === ev.id)
  const [adding, setAdding] = useState('')
  const [addSide, setAddSide] = useState<'A' | 'B'>('A')

  const addTeam = () => {
    if (!adding.trim()) return
    run(() => api.adminUpsertTeam(token, ev.id, null, adding.trim(), 'A', isDuel ? addSide : undefined),
      'Team added')
    setAdding('')
  }

  const sideA = isDuel ? teams.filter((t: any) => t.side === 'A') : []
  const sideB = isDuel ? teams.filter((t: any) => t.side === 'B') : []

  return (
    <div className="max-w-2xl space-y-4">
      <H>Teams</H>

      {isDuel ? (
        <div className="grid gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-lime">
              {ev.side_a_name || 'Side A'} — {sideA.length}
            </div>
            <div className="divide-y divide-edge rounded-xl border border-edge">
              {sideA.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} isDuel />)}
              {!sideA.length && <div className="p-3 text-xs text-gray-600">No teams yet.</div>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-cyan">
              {ev.side_b_name || 'Side B'} — {sideB.length}
            </div>
            <div className="divide-y divide-edge rounded-xl border border-edge">
              {sideB.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} isDuel />)}
              {!sideB.length && <div className="p-3 text-xs text-gray-600">No teams yet.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-edge rounded-xl border border-edge">
          {teams.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} />)}
          {!teams.length && <div className="p-4 text-sm text-gray-600">No teams yet.</div>}
        </div>
      )}

      <div className="flex gap-2">
        <input className={inputFull} value={adding} placeholder="Add a team…"
          onChange={e => setAdding(e.target.value)}
          onKeyDown={e => { if (e.key === 'Enter') addTeam() }} />
        {isDuel && (
          <Choice value={addSide} onChange={setAddSide}
            options={[{ label: ev.side_a_name || 'A', value: 'A' }, { label: ev.side_b_name || 'B', value: 'B' }]} />
        )}
        <button disabled={!adding.trim()} onClick={addTeam}
          className="shrink-0 rounded-lg bg-lime px-5 font-display font-bold text-ink disabled:opacity-30">
          ADD
        </button>
      </div>
      <p className="text-xs text-gray-600">
        Renaming is safe at any time — the schedule follows the team, not the name.
        A team that has already finished a match cannot be deleted.
        {isDuel && ' Both sides need equal, even squad sizes before you can regenerate the schedule.'}
      </p>
    </div>
  )
}

function TeamRow({ t, ev, token, run, isDuel }: any) {
  const [name, setName] = useState(t.name)
  const [pool, setPool] = useState(t.pool ?? 'A')
  const [side, setSide] = useState<'A' | 'B'>(t.side ?? 'A')
  const dirty = isDuel ? (name !== t.name || side !== (t.side ?? 'A')) : (name !== t.name || pool !== (t.pool ?? 'A'))
  return (
    <div className="flex items-center gap-2 p-2.5">
      <input className={`${input} min-w-0 flex-1`} value={name} onChange={e => setName(e.target.value)} />
      {isDuel ? (
        <button onClick={() => setSide(side === 'A' ? 'B' : 'A')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-center text-xs font-bold ${
            side === 'A' ? 'border-lime/40 text-lime' : 'border-cyan/40 text-cyan'}`}>
          <Flag name={side === 'A' ? ev.side_a_name : ev.side_b_name} className="h-3.5 w-auto rounded-[1px]" />
          {side === 'A' ? (ev.side_a_name || 'A') : (ev.side_b_name || 'B')}
        </button>
      ) : (
        <input className={`${input} w-16 text-center uppercase`} value={pool} maxLength={2}
          onChange={e => setPool(e.target.value.toUpperCase())} />
      )}
      <button disabled={!dirty}
        onClick={() => run(() => api.adminUpsertTeam(token, ev.id, t.id, name, pool, isDuel ? side : undefined), 'Team saved')}
        className="shrink-0 rounded-lg bg-lime px-3 py-2 text-xs font-bold text-ink disabled:opacity-20">
        SAVE
      </button>
      <button onClick={() => run(() => api.adminDeleteTeam(token, t.id), 'Team removed')}
        className="shrink-0 rounded-lg border border-edge px-3 py-2 text-xs text-gray-500 hover:text-red-400">
        ✕
      </button>
    </div>
  )
}

function CourtsTab({ bundle, token, run, secrets, refreshSecrets }: any) {
  return (
    <div className="max-w-xl space-y-4">
      <H>Courts</H>
      <div className="space-y-2">
        {bundle.courts.map((c: any) => (
          <CourtRow key={c.id} c={c} token={token} run={run}
            pin={secrets?.courts.find((x: any) => x.id === c.id)?.scorer_pin ?? ''}
            after={refreshSecrets} />
        ))}
      </div>
      <p className="text-xs text-gray-600">
        Changing a PIN signs out any device currently scoring that court, so they
        have to re-enter it. Use that if a phone walks off.
      </p>
    </div>
  )
}

function CourtRow({ c, token, run, pin, after }: any) {
  const [v, setV] = useState(pin)
  useEffect(() => setV(pin), [pin])
  return (
    <div className="flex items-center gap-3 rounded-xl border border-edge bg-panel p-3">
      <div className="w-24 font-display text-lg font-bold text-gray-400">COURT {c.number}</div>
      <input className={`${input} tabular w-24 text-center`} value={v} maxLength={4} inputMode="numeric"
        onChange={e => setV(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      <button disabled={v === pin || v.length !== 4}
        onClick={() => run(async () => { await api.adminSetCourtPin(token, c.id, v); await after?.() }, `Court ${c.number} PIN changed`)}
        className="rounded-lg bg-lime px-4 py-2 text-xs font-bold text-ink disabled:opacity-20">
        SAVE
      </button>
    </div>
  )
}

function ScheduleTab({ bundle, ev, token, run }: any) {
  const isDuel = ev.format === 'duel'
  const teams = bundle.teams.filter((t: any) => t.event_id === ev.id)
  const started = bundle.matches.some((m: any) =>
    m.status === 'finished' || m.score_a > 0 || m.score_b > 0)

  const duelError = isDuel
    ? validateDuelSquads(
        teams.filter((t: any) => t.side === 'A').length,
        teams.filter((t: any) => t.side === 'B').length)
    : null

  const preview = isDuel
    ? (!duelError ? buildDuelDraw(
        teams.map((t: any) => ({ name: t.name, side: t.side }) as DuelTeam), bundle.courts.length) : [])
    : (teams.length >= 2 ? buildDraw(
        teams.map((t: any) => ({ name: t.name, pool: t.pool ?? 'A' }) as DraftTeam), bundle.courts.length) : [])

  return (
    <div className="max-w-2xl space-y-4">
      <H>Schedule</H>
      <div className="rounded-xl border border-edge bg-panel p-4 text-sm">
        <div className="text-gray-300">
          {bundle.matches.length} fixtures ·{' '}
          {bundle.matches.filter((m: any) => m.status === 'finished').length} played
        </div>
        <div className="mt-1 text-xs text-gray-600">
          {isDuel
            ? `Regenerating rebuilds the pods from the current side rosters and spreads them over ${bundle.courts.length} court${bundle.courts.length > 1 ? 's' : ''} — ${preview.length} games.`
            : `Regenerating builds a fresh round robin from the current team list and spreads it over ${bundle.courts.length} court${bundle.courts.length > 1 ? 's' : ''} — ${preview.length} matches.`}
        </div>
      </div>
      {isDuel && duelError && <Warn>{duelError}</Warn>}
      {started ? (
        <Warn>
          Matches have already been played, so the schedule is locked. Regenerating
          would throw away results.
        </Warn>
      ) : (
        <button
          onClick={() => run(() => api.adminReplaceSchedule(
            token, ev.id, preview,
            teams.map((t: any) => t.id), bundle.courts.map((c: any) => c.id)), 'Schedule regenerated')}
          disabled={preview.length === 0}
          className="rounded-xl bg-lime px-6 py-3 font-display font-bold text-ink disabled:opacity-30">
          REGENERATE SCHEDULE
        </button>
      )}

      <div className="mt-4 divide-y divide-edge rounded-xl border border-edge text-sm">
        {bundle.matches.slice().sort((a: any, b: any) => a.sequence - b.sequence).slice(0, 40)
          .map((m: any) => (
            <div key={m.id} className="flex items-center gap-3 px-3 py-2">
              <span className="w-7 text-center text-xs text-gray-600">
                {bundle.courts.find((c: any) => c.id === m.court_id)?.number ?? '–'}
              </span>
              <span className="min-w-0 flex-1 truncate">
                {teamName(bundle, m.team_a_id)} <span className="text-gray-600">vs</span> {teamName(bundle, m.team_b_id)}
              </span>
              <span className="tabular text-xs text-gray-500">
                {m.status === 'scheduled' ? m.round : `${m.score_a}–${m.score_b}`}
              </span>
            </div>
          ))}
      </div>
    </div>
  )
}

// ----------------------------------------------------------- bits
const H = ({ children }: any) =>
  <h1 className="font-display text-2xl font-bold tracking-wide">{children}</h1>

const Save = ({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) => (
  <button onClick={onClick} disabled={disabled}
    className="rounded-xl bg-lime px-6 py-2.5 font-display font-bold text-ink disabled:opacity-30">
    SAVE
  </button>
)

const Row = ({ k, v, accent }: { k: string; v: string; accent: 'lime' | 'cyan' }) => (
  <div className="flex items-center justify-between border-t border-edge/60 py-2 text-sm first:border-0">
    <span className="text-gray-500">{k}</span>
    <span className={`tabular font-display text-xl font-bold ${accent === 'lime' ? 'text-lime' : 'text-cyan'}`}>
      {v}
    </span>
  </div>
)

const readable = (m: string) => ({
  TEAM_HAS_RESULTS: 'That team has already finished a match, so it can\'t be deleted.',
  SCHEDULE_IN_PROGRESS: 'Matches are already under way — the schedule is locked.',
  CAP_TOO_LOW: 'The cap is too low for that winning score and win-by.',
  BAD_SWITCH_AT: 'Switch-ends score must be between 1 and the winning score.',
  PIN_MUST_BE_4_DIGITS: 'Court PINs must be exactly 4 digits.',
  NOT_ADMIN: 'Your settings session expired — enter the admin PIN again.',
}[m] ?? m)
