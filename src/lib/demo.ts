/** Demo backend — runs with no Supabase project configured.
 *  State lives in localStorage; a BroadcastChannel fans changes out to every
 *  open tab, so the live board in one tab and six "court devices" in others
 *  behave exactly like separate phones. */
import type { Bundle, Match, PointEvent, Team } from './types'
import { applyPoint, applyUndo, rulesOf, setFirstServer, teamForSide } from './scoring'
import type { DraftKoMatch, DraftMatch, DraftTeam } from './draw'
import { poolDispatch, isPoolDispatch } from './pool'

const KEY = 'pp.demo.v2'
const chan = 'BroadcastChannel' in globalThis ? new BroadcastChannel('pp.demo') : null
const uid = () => crypto.randomUUID()

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'
const genCode = () =>
  Array.from({ length: 6 }, () => ALPHABET[Math.floor(Math.random() * ALPHABET.length)]).join('')

export interface CreatePayload {
  name: string
  venue: string
  event_date: string
  admin_pin: string
  /** optional custom join code — falls back to a random one when omitted */
  code?: string
  event: {
    name: string; target_score: number; win_by: number; cap: number; switch_at: number
    format?: string; side_a_name?: string; side_b_name?: string
    group_size?: number; advance_per_group?: number; third_place?: boolean
    serve_mode?: 'winner' | 'alternate'
  } & Partial<Pick<Bundle['events'][number],
    'legs' | 'tiebreak' | 'ko_target_score' | 'ko_win_by' | 'ko_cap' | 'ko_switch_at'
    | 'play_clock' | 'court_dispatch' | 'bracket_preview' | 'tv_partner'>>
  courts: Array<{ number: number; label: string; scorer_pin: string }>
  teams: Array<{ name: string; pool?: string; side?: 'A' | 'B' }>
  matches: DraftMatch[]
  /** groups_ko only — the empty knockout slots, wired to each other by key */
  bracket?: DraftKoMatch[]
}

interface DemoState {
  bundle: Bundle
  events: PointEvent[]
  adminPin: string
  courtPins: Record<string, string>
}

/** Demo twin of the ko_match_flow trigger in migration 0010. Kept in this
 *  file so the demo backend and the SQL stay in parity: a knockout result
 *  feeds the winner (and, for semi-finals, the loser) onward, and a knockout
 *  match gets a court only once both its teams are known. */
function koFlow(b: Bundle, m: Match): void {
  if (m.bracket_key == null) return

  const put = (targetId: string | null | undefined, slot: 'a' | 'b' | null | undefined,
               teamId: string | null) => {
    if (!targetId || !slot || !teamId) return
    const t = b.matches.find(x => x.id === targetId)
    if (!t) return
    if (slot === 'a') t.team_a_id = teamId; else t.team_b_id = teamId
    koFlow(b, t)
  }

  if (m.status === 'finished' && m.winner_id) {
    put(m.next_match_id, m.next_slot, m.winner_id)
    const loser = m.winner_id === m.team_a_id ? m.team_b_id : m.team_a_id
    put(m.loser_match_id, m.loser_slot, loser)
  }

  if (m.status === 'scheduled' && m.court_id == null
      && m.team_a_id != null && m.team_b_id != null) {
    const pending = (courtId: string) => b.matches.filter(
      x => x.court_id === courtId && (x.status === 'scheduled' || x.status === 'live'
        || x.status === 'on_deck')).length
    // migration 0038: a planned court for this bracket key wins over the quietest
    const plan = b.events.find(e => e.id === m.event_id)?.ko_court_plan
    const planned = plan && m.bracket_key in plan ? b.courts.find(c => c.number === plan[m.bracket_key!]) : undefined
    const court = planned ?? [...b.courts].sort(
      (x, y) => pending(x.id) - pending(y.id) || x.number - y.number)[0]
    if (court) {
      m.court_id = court.id
      const busy = b.matches.some(
        x => x.court_id === court.id
          && (x.status === 'live' || x.status === 'awaiting_confirm'
            // 0038: on a planned court an earlier queued game goes first
            || (!!planned && x.id !== m.id && (x.status === 'scheduled' || x.status === 'on_deck') && x.sequence < m.sequence)))
      m.status = busy ? 'scheduled' : 'live'
    }
  }
}

// ------------------------------------------------------------- seed
const TEAM_NAMES = [
  'Smash Bros', 'Dink Dynasty', 'Net Ninjas', 'Kitchen Kings',
  'Paddle Pop', 'Third Shot Heroes', 'Lob Squad', 'Volley Llamas',
  'Ernie & Bert', 'Backhand Bandits', 'Puchong Pickle', 'Selangor Slice',
]

function seed(): DemoState {
  const comp = {
    id: uid(), code: 'PICKLE', name: 'Puchong Open 2026',
    venue: 'IOI Mall Courts', event_date: new Date().toISOString().slice(0, 10),
    status: 'live',
  }
  const ev = {
    id: uid(), competition_id: comp.id, name: 'Mixed Doubles',
    format: 'round_robin', target_score: 15, win_by: 2, cap: 17,
    switch_at: 8, sort_order: 0,
  }
  const courts = Array.from({ length: 6 }, (_, i) => ({
    id: uid(), number: i + 1, label: `Court ${i + 1}`,
  }))
  const teams: Team[] = TEAM_NAMES.map((name, i) => ({
    id: uid(), event_id: ev.id, name, player1: null, player2: null, pool: i < 6 ? 'A' : 'B',
  }))

  const blank = (seq: number, a: Team, b: Team, court: string, status: Match['status']): Match => ({
    id: uid(), event_id: ev.id, court_id: court, round: 'Group', sequence: seq,
    team_a_id: a.id, team_b_id: b.id, score_a: 0, score_b: 0,
    a_on_left: true, sides_switched: false, status,
    winner_id: null, next_match_id: null, next_slot: null,
    started_at: null, finished_at: null, duration_seconds: null,
  })
  const matches: Match[] = []
  for (let i = 0; i < 6; i++) matches.push(blank(i + 1, teams[i], teams[i + 6], courts[i].id, 'live'))
  for (let i = 0; i < 6; i++)
    matches.push(blank(i + 7, teams[(i + 1) % 12], teams[(i + 5) % 12], courts[i].id, 'scheduled'))

  return {
    bundle: { competition: comp, events: [ev], courts, teams, matches },
    events: [],
    adminPin: '9999',
    courtPins: Object.fromEntries(courts.map(c => [c.id, String(c.number).padStart(4, '0')])),
  }
}

function load(): DemoState {
  const raw = localStorage.getItem(KEY)
  if (raw) { try { return JSON.parse(raw) } catch { /* reseed */ } }
  const s = seed()
  localStorage.setItem(KEY, JSON.stringify(s))
  return s
}
function save(s: DemoState) {
  localStorage.setItem(KEY, JSON.stringify(s))
  chan?.postMessage({ t: Date.now() })
}

export const demo = {
  reset() { localStorage.removeItem(KEY); load(); chan?.postMessage({ t: Date.now() }) },

  join(code: string): Bundle {
    const s = load()
    if (code.trim().toUpperCase() !== s.bundle.competition.code) throw new Error('INVALID_CODE')
    return s.bundle
  },

  refresh(): Bundle { return load().bundle },

  subscribe(cb: () => void) {
    const onMsg = () => cb()
    const onStorage = (e: StorageEvent) => { if (e.key === KEY) cb() }
    chan?.addEventListener('message', onMsg)
    window.addEventListener('storage', onStorage)
    return () => {
      chan?.removeEventListener('message', onMsg)
      window.removeEventListener('storage', onStorage)
    }
  },

  // ------------------------------------------------------- creation
  create(p: CreatePayload) {
    const customCode = p.code?.trim().toUpperCase()
    if (customCode && !/^[A-Z0-9]{3,12}$/.test(customCode)) throw new Error('BAD_CODE')
    const comp = {
      id: uid(), code: customCode || genCode(), name: p.name || 'Untitled competition',
      venue: p.venue, event_date: p.event_date, status: 'live',
    }
    const ev = {
      id: uid(), competition_id: comp.id, format: 'round_robin', sort_order: 0,
      ...p.event,
      name: p.event.name || 'Main event',
    }
    const courts = p.courts.map(c => ({ id: uid(), number: c.number, label: c.label }))
    const teams: Team[] = p.teams.map(t => ({
      id: uid(), event_id: ev.id, name: t.name, player1: null, player2: null,
      pool: t.pool ?? null, side: t.side ?? null,
    }))
    const matches: Match[] = p.matches.map(m => ({
      id: uid(), event_id: ev.id, court_id: m.courtIdx >= 0 ? courts[m.courtIdx].id : null,
      home_court: m.homeCourt != null ? courts[m.homeCourt].id : null,
      round: m.label ?? `Round ${m.round}`, sequence: m.sequence,
      team_a_id: teams[m.aIdx].id, team_b_id: teams[m.bIdx].id,
      score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      status: 'scheduled' as const, winner_id: null,
      next_match_id: null, next_slot: null,
      started_at: null, finished_at: null, duration_seconds: null,
    }))
    // groups_ko: empty knockout slots, parked OFF-COURT so the court queue can
    // never open a court on a match with no teams in it. Mirrors migration 0010.
    const koIds = new Map<string, string>()
    for (const k of p.bracket ?? []) koIds.set(k.key, uid())
    for (const k of p.bracket ?? []) {
      matches.push({
        id: koIds.get(k.key)!, event_id: ev.id, court_id: null,
        round: k.round, sequence: k.sequence,
        team_a_id: null, team_b_id: null, score_a: 0, score_b: 0,
        a_on_left: true, sides_switched: false, status: 'scheduled' as const,
        winner_id: null,
        next_match_id: k.nextKey ? koIds.get(k.nextKey) ?? null : null,
        next_slot: k.nextSlot,
        bracket_key: k.key,
        loser_match_id: k.loserNextKey ? koIds.get(k.loserNextKey) ?? null : null,
        loser_slot: k.loserNextSlot,
        started_at: null, finished_at: null, duration_seconds: null,
      })
    }

    // first fixture on each court goes live so the courts are usable at once
    for (const c of courts) {
      const first = matches.filter(m => m.court_id === c.id).sort((a, b) => a.sequence - b.sequence)[0]
      if (first) first.status = 'live'
    }

    const s: DemoState = {
      bundle: { competition: comp, events: [ev], courts, teams, matches },
      events: [],
      adminPin: p.admin_pin,
      courtPins: Object.fromEntries(courts.map((c, i) => [c.id, p.courts[i].scorer_pin])),
    }
    save(s)
    return {
      code: comp.code, admin_pin: p.admin_pin, admin_token: `demo-admin:${comp.id}`,
      competition_id: comp.id,
      courts: courts.map((c, i) => ({ number: c.number, scorer_pin: p.courts[i].scorer_pin })),
    }
  },

  // ---------------------------------------------------------- admin
  adminLogin(code: string, pin: string): string {
    const s = load()
    if (code.trim().toUpperCase() !== s.bundle.competition.code || pin.trim() !== s.adminPin) {
      throw new Error('BAD_PIN')
    }
    return `demo-admin:${s.bundle.competition.id}`
  },

  adminBundle() {
    const s = load()
    return {
      competition: { ...s.bundle.competition, admin_pin: s.adminPin },
      courts: s.bundle.courts.map(c => ({ ...c, scorer_pin: s.courtPins[c.id] })),
    }
  },

  updateCompetition(name: string, venue: string, eventDate?: string) {
    const s = load()
    s.bundle.competition.name = name || s.bundle.competition.name
    s.bundle.competition.venue = venue
    if (eventDate) s.bundle.competition.event_date = eventDate
    save(s)
  },

  /** Wipes the demo competition's saved state entirely. The next `load()`
   *  reseeds a fresh default demo — matches admin_delete_competition, which
   *  leaves nothing behind for that code to be found by. */
  deleteCompetition() {
    const s = load()
    const code = s.bundle.competition.code
    localStorage.removeItem(KEY)
    chan?.postMessage({ t: Date.now() })
    return { ok: true, code }
  },

  updateEvent(eventId: string, patch: Partial<Bundle['events'][number]>) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    if (e) Object.assign(e, patch)
    save(s)
  },

  upsertTeam(eventId: string, teamId: string | null, name: string, pool: string, side?: 'A' | 'B' | null) {
    const s = load()
    if (teamId) {
      const t = s.bundle.teams.find(x => x.id === teamId)
      if (t) { t.name = name; t.pool = pool; if (side !== undefined) t.side = side }
    } else {
      s.bundle.teams.push({
        id: uid(), event_id: eventId, name, pool, player1: null, player2: null, side: side ?? null,
      })
    }
    save(s)
  },

  deleteTeam(teamId: string) {
    const s = load()
    const played = s.bundle.matches.some(m =>
      m.status === 'finished' && (m.team_a_id === teamId || m.team_b_id === teamId))
    if (played) throw new Error('TEAM_HAS_RESULTS')
    s.bundle.teams = s.bundle.teams.filter(t => t.id !== teamId)
    s.bundle.matches = s.bundle.matches.filter(m => m.team_a_id !== teamId && m.team_b_id !== teamId)
    save(s)
  },

  setTeamLogo(teamId: string, logo: string | null) {
    const s = load()
    const t = s.bundle.teams.find(x => x.id === teamId)
    if (!t) throw new Error('NO_TEAM')
    t.logo = logo
    save(s)
  },

  setCourtPin(courtId: string, pin: string) {
    const s = load()
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN_MUST_BE_4_DIGITS')
    s.courtPins[courtId] = pin
    save(s)
    localStorage.removeItem(`pp.token.${courtId}`)
  },

  setAdminPin(pin: string) {
    const s = load()
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN_MUST_BE_4_DIGITS')
    s.adminPin = pin
    save(s)
  },

  replaceSchedule(eventId: string, draft: DraftMatch[]) {
    const s = load()
    if (s.bundle.matches.some(m => m.status === 'finished' || m.score_a > 0 || m.score_b > 0)) {
      throw new Error('SCHEDULE_IN_PROGRESS')
    }
    const teams = s.bundle.teams.filter(t => t.event_id === eventId)
    const courts = s.bundle.courts
    // the knockout bracket of the event stays (migration 0041), after the new group games
    const bracket = s.bundle.matches.filter(m => m.event_id === eventId && m.bracket_key)
      .sort((a, b) => a.sequence - b.sequence)
    bracket.forEach((m, i) => { m.sequence = draft.length + 1 + i })
    s.bundle.matches = draft.map(m => ({
      id: uid(), event_id: eventId, court_id: courts[m.courtIdx % courts.length].id,
      round: m.label ?? `Round ${m.round}`, sequence: m.sequence,
      team_a_id: teams[m.aIdx].id, team_b_id: teams[m.bIdx].id,
      score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      status: 'scheduled' as const, winner_id: null, next_match_id: null, next_slot: null,
      started_at: null, finished_at: null, duration_seconds: null,
    }))
    const groupGames = s.bundle.matches
    s.bundle.matches = [...groupGames, ...bracket]
    for (const c of courts) {
      const first = s.bundle.matches
        .filter(m => m.court_id === c.id && !m.bracket_key).sort((a, b) => a.sequence - b.sequence)[0]
      if (first) first.status = 'live'
    }
    save(s)
  },

  // -------------------------------------------------------- scoring
  unlock(courtId: string, pin: string): string {
    const s = load()
    if (pin.trim() !== s.courtPins[courtId]) throw new Error('BAD_PIN')
    return `demo:${courtId}`
  },

  score(matchId: string, side: 'left' | 'right', clientEventId: string): Match {
    const s = load()
    if (s.events.some(e => (e as any).client_event_id === clientEventId)) {
      return s.bundle.matches.find(m => m.id === matchId)!
    }
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const ev = s.bundle.events.find(e => e.id === m.event_id)!
    const next = applyPoint(
      { ...m, started_at: m.started_at ?? new Date().toISOString() }, side, rulesOf(ev, m))
    s.bundle.matches[i] = next
    // team_id is the RALLY WINNER (not necessarily who scored — under
    // side-out scoring the receiving side can win the rally with no point).
    const winner = teamForSide(m, side)
    s.events.push({
      id: uid(), match_id: matchId,
      team_id: winner === 'a' ? m.team_a_id : m.team_b_id,
      score_a_after: next.score_a, score_b_after: next.score_b,
      serving_team_after: next.serving_team ?? null,
      server_no_after: next.server_no ?? null,
      created_at: new Date().toISOString(),
      ...({ client_event_id: clientEventId } as any),
    })
    save(s)
    return next
  },

  undo(matchId: string): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const mine = s.events.filter(e => e.match_id === matchId)
    if (!mine.length) return m
    s.events = s.events.filter(e => e.id !== mine[mine.length - 1].id)
    const rest = s.events.filter(e => e.match_id === matchId)
    const prev = rest[rest.length - 1]
    const ev = s.bundle.events.find(e => e.id === m.event_id)!
    const prevWinner: 'a' | 'b' | null = !prev ? null
      : prev.team_id === m.team_a_id ? 'a' : prev.team_id === m.team_b_id ? 'b' : null
    const next = applyUndo(m, prev?.score_a_after ?? 0, prev?.score_b_after ?? 0, rulesOf(ev, m), {
      last_scorer: prevWinner,
      serving_team: prev?.serving_team_after ?? null,
      server_no: prev?.server_no_after ?? null,
    })
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  setFirstServer(matchId: string, side: 'left' | 'right'): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    if (m.score_a !== 0 || m.score_b !== 0) return m   // match already started
    const next = setFirstServer(m, teamForSide(m, side))
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  // captain ball twins of cb_save / cb_finish / admin_set_cb_rules (migration 0031)
  cbSave(matchId: string, cb: any, scoreA: number, scoreB: number, aOnLeft: boolean): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const old = m.started_at ? ((m.cb as any)?.rev ?? 0) : 0
    if ((cb?.rev ?? 0) <= old) throw new Error('CB_STALE')
    const next: Match = { ...m, cb, score_a: scoreA, score_b: scoreB, a_on_left: aOnLeft,
      started_at: m.started_at ?? new Date().toISOString(), status: 'live' }
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  cbFinish(matchId: string): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    if (m.status === 'finished') return m
    const next: Match = {
      ...m, status: 'finished',
      winner_id: m.score_a > m.score_b ? m.team_a_id : m.score_b > m.score_a ? m.team_b_id : null,
      finished_at: new Date().toISOString(),
      duration_seconds: m.started_at ? Math.round((Date.now() - Date.parse(m.started_at)) / 1000) : null,
    }
    s.bundle.matches[i] = next
    const busy = s.bundle.matches.some(x => x.court_id === m.court_id && (x.status === 'live' || x.status === 'awaiting_confirm'))
    const up = s.bundle.matches
      .filter(x => x.court_id === m.court_id && x.status === 'scheduled')
      .sort((a, b) => a.sequence - b.sequence)[0]
    if (up && !busy) up.status = 'live'
    save(s)
    return next
  },

  adminSetCbRules(eventId: string, rules: any): void {
    const s = load()
    const ev = s.bundle.events.find(e => e.id === eventId)
    if (!ev || ev.sport !== 'captainball') throw new Error('NO_EVENT')
    ev.cb_rules = rules
    save(s)
  },

  confirm(matchId: string): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const ev = s.bundle.events.find(e => e.id === m.event_id)
    const pts = s.events.filter(e => e.match_id === matchId)
    // play clock (migration 0026 twin): first point -> last point
    const clock = ev?.play_clock && pts.length
      ? {
          started_at: pts[0].created_at,
          duration_seconds: Math.round((Date.parse(pts[pts.length - 1].created_at) - Date.parse(pts[0].created_at)) / 1000),
        }
      : {}
    const next: Match = {
      ...m, status: 'finished',
      winner_id: m.score_a > m.score_b ? m.team_a_id : m.team_b_id,
      finished_at: new Date().toISOString(),
      ...clock,
    }
    s.bundle.matches[i] = next
    koFlow(s.bundle, next)
    const up = s.bundle.matches
      .filter(x => x.court_id === m.court_id && x.status === 'scheduled')
      .sort((a, b) => a.sequence - b.sequence)[0]
    if (up) up.status = 'live'
    if (isPoolDispatch(ev)) poolDispatch(s.bundle, m.event_id)
    save(s)
    return next
  },

  // ------------------------------------------- migration 0026 opt-ins
  /** Fresh random group draw: team details move between slots, fixtures stay. */
  shuffleGroups(eventId: string, map: Array<{ slot: string; src: string }>) {
    const s = load()
    if (s.bundle.matches.some(m => m.event_id === eventId && (m.status === 'finished' || m.score_a > 0 || m.score_b > 0))) {
      throw new Error('SCHEDULE_IN_PROGRESS')
    }
    const snap = new Map(s.bundle.teams.map(t => [t.id, { ...t }]))
    for (const { slot, src } of map) {
      const t = s.bundle.teams.find(x => x.id === slot && x.event_id === eventId)
      const from = snap.get(src)
      if (!t || !from || from.event_id !== eventId) throw new Error('BAD_TEAM')
      t.name = from.name; t.player1 = from.player1; t.player2 = from.player2; t.logo = from.logo ?? null
    }
    save(s)
  },

  setKoRules(eventId: string, r: { target_score: number; win_by: number; cap: number; switch_at: number }) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    if (e) Object.assign(e, { ko_target_score: r.target_score, ko_win_by: r.win_by, ko_cap: r.cap, ko_switch_at: r.switch_at })
    save(s)
  },

  setQfRules(eventId: string, r: { target_score: number; win_by: number; cap: number }) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    if (e) Object.assign(e, { qf_target_score: r.target_score, qf_win_by: r.win_by, qf_cap: r.cap })
    save(s)
  },

  setStageRules(eventId: string, stage: 'sf' | 'p3' | 'fin', r: { target_score: number; win_by: number; cap: number }) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    if (e) e.stage_rules = { ...(e.stage_rules ?? {}), [stage]: { target: r.target_score, win_by: r.win_by, cap: r.cap } }
    save(s)
  },

  /** admin_reset_competition twin (migration 0045) */
  resetCompetition() {
    const s = load()
    s.events = []
    s.bundle.matches = s.bundle.matches.filter(m => !m.tie_stage)
    for (const m of s.bundle.matches) {
      m.score_a = 0; m.score_b = 0; m.a_on_left = true; m.sides_switched = false
      m.last_scorer = null; m.initial_server = null; m.serving_team = null; m.server_no = null
      m.status = 'scheduled'; m.winner_id = null; m.started_at = null; m.finished_at = null; m.duration_seconds = null
      m.alert_at = null; m.alert_note = null
      if (m.bracket_key != null) { m.team_a_id = null; m.team_b_id = null }
    }
    const first = new Set<string>()
    for (const m of s.bundle.matches.slice().sort((a, b) => a.sequence - b.sequence)) {
      if (m.bracket_key == null && m.court_id && !first.has(m.court_id)) { first.add(m.court_id); m.status = 'live' }
    }
    save(s)
  },

  /** admin_add_announcement / admin_delete_announcement twins (migration 0049) */
  addAnnouncement(eventId: string, text: string) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    const t = text.trim()
    if (!e || !t) return
    const cur = e.announcements ?? []
    if (cur.length >= 3) throw new Error('MAX_3')
    e.announcements = [...cur, { id: Math.random().toString(36).slice(2), text: t, at: new Date().toISOString() }]
    save(s)
  },
  deleteAnnouncement(eventId: string, id: string) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    if (e) e.announcements = (e.announcements ?? []).filter(a => a.id !== id)
    save(s)
  },

  /** admin_set_announcement twin (migration 0044) */
  setAnnouncement(eventId: string, text: string) {
    const s = load()
    const e = s.bundle.events.find(x => x.id === eventId)
    const t = text.trim()
    if (e) { e.announcement = t || null; e.announce_at = t ? new Date().toISOString() : null }
    save(s)
  },

  /** admin_move_up twin (migration 0044) */
  moveUp(matchId: string, courtId: string | null) {
    const s = load()
    const ms = s.bundle.matches
    const pick = ms.find(x => x.id === matchId)
    if (!pick || pick.status !== 'scheduled' || pick.court_id) throw new Error('NOT_WAITING')
    if (pick.bracket_key != null) throw new Error('GROUP_ONLY')
    const court = courtId ?? pick.home_court ?? null
    if (!court) throw new Error('BAD_COURT')
    const ref = ms.filter(x => x.event_id === pick.event_id && x.id !== pick.id && x.bracket_key == null
      && x.status === 'scheduled' && !x.court_id && x.home_court === court).sort((a, b) => a.sequence - b.sequence)[0]
    const now = new Date().toISOString()
    if (ref && ref.sequence < pick.sequence) {
      const sl = pick.slot ?? null, sq = pick.sequence, hc = pick.home_court ?? null
      pick.slot = ref.slot ?? null; pick.sequence = ref.sequence
      ref.slot = sl; ref.sequence = sq; ref.home_court = hc; ref.alert_at = now; ref.alert_note = 'later'
    }
    pick.home_court = court; pick.alert_at = now; pick.alert_note = 'up'
    save(s)
  },

  clearAlert(matchId: string) {
    const s = load()
    const m = s.bundle.matches.find(x => x.id === matchId)
    if (m) { m.alert_at = null; m.alert_note = null }
    save(s)
  },

  /** admin_set_result twin (migration 0042) */
  setResult(matchId: string, a: number, b: number, winner: 'a' | 'b') {
    const s = load()
    const ms = s.bundle.matches
    const m = ms.find(x => x.id === matchId)
    if (!m || m.status !== 'finished') throw new Error('NOT_FINISHED')
    if ((winner === 'a' && a <= b) || (winner === 'b' && b <= a)) throw new Error('WINNER_NEEDS_MORE_POINTS')
    const win = winner === 'a' ? m.team_a_id : m.team_b_id
    const lose = winner === 'a' ? m.team_b_id : m.team_a_id
    if (m.bracket_key == null) {
      const ko = ms.filter(x => x.event_id === m.event_id && x.bracket_key != null)
      if (ko.some(x => x.team_a_id != null)) {
        if (ko.some(x => x.score_a > 0 || x.score_b > 0)) throw new Error('BRACKET_IN_PLAY')
        for (const k of ko) {
          k.team_a_id = null; k.team_b_id = null; k.court_id = null; k.winner_id = null
          k.score_a = 0; k.score_b = 0; k.status = 'scheduled'; k.started_at = null; k.finished_at = null; k.duration_seconds = null
        }
      }
    } else {
      const next = ms.filter(x => x.id === m.next_match_id || x.id === m.loser_match_id)
      if (next.some(n => n.status !== 'scheduled' || n.score_a > 0 || n.score_b > 0)) throw new Error('NEXT_STARTED')
      const nm = ms.find(x => x.id === m.next_match_id)
      if (nm) { if (m.next_slot === 'a') nm.team_a_id = win; else nm.team_b_id = win }
      const lm = ms.find(x => x.id === m.loser_match_id)
      if (lm && lose) { if (m.loser_slot === 'a') lm.team_a_id = lose; else lm.team_b_id = lose }
    }
    m.score_a = a; m.score_b = b; m.winner_id = win
    save(s)
  },

  // ------------------------------------------------- groups_ko bracket
  seedBracket(
    eventId: string, pairs: Array<{ key: string; a: string | null; b: string | null }>,
  ) {
    const s = load()
    const group = s.bundle.matches.filter(
      m => m.event_id === eventId && m.bracket_key == null)
    if (group.some(m => m.status !== 'finished')) throw new Error('GROUP_STAGE_UNFINISHED')

    let filled = 0, byes = 0
    for (const pr of pairs) {
      if (!pr.a && !pr.b) continue
      const slot = s.bundle.matches.find(
        m => m.event_id === eventId && m.bracket_key === pr.key)
      if (!slot) throw new Error('NO_BRACKET_SLOT')
      if (slot.status === 'finished') throw new Error('SLOT_ALREADY_PLAYED')

      if (!pr.a || !pr.b) {
        // bye — nobody plays, the present team walks into the next round
        slot.team_a_id = pr.a ?? pr.b
        slot.team_b_id = null
        slot.status = 'finished'
        slot.winner_id = slot.team_a_id
        slot.finished_at = new Date().toISOString()
        koFlow(s.bundle, slot)
        byes++
      } else {
        slot.team_a_id = pr.a
        slot.team_b_id = pr.b
        koFlow(s.bundle, slot)
        filled++
      }
    }
    save(s)
    return { matches: filled, byes }
  },

  unseedBracket(eventId: string) {
    const s = load()
    const ko = s.bundle.matches.filter(
      m => m.event_id === eventId && m.bracket_key != null)
    if (ko.some(m => m.score_a > 0 || m.score_b > 0)) throw new Error('BRACKET_IN_PLAY')
    for (const m of ko) {
      m.team_a_id = null; m.team_b_id = null; m.court_id = null; m.winner_id = null
      m.score_a = 0; m.score_b = 0; m.status = 'scheduled'
      m.started_at = null; m.finished_at = null; m.duration_seconds = null
    }
    save(s)
  },

  moveMatch(matchId: string, dir: 'up' | 'down') {
    const s = load()
    const m = s.bundle.matches.find(x => x.id === matchId)
    if (m && m.status === 'scheduled') {
      const sibs = s.bundle.matches
        .filter(x => x.court_id === m.court_id && x.status === 'scheduled')
        .sort((a, b) => a.sequence - b.sequence)
      const i = sibs.findIndex(x => x.id === matchId)
      const other = dir === 'up' ? sibs[i - 1] : sibs[i + 1]
      if (other) { const t = m.sequence; m.sequence = other.sequence; other.sequence = t }
    }
    save(s)
  },

  overrideScore(matchId: string, a: number, b: number) {
    const s = load()
    const m = s.bundle.matches.find(x => x.id === matchId)
    if (m) { m.score_a = a; m.score_b = b }
    save(s)
  },

  /** court_pick_match twin (migration 0040): play another waiting game of this
   *  court first; the postponed game goes back to the queue. */
  pickMatch(matchId: string, courtId: string): Match {
    const s = load()
    const ms = s.bundle.matches
    const pick = ms.find(m => m.id === matchId)
    if (!pick) throw new Error('NO_MATCH')
    if (pick.status !== 'scheduled') throw new Error('NOT_SCHEDULED')
    const cur = ms.find(m => m.court_id === courtId && (m.status === 'live' || m.status === 'awaiting_confirm'))
    if (cur && (cur.status !== 'live' || cur.score_a || cur.score_b)) throw new Error('GAME_STARTED')
    const busy = ms.some(x => x !== cur && (x.status === 'live' || x.status === 'awaiting_confirm')
      && [x.team_a_id, x.team_b_id].some(t => t === pick.team_a_id || t === pick.team_b_id))
    if (busy) throw new Error('TEAM_BUSY')
    const ref = cur ?? ms.filter(m => m.status === 'scheduled' && m.id !== pick.id && !m.bracket_key && m.event_id === pick.event_id
      && (m.court_id === courtId || (m.court_id == null && m.home_court === courtId))).sort((a, b) => a.sequence - b.sequence)[0]
    if (cur) {
      const ev = s.bundle.events.find(e => e.id === cur.event_id)
      cur.status = 'scheduled'; cur.started_at = null
      if (isPoolDispatch(ev) && !cur.bracket_key) cur.court_id = null
    }
    if (ref && ref.slot != null && pick.slot != null && pick.slot > ref.slot) {
      const [sl, sq] = [ref.slot, ref.sequence]
      ref.slot = pick.slot; ref.sequence = pick.sequence
      pick.slot = sl; pick.sequence = sq
    }
    pick.court_id = courtId; pick.status = 'live'
    save(s)
    return pick
  },

  flipSides(matchId: string): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const next: Match = { ...s.bundle.matches[i], a_on_left: !s.bundle.matches[i].a_on_left }
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  resetMatch(matchId: string): Match {
    const s = load()
    s.events = s.events.filter(e => e.match_id !== matchId)
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    // keep one live match per court: demote any other live match on this court
    s.bundle.matches.forEach(x => {
      if (x.id !== m.id && x.court_id === m.court_id && x.status === 'live') x.status = 'scheduled'
    })
    const next: Match = {
      ...m, score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      last_scorer: null, initial_server: null, serving_team: null, server_no: null,
      status: 'live', winner_id: null, started_at: null, finished_at: null, duration_seconds: null,
    }
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  events(matchId: string): PointEvent[] {
    return load().events.filter(e => e.match_id === matchId)
  },
}
