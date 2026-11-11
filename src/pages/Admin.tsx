import { useEffect, useRef, useState, type ChangeEvent } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import {
  useCompetition, teamName, teamSideName, teamLogo, forgetCode,
  groupStandings, groupStageComplete, bracketSeeded, qualifiers, bracketRounds,
} from '../lib/store'
import * as api from '../lib/api'
import {
  buildDraw, buildRestedDraw, buildDuelDraw, defaultSwitchAt, validateRules, validateDuelSquads,
  seedBracket, nextPowerOfTwo,
  type DraftTeam, type DuelTeam,
} from '../lib/draw'
import { Screen, Spinner, ThemeToggle, Emblem } from '../components/ui'
import { Flag } from '../components/ui'
import { Field, Stepper, Choice, Warn, GrowInput, input, inputFull } from '../components/form'
import { resizeLogoSafe } from '../lib/image'
import { ScheduleRow, scheduleStatus } from '../components/ScheduleRow'
import { SportsTab, TieScheduleTab, EventSwitcher, RosterToggle, SportCourts, KnockoutTab } from './MultiSportAdmin'
import { sportsPresent, isCb } from '../lib/multisport'
import { CbRulesPanel } from '../components/CaptainBall'
import { isPoolDispatch, isDiffTiebreak, shuffleMap, eventUntouched, roundName } from '../lib/pool'
import { parentHub } from '../lib/hub'
import { seatsOf, entriesOf, fixedOf, currentMeets, smartDraw, jointDraw, slotClock } from '../lib/clash'
import { koPlanOf, planDraw, tokenLabel } from '../lib/koplan'
import { GroupTable } from '../components/GroupsKo'

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
type Tab = 'competition' | 'scoring' | 'teams' | 'courts' | 'schedule' | 'bracket' | 'sports' | 'knockout'

export default function Admin() {
  const { code } = useParams()
  const { bundle, reload } = useCompetition(code)
  const [token, setToken] = useState<string | null>(() => readToken(code!))

  // any admin call answered NOT_ADMIN -> forget the saved session so the PIN pad comes back
  useEffect(() => {
    const expired = () => { try { localStorage.removeItem(tokKey(code!)) } catch { /* ignore */ } setToken(null) }
    window.addEventListener('pp:admin-expired', expired)
    return () => window.removeEventListener('pp:admin-expired', expired)
  }, [code])

  // the saved session runs out after TOKEN_TTL_MS: bring the PIN pad back by itself, no refresh needed
  // (checked every few seconds and when the tab wakes up, because phones pause timers in the background)
  useEffect(() => {
    if (!token) return
    const check = () => { if (readToken(code!) == null) setToken(null) }
    const iv = window.setInterval(check, 5000)
    document.addEventListener('visibilitychange', check)
    window.addEventListener('focus', check)
    return () => { window.clearInterval(iv); document.removeEventListener('visibilitychange', check); window.removeEventListener('focus', check) }
  }, [token, code])

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

  // multi-sport competitions (opt-in flag) can switch between their sports'
  // events; every other competition keeps editing its single event as before
  const multi = !!bundle.competition.multi_sport
  const [evId, setEvId] = useState<string | null>(null)
  // the Final's rules-only event (multi-sport, migration 0025) is editable in
  // Scoring only — it has no teams or schedule of its own
  const evList = multi && tab !== 'scoring' ? bundle.events.filter((e: any) => !e.stage) : bundle.events
  const ev = (multi && evList.find((e: any) => e.id === evId)) || evList[0]
  const tabs: Tab[] = ['competition', 'scoring', 'teams', 'courts', 'schedule',
    ...(ev?.format === 'groups_ko' ? ['bracket' as Tab] : []),
    ...(multi ? ['knockout' as Tab, 'sports' as Tab] : [])]

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

      <div className="min-w-0 flex-1 p-6" style={{ paddingTop: 'max(var(--pp-top), 1.5rem)' }}>
        <div className="sticky z-30 -mx-6 mb-4 flex gap-1 overflow-x-auto bg-canvas px-6 py-2 md:hidden" style={{ top: 'var(--pp-top)' }}>
          {tabs.map(t => (
            <button key={t} onClick={() => setTab(t)}
              className={`shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-xs font-bold uppercase ${
                tab === t ? 'bg-brand text-brand-fg' : 'text-fg-muted'}`}>{t}</button>
          ))}
        </div>

        {multi && ['scoring', 'teams', 'schedule'].includes(tab) &&
          <EventSwitcher events={evList} value={ev.id} onChange={setEvId} />}

        {msg && <div className="mb-4 rounded-lg border border-brand-ink/40 bg-brand/10 px-3 py-2 text-sm text-brand-ink">{msg}</div>}
        {err && <Warn>{err}</Warn>}

        {tab === 'competition' && <CompetitionTab bundle={bundle} ev={ev} token={token} run={run} secrets={secrets}
          refreshSecrets={() => api.adminBundle(token).then(setSecrets)} />}
        {tab === 'scoring' && (multi && isCb(ev?.sport)
          ? <CbRulesPanel ev={ev} token={token} run={run} />
          : <ScoringTab ev={ev} token={token} run={run} />)}
        {tab === 'teams' && <TeamsTab bundle={bundle} ev={ev} token={token} run={run} />}
        {tab === 'courts' && <CourtsTab bundle={bundle} token={token} run={run} secrets={secrets}
          refreshSecrets={() => api.adminBundle(token).then(setSecrets)} />}
        {tab === 'schedule' && (multi
          ? <TieScheduleTab bundle={bundle} ev={ev} token={token} run={run} />
          : <ScheduleTab bundle={bundle} ev={ev} token={token} run={run} />)}
        {tab === 'knockout' && multi && <KnockoutTab bundle={bundle} token={token} run={run} />}
        {tab === 'sports' && multi && <SportsTab bundle={bundle} token={token} run={run} onAdded={reload} />}
        {ev?.format === 'groups_ko' && (
          <div className={tab === 'bracket' ? '' : 'hidden'}><BracketTab key={ev.id} bundle={bundle} ev={ev} token={token} run={run} /></div>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------ tabs
function CompetitionTab({ bundle, ev, token, run, secrets, refreshSecrets }: any) {
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
      {ev && <AnnouncementCard ev={ev} token={token} run={run} />}
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

      <StartOver token={token} run={run} />

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
  const [serveMode, setServeMode] = useState<'winner' | 'alternate'>(ev.serve_mode ?? 'winner')
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: sw })
  const isDuel = ev.format === 'duel'
  const isBad = ev.sport === 'badminton'

  return (
    <div className="max-w-2xl space-y-5">
      <H>Scoring</H>
      {ev.ko_from_sf && <p className="-mt-2 text-sm text-fg-muted">These settings are the <b>group stage</b>. The quarter-finals and the semi-finals / 3rd place / Final each have their own card below.</p>}
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
        <Choice value={t} onChange={(v: number) => {
            setT(v); setSw(defaultSwitchAt(v))
            setCap(isBad ? (v === 21 ? 30 : v === 15 ? 20 : v + 2) : v + 2)
          }}
          options={isBad
            ? [{ label: 'to 15', value: 15 }, { label: 'to 21', value: 21 }]
            : [{ label: 'to 11', value: 11 }, { label: 'to 15', value: 15 }, { label: 'to 21', value: 21 }]} />
      </Field>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
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
      {isBad ? (
        <p className="text-xs leading-relaxed text-fg-subtle">
          Badminton rally scoring — every rally scores a point. The side that wins the rally serves
          next, from the right court when its score is even and the left court when odd.
        </p>
      ) : (
        <>
          <Field label="Serve mode">
            <Choice value={serveMode} onChange={setServeMode}
              options={[{ label: 'Serve', value: 'alternate' }, { label: 'Winner', value: 'winner' }]} />
          </Field>
          <p className="text-xs text-fg-subtle leading-relaxed">
            {serveMode === 'winner'
              ? 'Winner — every rally scores a point, for whoever wins it.'
              : 'Serve — real doubles side-out scoring: only the serving team can score. Losing a rally while serving passes serve to your partner, then to the other team.'}
          </p>
        </>
      )}
      <p className="text-xs text-fg-subtle">
        Changes apply to every match, including ones already in progress.
      </p>
      <Save disabled={!!bad}
        onClick={() => run(() => api.adminUpdateEvent(token, ev.id, name,
          { target_score: t, win_by: w, cap, switch_at: sw, side_a_name: aName, side_b_name: bName, serve_mode: serveMode }),
          'Scoring updated')} />
      {ev.ko_from_sf && <QfRules ev={ev} token={token} run={run} />}
      {ev.ko_from_sf && (['sf', 'p3', 'fin'] as const).map(k => <StageRules key={k} stage={k} ev={ev} token={token} run={run} />)}
      {ev.ko_target_score != null && !ev.ko_final_only && !ev.ko_from_sf && <KoRules ev={ev} token={token} run={run} />}
      {ev.format === 'groups_ko' && !ev.ko_from_sf && <FinalRules ev={ev} token={token} run={run} />}
    </div>
  )
}

/** Events with their own knockout rules (migration 0026): the settings above
 *  are the group stage; these apply to quarter-finals onward. */
function KoRules({ ev, token, run }: any) {
  const [t, setT] = useState<number>(ev.ko_target_score)
  const [w, setW] = useState<number>(ev.ko_win_by ?? ev.win_by)
  const [cap, setCap] = useState<number>(ev.ko_cap ?? ev.ko_target_score)
  const [sw, setSw] = useState<number>(ev.ko_switch_at ?? ev.switch_at)
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: sw })
  return (
    <div className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="font-display text-lg font-bold tracking-wide">{ev.ko_from_sf ? 'Semi-finals, 3rd place & Final' : 'Knockout scoring'}</div>
        <p className="text-xs text-fg-subtle">{ev.ko_from_sf ? 'The three games that decide the medals.' : 'Quarter-finals, semi-finals, 3rd place and Final. The rules above are the group stage.'}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
        <Field label="Winning score">
          <Stepper value={t} min={1} max={99} onChange={v => { setT(v); if (cap < v) setCap(v); if (sw > v) setSw(0) }} />
        </Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
        <Field label="Switch ends at">
          <Stepper value={sw} min={0} max={t} onChange={setSw} format={v => v === 0 ? 'OFF' : String(v)} />
        </Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-fg-subtle">
        {w === 1 && cap === t ? `Sudden death — first to ${t} wins, no deuce.` : `First to ${t}, win by ${w}, capped at ${cap}.`}
      </p>
      <Save disabled={!!bad} label="SAVE KNOCKOUT RULES"
        onClick={() => run(() => api.adminSetKoRules(token, ev.id, { target_score: t, win_by: w, cap, switch_at: sw }), 'Knockout scoring updated')} />
    </div>
  )
}

/** Quarter-finals only (migration 0042): own winning score, win by, cap. */
function QfRules({ ev, token, run }: any) {
  const [t, setT] = useState<number>(ev.qf_target_score ?? ev.target_score)
  const [w, setW] = useState<number>(ev.qf_win_by ?? ev.win_by)
  const [cap, setCap] = useState<number>(ev.qf_cap ?? ev.qf_target_score ?? ev.cap)
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: 0 })
  return (
    <div className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="font-display text-lg font-bold tracking-wide">Quarter-finals</div>
        <p className="text-xs text-fg-subtle">The four games between the group stage and the semi-finals.</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
        <Field label="Winning score">
          <Stepper value={t} min={1} max={99} onChange={v => { setT(v); if (cap < v) setCap(v) }} />
        </Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-fg-subtle">
        {w === 1 && cap === t ? `Sudden death — first to ${t} wins, no deuce.` : `First to ${t}, win by ${w}, capped at ${cap}.`}
      </p>
      <Save disabled={!!bad} label="SAVE QUARTER-FINAL RULES"
        onClick={() => run(() => api.adminSetQfRules(token, ev.id, { target_score: t, win_by: w, cap }), 'Quarter-final scoring updated')} />
    </div>
  )
}

const STAGE_INFO = {
  sf: ['Semi-finals', 'The two games before the Final.', 'SAVE SEMI-FINAL RULES', 'Semi-final scoring updated'],
  p3: ['3rd place', 'The bronze-medal game.', 'SAVE 3RD PLACE RULES', '3rd place scoring updated'],
  fin: ['The Final', 'The title game: one game.', 'SAVE FINAL RULES', 'Final scoring updated'],
} as const

/** Semi-finals / 3rd place / Final: each its own score, win-by and cap (migration 0043). */
function StageRules({ stage, ev, token, run }: any) {
  const cur = ev.stage_rules?.[stage]
  const [t, setT] = useState<number>(cur?.target ?? ev.ko_target_score ?? ev.target_score)
  const [w, setW] = useState<number>(cur?.win_by ?? ev.ko_win_by ?? ev.win_by)
  const [cap, setCap] = useState<number>(cur?.cap ?? ev.ko_cap ?? cur?.target ?? ev.ko_target_score ?? ev.target_score)
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: 0 })
  const [title, sub, label, done] = STAGE_INFO[stage as 'sf' | 'p3' | 'fin']
  return (
    <div className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="font-display text-lg font-bold tracking-wide">{title}</div>
        <p className="text-xs text-fg-subtle">{sub}</p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
        <Field label="Winning score">
          <Stepper value={t} min={1} max={99} onChange={v => { setT(v); if (cap < v) setCap(v) }} />
        </Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-fg-subtle">
        {w === 1 && cap === t ? `Sudden death — first to ${t} wins, no deuce.` : `First to ${t}, win by ${w}, capped at ${cap}.`}
      </p>
      <Save disabled={!!bad} label={label}
        onClick={() => run(() => api.adminSetStageRules(token, ev.id, stage, { target_score: t, win_by: w, cap }), done)} />
    </div>
  )
}

/** The Final only: own scoring + best of N (migration 0037). Group games,
 *  semi-finals and 3rd place keep the rules above. Locked once the Final starts. */
function FinalRules({ ev, token, run }: any) {
  const own = !!ev.ko_final_only
  const [t, setT] = useState<number>(own ? ev.ko_target_score : 11)
  const [w, setW] = useState<number>(own ? (ev.ko_win_by ?? ev.win_by) : ev.win_by)
  const [cap, setCap] = useState<number>(own ? (ev.ko_cap ?? ev.ko_target_score) : 11)
  const [bo, setBo] = useState<number>(ev.final_best_of ?? 1)
  const bad = validateRules({ target_score: t, win_by: w, cap, switch_at: 0 })
  return (
    <div className="mt-8 space-y-4 rounded-xl border border-line bg-surface p-4">
      <div>
        <div className="font-display text-lg font-bold tracking-wide">The Final</div>
        <p className="text-xs text-fg-subtle">
          {own ? `Now: first to ${ev.ko_target_score}, win by ${ev.ko_win_by}, cap ${ev.ko_cap} · ${ev.final_best_of > 1 ? `best of ${ev.final_best_of}` : 'one game'}.`
            : 'Now: same rules as above, one game.'} Semi-finals and 3rd place keep the rules above.
        </p>
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(9.5rem,1fr))] gap-4">
        <Field label="Winning score"><Stepper value={t} min={1} max={99} onChange={v => { setT(v); if (cap < v) setCap(v) }} /></Field>
        <Field label="Win by"><Stepper value={w} min={1} max={5} onChange={setW} /></Field>
        <Field label="Hard cap"><Stepper value={cap} min={1} max={120} onChange={setCap} /></Field>
        <Field label="Games">
          <Choice value={bo} onChange={setBo} options={[{ label: '1', value: 1 }, { label: 'Best of 3', value: 3 }]} />
        </Field>
      </div>
      {bad && <Warn>{bad}</Warn>}
      <p className="text-xs text-fg-subtle">
        {w === 1 && cap === t ? `Sudden death — first to ${t}.` : `First to ${t}, win by ${w}, capped at ${cap}.`}
        {bo === 3 ? ' 2 game wins take the title; game 3 is played only at 1–1.' : ''}
      </p>
      <Save disabled={!!bad} label="SAVE FINAL RULES"
        onClick={() => run(() => api.adminSetFinalRules(token, { target_score: t, win_by: w, cap, best_of: bo }), 'Final rules updated')} />
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
      {isPoolDispatch(ev) && <RegisterStatus teams={teams} token={token} code={bundle.competition.code} />}
      {ev.format === 'groups_ko' && (isPoolDispatch(ev) || ev.legs === 2) && (
        <RandomGroups bundle={bundle} ev={ev} token={token} run={run} />
      )}

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
          {teams.map((t: any) => <TeamRow key={t.id} t={t} ev={ev} token={token} run={run} multi={!!bundle.competition.multi_sport} code={bundle.competition.code} />)}
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

/** Fresh random group draw (migration 0026): team names, players and logos
 *  are dealt into new group slots; every group keeps exactly its size and the
 *  fixtures stay. Only before the first point of the event. */
function RandomGroups({ bundle, ev, token, run }: any) {
  const [sure, setSure] = useState(false)
  const teams = bundle.teams.filter((t: any) => t.event_id === ev.id)
  const pools = [...new Set<string>(teams.map((t: any) => t.pool ?? 'A'))].sort()
  const open = eventUntouched(bundle, ev.id)
  // The other category of the same event runs at the same time (MC26: Men's on
  // Courts 1-3, Mixed on 4-6): players entered in both must not be due on two
  // courts in the same time slot, so the draw looks at the other category too.
  const code = String(bundle.competition.code).toUpperCase()
  const hub = parentHub(code)
  const partnerCat = hub?.cats.find(c => c.code !== code && c.code !== hub.code && c.sport === hub.cats.find(x => x.code === code)?.sport)
  const [partner, setPartner] = useState<any>(null)
  const loadPartner = () => partnerCat ? api.join(partnerCat.code).then(setPartner).catch(() => setPartner(null)) : Promise.resolve()
  useEffect(() => { void loadPartner() }, [partnerCat?.code])
  const timed = seatsOf(bundle, ev.id).some(s => s.slots.length > 0)
  const pEv = partner?.events.find((e: any) => e.format === 'groups_ko')
  const fixed = partner && timed ? fixedOf(partner, partnerCat!.short) : []
  const meets = timed && partner ? currentMeets(bundle, ev.id, fixed) : []
  const pToken = partnerCat ? readToken(partnerCat.code) : null
  const both = !!(partner && pEv && pToken && timed && eventUntouched(partner, pEv.id) && seatsOf(partner, pEv.id).some(s => s.slots.length > 0))
  const mine = hub?.cats.find(c => c.code === code)?.short ?? code
  const draw = () => {
    setSure(false)
    if (!timed || !partner) {
      run(() => api.adminShuffleGroups(token, ev.id, shuffleMap(teams.map((t: any) => t.id))), 'New random groups drawn')
      return
    }
    const here = { label: mine, seats: seatsOf(bundle, ev.id), entries: entriesOf(bundle, ev.id) }
    if (both) {
      const r = jointDraw(here, { label: partnerCat!.short, seats: seatsOf(partner, pEv.id), entries: entriesOf(partner, pEv.id) })
      run(async () => {
        await api.adminShuffleGroups(token, ev.id, r.a.map)
        await api.adminShuffleGroups(pToken!, pEv.id, r.b.map)
        await loadPartner()
      }, `Both categories drawn · ${r.a.clashes === 0 ? 'no player on two courts at once' : `${r.a.clashes} time clash${r.a.clashes === 1 ? '' : 'es'} could not be avoided`}`)
    } else {
      const d = smartDraw(here.seats, here.entries, fixed)
      run(async () => { await api.adminShuffleGroups(token, ev.id, d.map); await loadPartner() },
        `New random groups drawn · ${d.clashes === 0 ? 'no player on two courts at once' : `${d.clashes} time clash${d.clashes === 1 ? '' : 'es'} left — also draw ${partnerCat!.short}`}`)
    }
  }
  const clock = (xs: number[], c: string) => xs.map(x => slotClock(c, x)).join(' · ')
  return (
    <div className="space-y-3 rounded-xl border border-line bg-surface p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="min-w-0">
          <div className="font-display text-lg font-bold tracking-wide">Groups</div>
          <div className="text-xs text-fg-subtle">{pools.length} groups of {Math.round(teams.length / Math.max(pools.length, 1))} · teams never move to another group's games</div>
        </div>
        {open ? (
          <div className="flex shrink-0 items-center gap-2">
            {sure && (
              <button onClick={() => setSure(false)}
                className="shrink-0 whitespace-nowrap rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-fg-muted">Cancel</button>
            )}
            <button onClick={() => sure ? draw() : setSure(true)}
              className={`shrink-0 whitespace-nowrap rounded-xl px-5 py-2.5 font-display font-bold ${sure ? 'bg-accent text-canvas' : 'bg-brand text-brand-fg'}`}>
              {sure ? 'YES, DRAW AGAIN' : both ? '🎲 DRAW BOTH CATEGORIES' : '🎲 GENERATE RANDOM GROUPS'}
            </button>
          </div>
        ) : (
          <span className="shrink-0 whitespace-nowrap text-xs text-fg-subtle">Locked — games have started</span>
        )}
      </div>
      <div className="grid grid-cols-[repeat(auto-fill,minmax(11rem,1fr))] gap-2">
        {pools.map(p => (
          <div key={p} className="min-w-0 rounded-lg border border-line px-2.5 py-2">
            <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Group {p}</div>
            {teams.filter((t: any) => (t.pool ?? 'A') === p).map((t: any) => (
              <div key={t.id} className="flex min-w-0 items-center gap-1.5 py-0.5 text-sm">
                <Emblem logo={t.logo} flagName={null} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                <span className="truncate">{t.name}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <p className="text-xs text-fg-subtle">
        Type the real team names above first, then generate. Drawing again is allowed until the first point is scored.
      </p>
      {partnerCat && timed && (
        <div className="rounded-lg border border-line px-3 py-2.5">
          <div className="flex flex-wrap items-baseline justify-between gap-x-3 gap-y-0.5">
            <div className="text-[11px] font-bold uppercase tracking-wider text-fg-subtle">Players in both {mine} and {partnerCat.short}</div>
            <div className="text-xs text-fg-muted">
              {!partner ? 'Loading…' : meets.length === 0 ? 'None found (same player name in both).'
                : `${new Set(meets.map(m => m.player)).size} player${new Set(meets.map(m => m.player)).size === 1 ? '' : 's'} · ${meets.filter(m => m.clash.length).length} time clash${meets.filter(m => m.clash.length).length === 1 ? '' : 'es'}`}
            </div>
          </div>
          {meets.length > 0 && (
            <div className="mt-2 divide-y divide-line">
              {meets.map((m, i) => (
                <div key={i} className="py-2 text-xs">
                  <div className="flex items-center justify-between gap-3">
                    <div className="min-w-0 truncate text-sm font-semibold capitalize">{m.player}</div>
                    <span className={`shrink-0 whitespace-nowrap rounded-full px-2 py-1 text-[11px] font-bold ${
                      m.clash.length ? 'bg-red-500/15 text-red-400' : m.tight.length ? 'bg-amber-400/15 text-amber-500' : 'bg-brand/15 text-brand-ink'}`}>
                      {m.clash.length ? `CLASH ${clock(m.clash, code)}` : m.tight.length ? `${m.tight.length} back to back` : 'OK'}
                    </span>
                  </div>
                  <div className="mt-1 grid grid-cols-[4.5rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 text-fg-muted">
                    <span className="font-semibold text-fg-subtle">{/mixed/i.test(mine) ? 'Mixed' : "Men's"} · {m.pool}</span>
                    <span className="tabular">{clock(m.slots, code)}</span>
                    <span className="font-semibold text-fg-subtle">{/mixed/i.test(partnerCat.short) ? 'Mixed' : "Men's"} · {m.otherPool}</span>
                    <span className="tabular">{clock(m.otherSlots, partnerCat.code)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-2 text-xs text-fg-subtle">
            {both
              ? 'One tap draws both categories together so these players are never due on two courts in the same time slot.'
              : `This draw fits ${mine} around the ${partnerCat.short} groups as they are now. To draw both together in one tap, open ${partnerCat.short} settings once on this device (PIN), then come back.`}
            {' '}Quarter-finals onward cannot be separated by the draw: the referee uses "Play a different game" if a player is still on another court.
          </div>
        </div>
      )}
    </div>
  )
}

/** MCMD/MCXD: self-registration progress + per-team 4-digit codes (migration 0030) */
function RegisterStatus({ teams, token, code }: { teams: any[]; token: string; code: string }) {
  const [codes, setCodes] = useState<{ pin: string; team: string | null; claimed: boolean }[] | null>(null)
  const [open, setOpen] = useState(false)
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const reload = () => api.adminRegCodes(token).then(setCodes).catch(() => setCodes(null))
  useEffect(() => { reload() }, [token, teams.length]) // eslint-disable-line react-hooks/exhaustive-deps
  const done = teams.filter(t => t.logo && !String(t.logo).startsWith('data:image/svg')).length
  const gen = async () => {
    setBusy(true); setMsg('')
    try { await api.adminGenRegCodes(token); await reload(); setOpen(true) }
    catch (e: any) { setMsg(e.message || 'Could not generate codes') }
    finally { setBusy(false) }
  }
  const copyAll = async () => {
    const txt = (codes ?? []).map(c => `${c.pin}${c.team ? '  ' + c.team : ''}`).join('\n')
    try { await navigator.clipboard.writeText(txt); setMsg('Copied') } catch { setMsg('Copy failed') }
  }
  const used = (codes ?? []).filter(c => c.claimed).length
  return (
    <div className="rounded-xl border border-line bg-surface p-3 text-sm">
      <div className="font-semibold">Registered {done} / {teams.length}
        <span className="ml-2 font-normal text-fg-subtle">players sign up at /register/{code} with their 4-digit team code</span></div>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button disabled={busy} onClick={gen}
          className="rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg disabled:opacity-40">
          {codes && codes.length ? '+ TOP UP CODES' : '🔑 GENERATE TEAM CODES'}
        </button>
        {!!codes?.length && (
          <>
            <button onClick={() => setOpen(!open)} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold">
              {open ? 'HIDE' : 'SHOW'} CODES ({used} used / {codes.length})
            </button>
            <button onClick={copyAll} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold">COPY ALL</button>
          </>
        )}
        {msg && <span className="text-xs text-fg-subtle">{msg}</span>}
      </div>
      {open && !!codes?.length && (
        <div className="mt-2 grid max-h-72 grid-cols-[repeat(auto-fill,minmax(13rem,1fr))] gap-1 overflow-y-auto">
          {codes.map(c => (
            <div key={c.pin} className={`flex min-w-0 items-center gap-2 rounded-lg border px-2 py-1 text-xs ${c.claimed ? 'border-brand-ink/40' : 'border-line text-fg-subtle'}`}>
              <span className="font-display text-base font-bold tracking-widest">{c.pin}</span>
              <span className="truncate">{c.claimed ? c.team : 'not used yet'}</span>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}

function LogoControl({ t, token, run, tight, code }: any) {
  const onFile = (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    e.target.value = ''
    if (!file) return
    run(async () => {
      // every competition: white background -> transparent + tight-trim (already-transparent PNGs kept as is)
      const data = await resizeLogoSafe(file, 400, tight)
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

function TeamRow({ t, ev, token, run, isDuel, multi, code }: any) {
  const [name, setName] = useState(t.name)
  const [pool, setPool] = useState(t.pool ?? 'A')
  const [side, setSide] = useState<'A' | 'B'>(t.side ?? 'A')
  const dirty = isDuel ? (name !== t.name || side !== (t.side ?? 'A')) : (name !== t.name || pool !== (t.pool ?? 'A'))
  return (
    <div className="p-2.5">
      <div className="flex items-center gap-2">
        <LogoControl t={t} token={token} run={run} tight={ev?.court_dispatch === 'pool'} code={code} />
        <GrowInput className={`${input} min-w-0 flex-1 leading-snug`} value={name} onChange={setName} />
      </div>
      <div className="ml-11 mt-1.5 flex items-center gap-1.5">
        {isDuel ? (
          <button onClick={() => setSide(side === 'A' ? 'B' : 'A')}
            className={`flex max-w-[120px] shrink-0 items-center gap-1 overflow-hidden rounded-lg border px-2 py-1 text-xs font-bold ${
              side === 'A' ? 'border-brand-ink/40 text-brand-ink' : 'border-accent/40 text-accent'}`}>
            <Flag name={side === 'A' ? ev.side_a_name : ev.side_b_name} className="h-3.5 w-auto shrink-0 rounded-[2px]" />
            <span className="truncate">{side === 'A' ? (ev.side_a_name || 'A') : (ev.side_b_name || 'B')}</span>
          </button>
        ) : (
          <input className={`${input} w-16 text-center uppercase`} value={pool} maxLength={2}
            onChange={e => setPool(e.target.value.toUpperCase())} />
        )}
        {multi && !isCb(ev?.sport) && <RosterToggle t={t} token={token} run={run} />}
        <button disabled={!dirty}
          onClick={() => run(() => api.adminUpsertTeam(token, ev.id, t.id, name, pool, isDuel ? side : undefined), 'Team saved')}
          className="shrink-0 rounded-lg bg-brand px-3 py-1.5 text-xs font-bold text-brand-fg disabled:opacity-20">
          SAVE
        </button>
        <button onClick={() => run(() => api.adminDeleteTeam(token, t.id), 'Team removed')}
          className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs text-fg-muted hover:text-red-400">
          ✕
        </button>
      </div>
    </div>
  )
}

function CourtsTab({ bundle, token, run, secrets, refreshSecrets }: any) {
  return (
    <div className="max-w-xl space-y-4">
      <H>Courts</H>
      {bundle.competition.multi_sport && sportsPresent(bundle).filter(s => !isCb(s)).map(s => (
        <SportCourts key={`${s}-${bundle.courts.filter((c: any) => (c.sport ?? 'pickleball') === s).map((c: any) => c.id + c.game_group).join()}`}
          bundle={bundle} token={token} run={run} sport={s} />
      ))}
      <div className="space-y-2">
        {bundle.courts.map((c: any) => (
          <CourtRow key={c.id} c={c} token={token} run={run} multi={!!bundle.competition.multi_sport}
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

function CourtRow({ c, token, run, pin, after, multi }: any) {
  const [v, setV] = useState(pin)
  useEffect(() => setV(pin), [pin])
  return (
    <div className="flex items-center gap-3 rounded-xl border border-line bg-surface p-3">
      <div className="min-w-0 flex-1 font-display text-lg font-bold text-fg-muted">
        <div className="truncate whitespace-nowrap">{multi && c.label ? c.label.toUpperCase() : `COURT ${c.number}`}</div>
        {multi && c.game_group && <div className="text-[11px] font-semibold tracking-wider text-accent">{c.game_group}</div>}
      </div>
      <input className={`${input} tabular w-20 shrink-0 text-center`} value={v} maxLength={4} inputMode="numeric"
        onChange={e => setV(e.target.value.replace(/\D/g, '').slice(0, 4))} />
      <button disabled={v === pin || v.length !== 4}
        onClick={() => run(async () => { await api.adminSetCourtPin(token, c.id, v); await after?.() }, `Court ${c.number} PIN changed`)}
        className="shrink-0 rounded-lg bg-brand px-4 py-2 text-xs font-bold text-brand-fg disabled:opacity-20">
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
  // tiebreak 'diff': teams still level after head-to-head on the qualifying
  // line are settled by a coin toss — the admin records the toss winner here
  const [picks, setPicks] = useState<Record<string, string[]>>({})
  const diffMode = isDiffTiebreak(ev)
  // printed knockout plan (MCMD / MCXD fundraiser): fixed pairings, so a tie
  // anywhere in a group's top places matters, not only on the qualifying line
  const plan = koPlanOf(bundle.competition.code)
  const tosses = diffMode ? coinTosses(tables, advance, !!plan) : {}
  // printed plan: 1st AND 2nd place both matter, so three level teams need two tosses (tap in order)
  const tossNeed = (g: string) => (plan ? Math.max(1, tosses[g].length - 1) : 1)
  const tossPicks = (g: string) => (picks[g] ?? []).filter(id => tosses[g]?.some((r: any) => r.team.id === id))
  const openTosses = Object.keys(tosses).filter(g => tossPicks(g).length < tossNeed(g))

  const ordered: Record<string, any[]> = Object.fromEntries(Object.keys(tables).sort().map(g => {
    const rows = tables[g].slice()
    if (diffMode && tosses[g]) {
      // toss winners go to the front of the level teams, in the order tapped
      tossPicks(g).forEach((pick, k) => {
        const i = rows.findIndex((r: any) => r.team.id === pick)
        const first = rows.findIndex((r: any) => r.tieGroup === rows[i].tieGroup)
        rows.splice(first + k, 0, rows.splice(i, 1)[0])
      })
    }
    return [g, rows]
  }))
  const groupIds = diffMode
    ? Object.keys(ordered).map(g => ordered[g].slice(0, advance).map((r: any) => r.team.id))
    : qualifiers(bundle, ev.id, advance)
  // cross-pool order after the organiser's coin tosses (winners W1-W6, runners-up R1-R2)
  const [xOrder, setXOrder] = useState<{ W?: string[]; R?: string[] }>({})
  const pd = plan ? planDraw(plan, ordered as any, xOrder) : null
  const cross = !!plan && plan.pairs.flat().some(t => /^[WR]\d/.test(t))
  const crossTies = pd && cross ? [...pd.winners.level, ...pd.runners.level].filter(Boolean).length : 0
  const flat = pd ? pd.pairs.flat().filter((x): x is string => !!x) : groupIds.flat()
  const size = pd ? pd.pairs.length * 2 : nextPowerOfTwo(flat.length)
  const pairs = pd ? pd.pairs : seedBracket(groupIds, size)
  const firstRound = rounds[0]

  // 4-team round robin: Final = 1st v 2nd, 3rd place = 3rd v 4th
  const rrFinal = flat.length === 4 && groupIds.length === 1 && rounds.every(r => r.round === 'Final' || r.round === 'Third place')
  const seedRows = rrFinal
    ? [{ key: 'KO-2-0', a: flat[0], b: flat[1] }, { key: 'KO-3P', a: flat[2], b: flat[3] }]
    : pairs.map((pr, i) => ({ key: pd ? `KO-${size}-${i}` : firstRound?.matches[i]?.bracket_key ?? '', a: pr[0], b: pr[1] }))
  const shownPairs: Array<[string | null, string | null]> = rrFinal ? seedRows.map(r => [r.a, r.b]) : pairs
  const lock = () => run(async () => {
    await api.adminSeedBracket(token, ev.id, seedRows)
  }, 'Bracket seeded — knockout matches are on court')

  // pre-set bracket: once every group game is finished and no coin toss is open,
  // the knockout is written automatically (no LOCK & DRAW needed). "Unlock" pauses
  // this until the page is reloaded, so the organiser can correct a result first.
  const autoBusy = useRef(false)
  const autoOff = useRef(false)
  useEffect(() => {
    if (autoBusy.current || autoOff.current) return
    if (!complete || seeded || !firstRound || openTosses.length > 0 || seedRows.some(r => !r.key)) return
    // printed draw with teams level across pools: wait for the organiser's coin toss (tap ⇅, or LOCK & DRAW NOW)
    if (crossTies > 0 && !xOrder.W && !xOrder.R) return
    autoBusy.current = true
    lock().finally(() => { autoBusy.current = false })
  })

  const unlock = () => run(
    async () => { autoOff.current = true; await api.adminUnseedBracket(token, ev.id) },
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
      {diffMode ? (
        <div className="grid grid-cols-[repeat(auto-fill,minmax(17rem,1fr))] gap-3">
          {Object.keys(tables).sort().map(g => (
            <div key={g} className="rounded-xl border border-line bg-surface p-2">
              <GroupTable b={bundle} g={g} rows={tables[g]} advance={advance} />
              {tosses[g] && complete && !seeded && (
                <div className="mt-2 border-t border-line pt-2">
                  <div className="mb-1.5 text-[11px] font-bold uppercase tracking-wider text-gold">{tossNeed(g) > 1 ? 'Coin toss — tap the teams in toss order (1st, then 2nd)' : plan ? 'Coin toss — who is placed higher?' : 'Coin toss — who goes through?'}</div>
                  <div className="flex flex-wrap gap-1.5">
                    {tosses[g].map((r: any) => (
                      <button key={r.team.id} onClick={() => setPicks(p => {
                        const cur = (p[g] ?? []).filter(id => id !== r.team.id)
                        return { ...p, [g]: cur.length >= tossNeed(g) ? [r.team.id] : [...cur, r.team.id] }
                      })}
                        className={`flex min-h-[32px] max-w-full items-center gap-1.5 rounded-lg border px-2.5 py-1 text-xs font-semibold ${
                          tossPicks(g).includes(r.team.id) ? 'border-gold bg-gold/20 text-fg' : 'border-line text-fg-muted'}`}>
                        {tossPicks(g).includes(r.team.id) && tossNeed(g) > 1 && <span className="font-bold text-gold">{tossPicks(g).indexOf(r.team.id) + 1}</span>}
                        <Emblem logo={teamLogo(bundle, r.team.id)} flagName={teamSideName(bundle, r.team.id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />
                        <span className="truncate">{r.team.name}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      ) : (
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
      )}

      {/* the draw that will be written */}
      {complete && !seeded && firstRound && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 truncate whitespace-nowrap text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            {rrFinal ? 'Final (1st v 2nd) and 3rd place (3rd v 4th)' : firstRound.round} — this is what will be written
          </div>
          <ul className="space-y-1 text-sm">
            {shownPairs.map((pr, i) => (
              <li key={i} className="grid grid-cols-[minmax(0,1fr)_2.75rem_minmax(0,1fr)] items-center gap-2 border-b border-line/60 pb-1">
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
          {pd && (
            <p className="mt-3 text-xs text-fg-subtle">
              The printed draw: {pd.tokens.map(([a, b], i) => `QF${i + 1} ${tokenLabel(a)} v ${tokenLabel(b)}`).join(' · ')}.
              {pd.swapped ? ' Runners-up were swapped so nobody meets a team from their own pool.' : ''}
              {' '}Nothing is written until you press the button.
            </p>
          )}
          {!pd && <p className="mt-3 text-xs text-fg-subtle">
            Top {advance} from each group, seeded so the group winners are kept apart
            and nobody meets a team from their own group in round one{advance > 1 ? <> — a
            group's winner and runner-up sit in opposite halves, so they can only meet again in the Final</> : null}.
            Byes go to the highest seeds. Nothing is written until you press the button.
          </p>}
          {openTosses.length > 0 && (
            <Warn>Coin toss needed in Group {openTosses.join(', ')} — tap the toss winner on that group above.</Warn>
          )}
          <p className="mt-3 text-xs text-gold">The bracket is set automatically as soon as the last group game finishes{openTosses.length ? ' and the coin tosses above are chosen' : crossTies > 0 ? ' — teams marked level need a coin toss first (tap ⇅, or press the button)' : ''}.</p>
          <Save label="LOCK & DRAW NOW" onClick={lock} disabled={openTosses.length > 0} />
        </div>
      )}

      {/* printed plan with cross-pool places: winners W1-W6 and the best runners-up */}
      {pd && cross && (
        <div className="rounded-xl border border-line bg-surface p-4">
          <div className="mb-2 text-[11px] font-bold uppercase tracking-wider text-fg-subtle">
            Ranking across pools — wins, then point difference, then points scored
          </div>
          {([['W', 'Pool winners', pd.winners], ['R', `Runners-up (best ${plan!.pairs.flat().filter(t => /^R\d/.test(t)).length} go through)`, pd.runners]] as const).map(([k, title, x]) => (
            <div key={k} className="mb-3">
              <div className="mb-1 text-xs font-semibold text-fg-muted">{title}</div>
              <ol className="space-y-1 text-sm">
                {x.ranked.map((r: any, i: number) => (
                  <li key={r.team.id} className={`flex items-center gap-2 ${k === 'R' && i >= plan!.pairs.flat().filter(t => /^R\d/.test(t)).length ? 'text-fg-subtle' : ''}`}>
                    <span className="w-8 shrink-0 font-bold tabular">{k}{i + 1}</span>
                    <span className="min-w-0 flex-1 truncate">{r.team.name} <span className="text-fg-subtle">· {r.team.pool}</span></span>
                    <span className="tabular text-xs text-fg-subtle">{r.won}W {r.diff > 0 ? '+' : ''}{r.diff}</span>
                    {complete && !seeded && x.level[i] && (
                      <button onClick={() => {
                        const ids = x.ranked.map((q: any) => q.team.id)
                        ;[ids[i], ids[i + 1]] = [ids[i + 1], ids[i]]
                        setXOrder(o => ({ ...o, [k]: ids }))
                      }} className="shrink-0 rounded-lg border border-gold px-2 py-0.5 text-[11px] font-bold text-gold">
                        level · coin toss ⇅
                      </button>
                    )}
                  </li>
                ))}
              </ol>
            </div>
          ))}
          {crossTies > 0 && complete && !seeded && (
            <p className="text-xs text-gold">Teams marked “level” have the same wins, point difference and points scored: toss a coin and tap ⇅ if the toss winner is below.</p>
          )}
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
                  <li key={m.id} className="grid grid-cols-[minmax(0,1fr)_4rem_minmax(0,1fr)] items-center gap-2">
                    <span className={`flex min-w-0 items-center justify-end gap-1.5 ${m.winner_id === m.team_a_id ? 'font-semibold' : ''}`}>
                      <span className="truncate text-right">{nm(m.team_a_id) ?? '—'}</span>
                      {m.team_a_id && <Emblem logo={teamLogo(bundle, m.team_a_id)} flagName={teamSideName(bundle, m.team_a_id)} className="h-4 w-4 shrink-0 rounded-[2px] object-contain" />}
                    </span>
                    <span className="tabular text-center text-xs text-fg-subtle">
                      {m.status === 'finished' ? `${m.score_a}–${m.score_b}`
                        : m.team_b_id == null && m.team_a_id != null && m.status === 'finished' ? 'bye' : 'vs'}
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


/** Groups whose qualifying line runs through a tie that head-to-head could
 *  not break: group -> the level teams. */
function coinTosses(tables: Record<string, any[]>, advance: number, top = false): Record<string, any[]> {
  const out: Record<string, any[]> = {}
  for (const g of Object.keys(tables)) {
    const rows = tables[g]
    // printed plan: 1st v 2nd matters too — any tie touching the top places
    if (top) {
      const hit = rows.slice(0, advance).find((r: any) => r.tieGroup != null)
      if (hit) out[g] = rows.filter((r: any) => r.tieGroup === hit.tieGroup)
      continue
    }
    const edge = rows[advance - 1]
    if (!edge || edge.tieGroup == null) continue
    const level = rows.filter((r: any) => r.tieGroup === edge.tieGroup)
    if (rows.findIndex((r: any) => r.tieGroup === edge.tieGroup) + level.length > advance) out[g] = level
  }
  return out
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
    : teams.length < 2 ? []
    : ev.format === 'groups_ko' && !bundle.competition.multi_sport
      // even over the courts, nobody on two courts at once; keeps "every pair meets twice"
      ? buildRestedDraw(teams.map((t: any) => ({ name: t.name, pool: t.pool ?? 'A' }) as DraftTeam), bundle.courts.length, ev.legs === 2 ? 2 : 1)
      : buildDraw(teams.map((t: any) => ({ name: t.name, pool: t.pool ?? 'A' }) as DraftTeam), bundle.courts.length)

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
      {isPoolDispatch(ev) ? (
        <div className="rounded-xl border border-line bg-surface p-4 text-sm text-fg-muted">
          Home courts: each group plays on its own court (a group shared by two courts moves
          once), and a free court takes its next game whose two teams are both free and rested,
          so every team's rest stays about the same.
          To change who is in which group, use Teams → Generate random groups.
        </div>
      ) : started ? (
        <Warn>
          Matches have already been played, so the schedule is locked. Regenerating
          would throw away results.
        </Warn>
      ) : (
        <button
          onClick={() => run(() => api.adminReplaceSchedule(
            token, ev.id, preview,
            teams.map((t: any) => t.id), bundle.courts.map((c: any) => c.id),
            { keepBracket: bundle.matches.some((m: any) => m.event_id === ev.id && m.bracket_key) }), 'Schedule regenerated')}
          disabled={preview.length === 0}
          className="rounded-xl bg-brand px-6 py-3 font-display font-bold text-brand-fg disabled:opacity-30">
          REGENERATE SCHEDULE
        </button>
      )}

      {!isDuel && <MoveUp bundle={bundle} ev={ev} token={token} run={run} />}
      {!isDuel && <FixResults bundle={bundle} ev={ev} token={token} run={run} />}
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
            const st = scheduleStatus(m, roundName((m.round ?? '').replace(/pod/i, 'Court')))
            return (
              <ScheduleRow key={m.id} bundle={bundle} a={m.team_a_id} b={m.team_b_id}
                meta={<span className="font-display text-sm font-bold">{bundle.courts.find((c: any) => c.id === m.court_id)?.number ?? '–'}</span>}
                status={st.text} live={st.live}
                canUp={canUp} canDown={canDown}
                onUp={() => run(() => api.adminMoveMatch(token, m.id, 'up'), 'Match moved up')}
                onDown={() => run(() => api.adminMoveMatch(token, m.id, 'down'), 'Match moved down')} />
            )
          })}
      </div>
    </div>
  )
}

/** Test run finished? Wipe every result and knockout line-up and play again; teams and settings stay. */
function StartOver({ token, run }: any) {
  const [mode, setMode] = useState<null | 'one' | 'all'>(null)
  const [txt, setTxt] = useState('')
  const close = () => { setMode(null); setTxt('') }
  return (
    <div className="mt-8 rounded-xl border border-amber-500/50 bg-amber-500/5 p-4">
      <div className="mb-1 text-[11px] font-bold uppercase tracking-wider text-amber-500">Reset points</div>
      <p className="text-sm text-fg-muted">Sets every game back to 0-0 and clears results, medals and the knockout line-up so you can play again.
        Teams, courts, groups and settings stay.</p>
      {!mode ? (
        <div className="mt-3 flex flex-wrap gap-2">
          <button onClick={() => setMode('one')} className="rounded-xl border border-amber-500/60 px-4 py-2.5 text-sm font-bold uppercase text-amber-500">Reset this category…</button>
          <button onClick={() => setMode('all')} className="rounded-xl border border-red-500/60 px-4 py-2.5 text-sm font-bold uppercase text-red-500">Reset ALL categories…</button>
        </div>
      ) : (
        <div className="mt-3 space-y-2">
          <div className="text-sm">
            {mode === 'all' ? 'This clears the points of EVERY category in this event. ' : 'This clears the points of this category only. '}
            Type <span className="font-mono font-bold">RESET</span> to confirm. This cannot be undone.
          </div>
          <input className={inputFull} value={txt} onChange={e => setTxt(e.target.value)} placeholder="RESET" autoCapitalize="characters" />
          <div className="flex gap-2">
            <button disabled={txt.trim().toUpperCase() !== 'RESET'}
              onClick={() => run(() => mode === 'all' ? api.adminResetHub(token) : api.adminResetCompetition(token),
                mode === 'all' ? 'All categories reset to 0-0' : 'This category reset to 0-0').then(close)}
              className="flex-1 rounded-xl bg-amber-600 px-4 py-2.5 font-display font-bold text-white disabled:opacity-30">
              {mode === 'all' ? 'RESET ALL CATEGORIES' : 'RESET THIS CATEGORY'}</button>
            <button onClick={close} className="rounded-xl border border-line px-4 py-2.5 text-sm font-semibold text-fg-muted">Cancel</button>
          </div>
        </div>
      )}
    </div>
  )
}

/** Pinned message on the front page, above "My team". Un-pin makes it disappear. */
function AnnouncementCard({ ev, token, run }: any) {
  const [text, setText] = useState<string>(ev.announcement ?? '')
  const pinned = !!ev.announcement
  return (
    <div className="space-y-2 rounded-xl border border-gold/50 bg-gold/5 p-4">
      <div className="flex items-center justify-between">
        <span className="font-display text-lg font-bold tracking-wide">Announcement</span>
        <span className="text-xs font-bold uppercase text-fg-subtle">{pinned ? 'pinned' : 'not shown'}</span>
      </div>
      <textarea className={inputFull + ' min-h-[84px]'} maxLength={400} value={text} onChange={e => setText(e.target.value)}
        placeholder="e.g. Lunch break 12:30. Men's Doubles semi-finals start at 2 pm." />
      <div className="flex gap-2">
        <button disabled={!text.trim()} onClick={() => run(() => api.adminSetAnnouncement(token, ev.id, text), 'Announcement pinned')}
          className="flex-1 rounded-xl bg-brand px-4 py-2.5 font-display font-bold text-brand-fg disabled:opacity-30">{pinned ? 'UPDATE PIN' : 'PIN TO FRONT PAGE'}</button>
        {pinned && <button onClick={() => run(() => api.adminSetAnnouncement(token, ev.id, ''), 'Announcement removed').then(() => setText(''))}
          className="rounded-xl border border-line px-4 py-2.5 text-sm font-bold uppercase text-fg-muted">Un-pin</button>}
      </div>
    </div>
  )
}

/** Emergency change: play a waiting game next on a court. Its teams (and the game it jumps) turn red on the front page until play starts. */
function MoveUp({ bundle, ev, token, run }: any) {
  const [pickCourt, setPickCourt] = useState<Record<string, string>>({})
  const waiting = bundle.matches.filter((m: any) => m.event_id === ev.id && m.status === 'scheduled' && !m.court_id
    && m.bracket_key == null && m.team_a_id && m.team_b_id).sort((a: any, b: any) => a.sequence - b.sequence)
  const flagged = bundle.matches.filter((m: any) => m.event_id === ev.id && m.alert_at && m.status === 'scheduled')
  if (!waiting.length) return null
  const cn = (id: string | null) => bundle.courts.find((c: any) => c.id === id)?.label ?? 'a court'
  return (
    <div className="space-y-2 rounded-xl border border-red-500/40 bg-red-500/5 p-4">
      <div className="font-display text-lg font-bold tracking-wide">Move a game up</div>
      <p className="text-xs text-fg-subtle">The game goes to the front of its court and swaps places with the game that was next. Both games' teams see a red notice until the game starts.</p>
      {flagged.length > 0 && (
        <div className="space-y-1 rounded-lg border border-red-500/40 p-2 text-xs">
          {flagged.map((m: any) => (
            <div key={m.id} className="flex items-center justify-between gap-2">
              <span className="min-w-0 truncate font-semibold text-red-500">{m.alert_note === 'later' ? 'Later' : 'Up'} · {teamName(bundle, m.team_a_id)} v {teamName(bundle, m.team_b_id)}</span>
              <button onClick={() => run(() => api.adminClearAlert(token, m.id), 'Notice cleared')} className="shrink-0 underline">clear</button>
            </div>
          ))}
        </div>
      )}
      <div className="divide-y divide-line rounded-lg border border-line text-sm">
        {waiting.slice(0, 12).map((m: any) => (
          <div key={m.id} className="flex items-center gap-2 p-2">
            <div className="min-w-0 flex-1">
              <div className="truncate font-semibold">{teamName(bundle, m.team_a_id)} <span className="text-fg-subtle">v</span> {teamName(bundle, m.team_b_id)}</div>
              <div className="text-[11px] text-fg-subtle">{m.slot != null ? `Slot ${m.slot} · ` : ''}{cn(m.home_court)}</div>
            </div>
            <select className="rounded-lg border border-line bg-surface px-1 py-1.5 text-xs" value={pickCourt[m.id] ?? m.home_court ?? ''}
              onChange={e => setPickCourt({ ...pickCourt, [m.id]: e.target.value })}>
              {bundle.courts.map((c: any) => <option key={c.id} value={c.id}>{c.label ?? `Court ${c.number}`}</option>)}
            </select>
            <button onClick={() => run(() => api.adminMoveUp(token, m.id, pickCourt[m.id] ?? m.home_court ?? null), 'Game moved up')}
              className="shrink-0 rounded-lg bg-red-600 px-3 py-1.5 text-xs font-bold uppercase text-white">Play next</button>
          </div>
        ))}
      </div>
    </div>
  )
}

/** Backup plan: correct a finished game (system error, team disqualified after winning). */
function FixResults({ bundle, ev, token, run }: any) {
  const [open, setOpen] = useState(false)
  const [id, setId] = useState<string | null>(null)
  const [a, setA] = useState(0)
  const [b, setB] = useState(0)
  const [win, setWin] = useState<'a' | 'b'>('a')
  const done = bundle.matches.filter((m: any) => m.event_id === ev.id && m.status === 'finished' && m.team_a_id && m.team_b_id)
    .sort((x: any, y: any) => (y.finished_at ?? '').localeCompare(x.finished_at ?? ''))
  if (!done.length) return null
  const edit = (m: any) => { setId(m.id); setA(m.score_a); setB(m.score_b); setWin(m.score_b > m.score_a ? 'b' : 'a') }
  const bad = win === 'a' ? a <= b : b <= a
  return (
    <div className="rounded-xl border border-line bg-surface p-4">
      <button onClick={() => setOpen(!open)} className="flex w-full items-center justify-between text-left">
        <span className="font-display text-lg font-bold tracking-wide">Correct a result</span>
        <span className="text-sm text-fg-subtle">{open ? 'hide' : `${done.length} finished`}</span>
      </button>
      {open && (
        <div className="mt-3 space-y-2">
          <p className="text-xs text-fg-subtle">For a system error, or a team disqualified after winning. Pick the game, set the score and the winner. The next round is updated, as long as that game has not started.</p>
          {done.map((m: any) => (
            <div key={m.id} className="rounded-lg border border-line p-2.5 text-sm">
              <div className="flex items-center justify-between gap-2">
                <div className="min-w-0">
                  <div className="text-[10px] font-semibold uppercase tracking-wider text-fg-subtle">{roundName(m.round) || 'Group'}</div>
                  <div className="truncate font-semibold">{teamName(bundle, m.team_a_id)} <span className="text-fg-subtle">{m.score_a}–{m.score_b}</span> {teamName(bundle, m.team_b_id)}</div>
                </div>
                <button onClick={() => id === m.id ? setId(null) : edit(m)}
                  className="shrink-0 rounded-lg border border-line px-3 py-1.5 text-xs font-bold uppercase">{id === m.id ? 'close' : 'fix'}</button>
              </div>
              {id === m.id && (
                <div className="mt-3 space-y-3">
                  {(['a', 'b'] as const).map(side => (
                    <div key={side} className="flex items-center gap-3">
                      <button onClick={() => setWin(side)}
                        className={`grid h-8 w-8 shrink-0 place-items-center rounded-full border-2 text-xs font-bold ${win === side ? 'border-gold bg-gold/20 text-gold' : 'border-line text-fg-subtle'}`}>{win === side ? '✓' : ''}</button>
                      <span className="min-w-0 flex-1 truncate">{teamName(bundle, side === 'a' ? m.team_a_id : m.team_b_id)}{win === side ? ' · winner' : ''}</span>
                      <Stepper value={side === 'a' ? a : b} min={0} max={99} onChange={v => side === 'a' ? setA(v) : setB(v)} />
                    </div>
                  ))}
                  {bad && <Warn>The winner must have more points. Raise their score or lower the other.</Warn>}
                  <Save disabled={bad} label="SAVE RESULT"
                    onClick={() => run(() => api.adminSetResult(token, m.id, a, b, win), 'Result corrected').then(() => setId(null))} />
                </div>
              )}
            </div>
          ))}
        </div>
      )}
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
  <div className="flex items-center justify-between gap-2 border-t border-line/60 py-2 text-sm first:border-0">
    <span className="min-w-0 flex-1 truncate text-fg-muted">{k}</span>
    <span className={`tabular shrink-0 font-display text-xl font-bold ${accent === 'brand' ? 'text-brand-ink' : 'text-accent'}`}>
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
      <div className="flex items-center justify-between gap-2 border-t border-line/60 py-2 text-sm">
        <span className="min-w-0 flex-1 truncate text-fg-muted">Admin PIN (keep private)</span>
        <span className="flex shrink-0 items-center gap-2">
          <button onClick={() => setEditing(true)}
            className="shrink-0 whitespace-nowrap rounded-lg border border-line px-2.5 py-1 text-xs font-semibold text-fg-muted active:bg-surface-2">
            Change
          </button>
          <span className="tabular font-display text-xl font-bold text-accent">{pin}</span>
        </span>
      </div>
    )
  }
  return (
    <div className="flex items-center justify-between gap-3 border-t border-line/60 py-2 text-sm">
      <span className="min-w-0 flex-1 truncate text-fg-muted">Admin PIN (keep private)</span>
      <span className="flex shrink-0 items-center gap-2">
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
  STAGE_EXISTS: 'That knockout stage already exists — undo it first.',
  STAGE_STARTED: 'That stage has already started, so it can\'t be undone.',
  WRONG_TEAM: 'A team in that tie belongs to another sport.',
  BAD_RULES: 'Those scoring rules are not valid.',
  NOT_FINISHED: 'Only a finished game can be corrected.',
  BRACKET_SEEDED: 'The knockout bracket is already drawn. Clear it first (Bracket tab), then correct the group game.',
  NEXT_STARTED: 'The next game of this team has already started. Reset that game first.',
  WINNER_NEEDS_MORE_POINTS: 'The winner must have more points than the other team.',
  BAD_RESULT: 'That result is not valid.',
}[m] ?? (/admin_replace_group_schedule/.test(m)
  ? 'Run database update 0041 first — without it, regenerating would remove the knockout bracket.'
  : /admin_set_(result|qf_rules)/.test(m) ? 'Run database update 0042 first.'
  : m))
