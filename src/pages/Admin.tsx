import { useEffect, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, teamLogo, forgetCode,
  groupStandings, groupStageComplete, bracketSeeded, qualifiers, bracketRounds,
} from '../lib/store'
import * as api from '../lib/api'
import {
  buildDraw, buildDuelDraw, defaultSwitchAt, validateRules, validateDuelSquads,
  seedBracket, nextPowerOfTwo,
  type DraftTeam, type DuelTeam,
} from '../lib/draw'
import { Screen, Spinner, ThemeToggle, Emblem } from '../components/ui'
import { Flag } from '../components/ui'
import { Field, Stepper, Choice, Warn, input, inputFull } from '../components/form'
import { resizeImage } from '../lib/image'

const TOKEN_TTL_MS = 4 * 60 * 60 * 1000
const tokKey = (code: string) => `pp.admin.${code}`
function readToken(code: string): string | null {
  try {
    const raw = localStorage.getItem(tokKey(code))
    if (!raw) return null
    const { t, exp } = JSON.parse(raw)
    if (!t || !exp || Date.now() > exp) { localStorage.removeItem(tokKey(code)); return null }
    return t as string
  } catch { localStorage.removeItem(tokKey(code)); return null }
}
function writeToken(code: string, t: string) {
  localStorage.setItem(tokKey(code), JSON.stringify({ t, exp: Date.now() + TOKEN_TTL_MS }))
}
type Tab = 'competition' | 'scoring' | 'teams' | 'courts' | 'schedule' | 'bracket'

export default function Admin() {
  const { code } = useParams()
  const { bundle, reload } = useCompetition(code)
  const [token, setToken] = useState<string | null>(() => readToken(code!))

  if (!bundle) return <Screen><Spinner /></Screen>
  if (!token) return <AdminGate code={code!} onIn={t => {
    writeToken(code!, t); setToken(t)
  }} />

  return <Panel bundle={bundle} token={token} code={code!} reload={reload}
    onLogout={() => { localStorage.removeItem(tokKey(code!)); setToken(null) }} />
}

function AdminGate({ code, onIn }: { code: string; onIn: (t: string) => void }) {
  const [pin, setPin] = useState('')
  const [err, setErr] = useState(false)
  const [locked, setLocked] = useState(false)

  const submit = async (v: string) => {
    try { onIn(await api.adminLogin(code, v)) }
    catch (e: any) {
      setErr(true); setPin('')
      setLocked(e?.message === 'LOCKED')
    }
  }
  const press = (d: string) => {
    setErr(false)
    setLocked(false)
    const n = (pin + d).slice(0, 4)
    setPin(n)
    if (n.length === 4) submit(n)
  }

  return (
    <div className="fixed inset-0 flex items-center justify-center gap-10 bg-canvas px-8">
      <Link to={`/c/${code}`} className="absolute left-4 top-3 text-sm text-fg-subtle">← board</Link>
      <div className="text-right">
        <div className="font-display text-4xl font-bold tracking-widest text-fg-muted">SETTINGS</div>
        <div className="mt-1 text-sm text-fg-subtle">Admin PIN for {code}</div>
        {locked && (
          <div className="mt-2 text-xs font-semibold text-red-500">Too many attempts — try again in a minute</div>
        )}
        <div className="mt-5 flex justify-end gap-3">
          {[0, 1, 2, 3].map(i => (
            <div key={i} className={`h-3.5 w-3.5 rounded-full border-2 ${
              err ? 'border-red-500' : pin.length > i ? 'border-accent bg-accent' : 'border-line'}`} />
          ))}
        </div>
      </div>
      <div className="grid w-64 grid-cols-3 gap-2.5">
        {['1','2','3','4','5','6','7','8','9','','0','⌫'].map((k, i) => (
          <button key={i} disabled={!k}
            onClick={() => k === '⌫' ? setPin(p => p.slice(0, -1)) : k && press(k)}
            className={`h-14 rounded-xl font-display text-2xl font-bold ${
              k ? 'border border-line bg-surface active:bg-surface-2' : 'invisible'}`}>{k}</button>
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
  const tabs: Tab[] = ['competition', 'scoring', 'teams', 'courts', 'schedule',
    ...(ev?.format === 'groups_ko' ? ['bracket' as Tab] : [])]

  return (
    <div className="flex min-h-screen bg-canvas">
      <aside className="hidden w-56 shrink-0 flex-col border-r border-line bg-surface p-4 md:flex">
        <Link to={`/c/${code}`} className="mb-5 text-xs text-fg-subtle">← live board</Link>
        <div className="mb-1 font-display text-2xl font-bold tracking-wide">SETTINGS</div>
        <div className="mb-5 text-xs text-fg-subtle">
          code <span className="font-bold text-brand-ink">{code}</span>
        </div>
        <nav className="space-y-1">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`block w-full rounded-lg px-3 py-2 text-left text-sm font-semibold capitalize ${
                tab === t ? 'bg-brand text-brand-fg' : 'text-fg-muted hover:text-fg'}`}>
              {t}
            </button>
          ))}
        </nav>
        <div className="mt-auto flex items-center justify-between">
          <button onClick={onLogout} className="text-xs text-fg-subtle underline underline-offset-4">
            lock settings
          </button>
          <ThemeToggle className="grid h-8 w-8 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2" />
        </div>
      </aside>

      <div className="min-w-0 flex-1 overflow-y-auto p-6">
        <div className="mb-4 flex gap-1 overflow-x-auto md:hidden">
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 rounded-lg px-3 py-1.5 text-xs font-bold uppercase ${
                tab === t ? 'bg-brand text-brand-fg' : 'text-fg-muted'}`}>{t}</button>
          ))}
        </div>

        {msg && <div className="mb-4 rounded-lg border border-brand-ink/40 bg-brand/10 px-3 py-2 text-sm text-brand-ink">{msg}</div>}
        {err && <Warn>{err}</Warn>}

        {tab === 'competition' && <CompetitionTab bundle={bundle} token={token} run={run} secrets={secrets}
          refreshSecrets={() => api.adminBundle(token).then(setSecrets)} />}
        {tab === 'scoring' && <ScoringTab ev={ev} token={token} run={run} />}
        {tab === 'teams' && <TeamsTab bundle={bundle} ev={ev} token={token} run={run} />}
        {tab === 'courts' && <CourtsTab bundle={bundle} token={token} run={run} secrets={secrets}
          refreshSecrets={() => api.adminBundle(token).then(setSecrets)} />}
        {tab === 'schedule' && <ScheduleTab bundle={bundle} ev={ev} token={token} run={run} />}
        {tab === 'bracket' && <BracketTab bundle={bundle} ev={ev} token={token} run={run} />}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ tabs
function CompetitionTab({ bundle, token, run, secrets, refreshSecrets }: any) {
  const c = bundle.competition
  const [name, setName] = useState(c.name)
  const [venue, setVenue] = useState(c.venue ?? '')
  const [eventDate, setEventDate] = useState(c.event_date ?? '')
  const navigate = useNavigate()
  const [confirmText, setConfirmText] = useState('')
  const [confirmOpen, setConfirmOpen] = useState(false)
  const [delBusy, setDelBusy] = useState(false)
  const [delErr, setDelErr] = useState<string | null>(null)

  const deleteCompetition = async () => {
    setDelBusy(true); setDelErr(null)
    try {
      await api.adminDeleteCompetition(token)
      localStorage.removeItem(`pp.admin.${c.code}`)
      forgetCode(c.code)
      navigate('/')
    } catch (e: any) {
      setDelErr(readable(e.message))
      setDelBusy(false)
    }
  }

  return (
    <div className="max-w-xl space-y-4">
      <H>Competition</H>
      <Field label="Name">
        <input className={inputFull} value={name} onChange={e => setName(e.target.value)} />
      </Field>
      <Field label="Venue">
        <input className={inputFull} value={venue} onChange={e => setVenue(e.target.value)} />
      </Field>
      <Field label="Date">
        <input type="date" className={inputFull + ' min-w-0'} value={eventDate}
          onChange={e => setEventDate(e.target.value)} />
      </Field>
      <Save onClick={() => run(() => api.adminUpdateCompetition(token, name, venue, eventDate), 'Competition updated')} />

      <div className="mt-8 rounded-xl border border-line bg-surface p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Access</div>
        <Row k="Join code (share freely)" v={c.code} accent="brand" />
        {secrets && (
          <AdminPinRow token={token} pin={secrets.competition.admin_pin} run={run} after={refreshSecrets} />
        )}
      </div>

      <div className="mt-8 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
        <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-red-600">Danger zone</div>
        <p className="mb-3 text-sm text-fg-muted">
          Permanently deletes this competition and everything in it — teams, matches, scores.
          This can't be undone. Type <span className="font-mono font-bold">{c.code}</span> to confirm.
        </p>
        <div className="flex flex-wrap items-center gap-2">
          <input className={`${input} font-mono uppercase`} value={confirmText}
            onChange={e => setConfirmText(e.target.value.toUpperCase())} placeholder={c.code} />
          <button onClick={() => setConfirmOpen(true)} disabled={confirmText !== c.code || delBusy}
            className="rounded-xl bg-red-600 px-5 py-2.5 font-display font-bold text-white disabled:opacity-30">
            DELETE COMPETITION
          </button>
        </div>
        {delErr && !confirmOpen && <Warn>{delErr}</Warn>}
      </div>

      {confirmOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 px-6"
          onClick={() => !delBusy && setConfirmOpen(false)}>
          <div className="w-full max-w-sm rounded-2xl border border-line bg-surface p-5"
            onClick={e => e.stopPropagation()}>
            <div className="font-display text-lg font-bold text-red-600">Delete {c.code}?</div>
            <p className="mt-2 text-sm text-fg-muted">
              This permanently removes the competition and everything in it — teams, matches
              and scores. This cannot be undone.
            </p>
            <div className="mt-4 flex justify-end gap-2">
              <button onClick={() => setConfirmOpen(false)} disabled={delBusy}
                className="rounded-xl border border-line px-4 py-2 text-sm font-semibold text-fg-muted disabled:opacity-40">
                Cancel
              </button>
              <button onClick={deleteCompetition} disabled={delBusy}
                className="rounded-xl bg-red-600 px-4 py-2 font-display text-sm font-bold text-white disabled:opacity-40">
                {delBusy ? 'DELETING…' : 'Delete permanently'}
              </button>
            </div>
            {delErr && <div className="mt-3"><Warn>{delErr}</Warn></div>}
          </div>
        </div>
      )}
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
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
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
      <div className="grid grid-cols-2 gap-4 sm:grid-cols-4">
        <Field label="Winning score">
          <Stepper value={t} min={1} max={99} onChange={v => { setT(v); setSw((s: number) => s > 0 ? defaultSwitchAt(v) : 0) }} />
        </Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
        <Field label="Switch ends at">
          <Stepper value={sw} min={0} max={t} onChange={setSw} format={v => v === 0 ? 'OFF' : String(v)} />
        </Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-fg-subtle">
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
    <div className="max-w-5xl space-y-4">
      <H>Teams</H>

      {isDuel ? (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-brand-ink">
              {ev.side_a_name || 'Side A'} — {sideA.length}
            </div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {sideA.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} isDuel />)}
              {!sideA.length && <div className="p-3 text-xs text-fg-subtle">No teams yet.</div>}
            </div>
          </div>
          <div>
            <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-accent">
              {ev.side_b_name || 'Side B'} — {sideB.length}
            </div>
            <div className="divide-y divide-line rounded-xl border border-line">
              {sideB.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} isDuel />)}
              {!sideB.length && <div className="p-3 text-xs text-fg-subtle">No teams yet.</div>}
            </div>
          </div>
        </div>
      ) : (
        <div className="divide-y divide-line rounded-xl border border-line">
          {teams.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} />)}
          {!teams.length && <div className="p-4 text-sm text-fg-subtle">No teams yet.</div>}
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
          className="shrink-0 rounded-lg bg-brand px-5 font-display font-bold text-brand-fg disabled:opacity-30">
          ADD
        </button>
      </div>
      <p className="text-xs text-fg-subtle">
        Renaming is safe at any time — the schedule follows the team, not the name.
        A team that has already finished a match cannot be deleted.
        {isDuel && ' Both sides need equal, even squad sizes before you can regenerate the schedule.'}
      </p>
    </div>
  )
}

function LogoControl({ t, token, run }: any) {
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      const data = await resizeImage(file, 256)
      await api.adminSetTeamLogo(token, t.id, data)
    }, 'Logo updated')
  }
  return (
    <div className="relative shrink-0">
      <label className="block cursor-pointer">
        <input type="file" accept="image/*" className="hidden" onChange={onFile} />
        {t.logo
          ? <img src={t.logo} alt="" className="h-9 w-9 rounded-lg border border-line bg-surface-2 object-contain" />
          : <span className="grid h-9 w-9 place-items-center rounded-lg border border-dashed border-line text-lg text-fg-subtle">+</span>}
      </label>
      {t.logo && (
        <button onClick={() => run(() => api.adminSetTeamLogo(token, t.id, null), 'Logo removed')}
          className="absolute -right-1 -top-1 grid h-4 w-4 place-items-center rounded-full bg-red-600 text-[10px] font-bold leading-none text-white">x</button>
      )}
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
      <LogoControl t={t} token={token} run={run} />
      <input className={`${input} min-w-0 flex-1`} value={name} onChange={e => setName(e.target.value)} />
      {isDuel ? (
        <button onClick={() => setSide(side === 'A' ? 'B' : 'A')}
          className={`flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg border px-2.5 py-1.5 text-center text-xs font-bold ${
            side === 'A' ? 'border-brand-ink/40 text-brand-ink' : 'border-accent/40 text-accent'}`}>
          <Flag name={side === 'A' ? ev.side_a_name : ev.side_b_name} className="h-3.5 w-auto rounded-[1px]" />
          {side === 'A' ? (ev.side_a_name || 'A') : (ev.side_b_name || 'B')}
        </button>
      ) : (
        <input className={`${input} w-16 text-center uppercase`} value={pool} maxLength={2}
          onChange={e => setPool(e.target.value.toUpperCase())} />
      )}
      <button disabled={!dirty}
        onClick={() => run(() => api.adminUpsertTeam(token, ev.id, t.id, name, pool, isDuel ? side : undefined), 'Team saved')}
        className="shrink-0 rounded-lg bg-brand px-3 py-2 text-xs font-bold text-brand-fg disabled:opacity-20">
        SAVE
      </button>
      <button onClick={() => run(() => api.adminDeleteTeam(token, t.id), 'Team removed')}
        className="shrink-0 rounded-lg border border-line px-3 py-2 text-xs text-fg-muted hover:text-red-400">
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
      <p className="text-xs text-fg-subtle">
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
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <div className="w-24 font-display text-lg font-bold text-fg-muted">COURT {c.number}</div>
      <input className={`${input} tabular w-24 text-center`} value={v} maxLength={4} inputMode="numeric"
        onChange={e => setV(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      <button disabled={v === pin || v.length !== 4}
        onClick={() => run(async () => { await api.adminSetCourtPin(token, c.id, v); await after?.() }, `Court ${c.number} PIN changed`)}
        className="rounded-lg bg-brand px-4 py-2 text-xs font-bold text-brand-fg disabled:opacity-20">
        SAVE
      </button>
    </div>
  )
}

// --------------------------------------------------------------- bracket
/** groups_ko only. Shows the group tables, who qualifies, and the one action
 *  that closes the group stage: locking the tables and seeding the bracket.
 *  Deliberately manual — an auto-seed on the last group result would bake in
 *  a mis-scored match before anyone noticed. */
function BracketTab({ bundle, ev, token, run }: any) {
  const advance = ev.advance_per_group ?? 2
  const complete = groupStageComplete(bundle, ev.id)
  const seeded = bracketSeeded(bundle, ev.id)
  const tables = groupStandings(bundle, ev.id)
  const rounds = bracketRounds(bundle, ev.id)

  const groupIds = qualifiers(bundle, ev.id, advance)
  const flat = groupIds.flat()
  const size = nextPowerOfTwo(flat.length)
  const pairs = seedBracket(groupIds, size)
  const firstRound = rounds[0]

  const lock = () => run(async () => {
    await api.adminSeedBracket(token, ev.id, pairs.map((pr, i) => ({
      key: firstRound.matches[i]?.bracket_key ?? '',
      a: pr[0], b: pr[1],
    })))
  }, 'Bracket seeded — knockout matches are on court')

  const unlock = () => run(
    () => api.adminUnseedBracket(token, ev.id),
    'Bracket cleared — fix the group results and seed again')

  const nm = (id: string | null) => id ? teamName(bundle, id) : null

  return (
    <div className="max-w-3xl space-y-5">
      <H>Bracket</H>

      {!complete && (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-fg-muted">
          The group stage is still running. The bracket unlocks once every group
          match is finished — until then the knockout slots stay empty and off-court.
        </div>
      )}

      {/* group tables */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        {Object.keys(tables).sort().map(g => (
          <div key={g} className="rounded-xl border border-line bg-surface p-3">
            <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
              Group {g}
            </div>
            <table className="w-full text-sm">
              <tbody>
                {tables[g].map((r: any, i: number) => (
                  <tr key={r.team.id}
                    className={i < advance ? 'font-semibold text-fg' : 'text-fg-subtle'}>
                    <td className="py-0.5 pr-2 tabular">{i + 1}</td>
                    <td className="w-full py-0.5">
                      <span className="flex min-w-0 items-center gap-1.5">
                        <Emblem logo={teamLogo(bundle, r.team.id)} flagName={teamSideName(bundle, r.team.id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                        <span className="truncate">{r.team.name}</span>
                      </span>
                    </td>
                    <td className="py-0.5 pl-2 text-right tabular font-bold">{r.won}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ))}
      </div>

      {/* the draw that will be written */}
      {complete && !seeded && firstRound && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            {firstRound.round} — this is what will be written
          </div>
          <ul className="space-y-1 text-sm">
            {pairs.map((pr, i) => (
              <li key={i} className="grid grid-cols-[1fr_2.75rem_1fr] items-center gap-2 border-b border-line/60 pb-1">
                <span className="flex min-w-0 items-center justify-end gap-1.5 truncate text-right">
                  <span className="truncate">{nm(pr[0]) ?? '—'}</span>
                  {pr[0] && <Emblem logo={teamLogo(bundle, pr[0])} flagName={teamSideName(bundle, pr[0])} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />}
                </span>
                <span className="text-center text-xs text-fg-subtle">
                  {pr[1] ? 'vs' : 'bye'}
                </span>
                <span className="flex min-w-0 items-center gap-1.5 truncate text-left">
                  {pr[1] && <Emblem logo={teamLogo(bundle, pr[1])} flagName={teamSideName(bundle, pr[1])} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />}
                  <span className="truncate">{nm(pr[1]) ?? '—'}</span>
                </span>
              </li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-fg-subtle">
            Top {advance} from each group, seeded so the group winners are kept apart
            and cannot meet a team from their own group in round one. Byes go to the
            highest seeds. Nothing is written until you press the button.
          </p>
          <Save label="LOCK GROUPS & DRAW BRACKET" onClick={lock} />
        </div>
      )}

      {/* the live bracket */}
      {seeded && (
        <div className="space-y-3">
          {(() => {
            const finalR = rounds.find(r => r.round === 'Final')
            const thirdR = rounds.find(r => r.round === 'Third place')
            const restR = rounds.filter(r => r !== finalR && r !== thirdR).reverse()
            return [finalR, thirdR, ...restR].filter((x): x is NonNullable<typeof x> => x != null)
          })().map(r => (
            <div key={r.round} className="rounded-xl border border-line bg-surface p-3">
              <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
                {r.round}
              </div>
              <ul className="space-y-1 text-sm">
                {r.matches.map((m: any) => (
                  <li key={m.id} className="grid grid-cols-[1fr_4rem_1fr] items-center gap-2">
                    <span className={`flex min-w-0 items-center justify-end gap-1.5 ${m.winner_id === m.team_a_id ? 'font-semibold' : ''}`}>
                      <span className="truncate text-right">{nm(m.team_a_id) ?? '—'}</span>
                      {m.team_a_id && <Emblem logo={teamLogo(bundle, m.team_a_id)} flagName={teamSideName(bundle, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />}
                    </span>
                    <span className="tabular text-center text-xs text-fg-subtle">
                      {m.status === 'finished' ? `${m.score_a}–${m.score_b}`
                        : m.team_b_id == null && m.team_a_id != null ? 'bye' : 'vs'}
                    </span>
                    <span className={`flex min-w-0 items-center gap-1.5 ${m.winner_id === m.team_b_id ? 'font-semibold' : ''}`}>
                      {m.team_b_id && <Emblem logo={teamLogo(bundle, m.team_b_id)} flagName={teamSideName(bundle, m.team_b_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />}
                      <span className="truncate">{nm(m.team_b_id) ?? '—'}</span>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
          <button onClick={unlock}
            className="text-xs text-fg-subtle underline underline-offset-4">
            clear the bracket and re-draw
          </button>
          <p className="text-xs text-fg-subtle">
            Only possible while no knockout match has been scored. Use it if a group
            result was wrong and the qualifiers changed.
          </p>
        </div>
      )}
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
      <div className="rounded-xl border border-line bg-surface p-4 text-sm">
        <div className="text-fg-muted">
          {bundle.matches.length} fixtures ·{' '}
          {bundle.matches.filter((m: any) => m.status === 'finished').length} played
        </div>
        <div className="mt-1 text-xs text-fg-subtle">
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
          className="rounded-xl bg-brand px-6 py-3 font-display font-bold text-brand-fg disabled:opacity-30">
          REGENERATE SCHEDULE
        </button>
      )}

      <div className="text-xs text-fg-subtle">Reorder upcoming matches on a court with the arrows.</div>
      <div className="divide-y divide-line rounded-xl border border-line text-sm">
        {bundle.matches.slice().sort((a: any, b: any) => a.sequence - b.sequence).slice(0, 60)
          .map((m: any) => {
            const sibs = bundle.matches
              .filter((x: any) => x.court_id === m.court_id && x.status === 'scheduled')
              .sort((a: any, b: any) => a.sequence - b.sequence)
            const i = sibs.findIndex((x: any) => x.id === m.id)
            const canUp = m.status === 'scheduled' && i > 0
            const canDown = m.status === 'scheduled' && i >= 0 && i < sibs.length - 1
            const fl = "mr-1 inline-block h-3 w-auto shrink-0 rounded-[1px] align-[-2px]"
            return (
              <div key={m.id} className="flex items-center gap-2 px-3 py-2">
                <span className="w-6 text-center text-xs text-fg-subtle">
                  {bundle.courts.find((c: any) => c.id === m.court_id)?.number ?? '–'}
                </span>
                <span className="grid min-w-0 flex-1 grid-cols-[1fr_1.75rem_1fr] items-center gap-1">
                  <span className="flex min-w-0 items-center justify-end gap-1.5">
                    <span className="truncate text-right">{teamName(bundle, m.team_a_id)}</span>
                    <Emblem logo={teamLogo(bundle, m.team_a_id)} flagName={teamSideName(bundle, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                  </span>
                  <span className="text-center text-xs text-fg-subtle">vs</span>
                  <span className="flex min-w-0 items-center gap-1.5">
                    <Emblem logo={teamLogo(bundle, m.team_b_id)} flagName={teamSideName(bundle, m.team_b_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                    <span className="truncate">{teamName(bundle, m.team_b_id)}</span>
                  </span>
                </span>
                <span className="tabular w-16 shrink-0 text-right text-xs text-fg-muted">
                  {m.status === 'scheduled' ? (m.round ?? '').replace(/pod/i, 'Court') : `${m.score_a}–${m.score_b}`}
                </span>
                <span className="flex shrink-0 items-center gap-1">
                  <button disabled={!canUp}
                    onClick={() => run(() => api.adminMoveMatch(token, m.id, 'up'), 'Match moved up')}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2 disabled:opacity-20">▲</button>
                  <button disabled={!canDown}
                    onClick={() => run(() => api.adminMoveMatch(token, m.id, 'down'), 'Match moved down')}
                    className="grid h-7 w-7 place-items-center rounded-lg border border-line text-fg-muted active:bg-surface-2 disabled:opacity-20">▼</button>
                </span>
              </div>
            )
          })}
      </div>
    </div>
  )
}

// ----------------------------------------------------------- bits
const H = ({ children }: any) =>
  <h1 className="font-display text-2xl font-bold tracking-wide">{children}</h1>

const Save = (
  { onClick, disabled, label }:
  { onClick: () => void; disabled?: boolean; label?: string },
) => (
  <button onClick={onClick} disabled={disabled}
    className="rounded-xl bg-brand px-6 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">
    {label ?? 'SAVE'}
  </button>
)

const Row = ({ k, v, accent }: { k: string; v: string; accent: 'brand' | 'accent' }) => (
  <div className="flex items-center justify-between border-t border-line/60 py-2 text-sm first:border-0">
    <span className="text-fg-muted">{k}</span>
    <span className={`tabular font-display text-xl font-bold ${accent === 'brand' ? 'text-brand-ink' : 'text-accent'}`}>
      {v}
    </span>
  </div>
)

function AdminPinRow({ token, pin, run, after }: any) {
  const [v, setV] = useState(pin)
  const [editing, setEditing] = useState(false)
  useEffect(() => setV(pin), [pin])

  if (!editing) {
    return (
      <div className="flex items-center justify-between border-t border-line/60 py-2 text-sm">
        <span className="text-fg-muted">Admin PIN (keep private)</span>
        <span className="flex items-center gap-2">
          <button onClick={() => setEditing(true)}
            className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-fg-muted active:bg-surface-2">
            Change
          </button>
          <span className="tabular font-display text-xl font-bold text-accent">{pin}</span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 py-2 text-sm">
      <span className="text-fg-muted">Admin PIN (keep private)</span>
      <span className="flex items-center gap-2">
        <input className={`${input} tabular w-24 text-center`} value={v} maxLength={4} inputMode="numeric"
          onChange={e => setV(e.target.value.replace(/\D/g, '').slice(0, 4))} />
        <button disabled={v.length !== 4}
          onClick={() => run(async () => {
            await api.adminSetAdminPin(token, v); await after?.(); setEditing(false)
          }, 'Admin PIN changed')}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg disabled:opacity-20">
          SAVE
        </button>
        <button onClick={() => { setV(pin); setEditing(false) }}
          className="rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-fg-muted active:bg-surface-2">
          Cancel
        </button>
      </span>
    </div>
  )
}

const readable = (m: string) => ({
  TEAM_HAS_RESULTS: 'That team has already finished a match, so it can\'t be deleted.',
  SCHEDULE_IN_PROGRESS: 'Matches are already under way — the schedule is locked.',
  CAP_TOO_LOW: 'The cap is too low for that winning score and win-by.',
  BAD_SWITCH_AT: 'Switch-ends score must be between 1 and the winning score.',
  PIN_MUST_BE_4_DIGITS: 'Court PINs must be exactly 4 digits.',
  NOT_ADMIN: 'Your settings session expired — enter the admin PIN again.',
  IMAGE_TOO_LARGE: 'That image is too large — pick one under 4 MB.',
  LOGO_TOO_LARGE: 'That logo is too large to save.',
  BAD_IMAGE: 'That file could not be read as an image.',
  NO_TEAM: 'That team no longer exists.',
}[m] ?? m)
