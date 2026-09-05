/** Demo backend — runs with no Supabase project configured.
 *  State lives in localStorage; a BroadcastChannel fans changes out to every
 *  open tab, so the live board in one tab and six "court devices" in others
 *  behave exactly like separate phones. */
import type { Bundle, Match, PointEvent, Team } from './types'
import { applyPoint, applyUndo, rulesOf } from './scoring'
import type { DraftMatch, DraftTeam } from './draw'

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
  event: {
    name: string; target_score: number; win_by: number; cap: number; switch_at: number
    format?: string; side_a_name?: string; side_b_name?: string
  }
  courts: Array<{ number: number; label: string; scorer_pin: string }>
  teams: Array<{ name: string; pool?: string; side?: 'A' | 'B' }>
  matches: DraftMatch[]
}

interface DemoState {
  bundle: Bundle
  events: PointEvent[]
  adminPin: string
  courtPins: Record<string, string>
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
    const comp = {
      id: uid(), code: genCode(), name: p.name || 'Untitled competition',
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
      id: uid(), event_id: ev.id, court_id: courts[m.courtIdx].id,
      round: m.label ?? `Round ${m.round}`, sequence: m.sequence,
      team_a_id: teams[m.aIdx].id, team_b_id: teams[m.bIdx].id,
      score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      status: 'scheduled' as const, winner_id: null,
      next_match_id: null, next_slot: null,
      started_at: null, finished_at: null, duration_seconds: null,
    }))
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

  updateCompetition(name: string, venue: string) {
    const s = load()
    s.bundle.competition.name = name || s.bundle.competition.name
    s.bundle.competition.venue = venue
    save(s)
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

  setCourtPin(courtId: string, pin: string) {
    const s = load()
    if (!/^\d{4}$/.test(pin)) throw new Error('PIN_MUST_BE_4_DIGITS')
    s.courtPins[courtId] = pin
    save(s)
    localStorage.removeItem(`pp.token.${courtId}`)
  },

  replaceSchedule(eventId: string, draft: DraftMatch[]) {
    const s = load()
    if (s.bundle.matches.some(m => m.status === 'finished' || m.score_a > 0 || m.score_b > 0)) {
      throw new Error('SCHEDULE_IN_PROGRESS')
    }
    const teams = s.bundle.teams.filter(t => t.event_id === eventId)
    const courts = s.bundle.courts
    s.bundle.matches = draft.map(m => ({
      id: uid(), event_id: eventId, court_id: courts[m.courtIdx % courts.length].id,
      round: m.label ?? `Round ${m.round}`, sequence: m.sequence,
      team_a_id: teams[m.aIdx].id, team_b_id: teams[m.bIdx].id,
      score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
      status: 'scheduled' as const, winner_id: null, next_match_id: null, next_slot: null,
      started_at: null, finished_at: null, duration_seconds: null,
    }))
    for (const c of courts) {
      const first = s.bundle.matches
        .filter(m => m.court_id === c.id).sort((a, b) => a.sequence - b.sequence)[0]
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
      { ...m, started_at: m.started_at ?? new Date().toISOString() }, side, rulesOf(ev))
    s.bundle.matches[i] = next
    s.events.push({
      id: uid(), match_id: matchId,
      team_id: next.score_a > m.score_a ? m.team_a_id : m.team_b_id,
      score_a_after: next.score_a, score_b_after: next.score_b,
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
    const next = applyUndo(m, prev?.score_a_after ?? 0, prev?.score_b_after ?? 0, rulesOf(ev))
    s.bundle.matches[i] = next
    save(s)
    return next
  },

  confirm(matchId: string): Match {
    const s = load()
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const next: Match = {
      ...m, status: 'finished',
      winner_id: m.score_a > m.score_b ? m.team_a_id : m.team_b_id,
      finished_at: new Date().toISOString(),
    }
    s.bundle.matches[i] = next
    const up = s.bundle.matches
      .filter(x => x.court_id === m.court_id && x.status === 'scheduled')
      .sort((a, b) => a.sequence - b.sequence)[0]
    if (up) up.status = 'live'
    save(s)
    return next
  },

  overrideScore(matchId: string, a: number, b: number) {
    const s = load()
    const m = s.bundle.matches.find(x => x.id === matchId)
    if (m) { m.score_a = a; m.score_b = b }
    save(s)
  },

  resetMatch(matchId: string): Match {
    const s = load()
    s.events = s.events.filter(e => e.match_id !== matchId)
    const i = s.bundle.matches.findIndex(m => m.id === matchId)
    const m = s.bundle.matches[i]
    const next: Match = {
      ...m, score_a: 0, score_b: 0, a_on_left: true, sides_switched: false,
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
