/** Single data layer. Talks to Supabase when VITE_SUPABASE_URL is set,
 *  otherwise falls back to the in-browser demo backend so the app is
 *  runnable the moment you clone it. */
import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import type { Bundle, Competition, Court, Match, PointEvent } from './types'
import { demo, type CreatePayload } from './demo'
import type { DraftMatch } from './draw'
import { deviceId } from './queue'

const url = import.meta.env.VITE_SUPABASE_URL as string | undefined
const key = import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined

export const IS_DEMO = !url || !key || url.includes('YOUR-PROJECT')

// a screen with no live channel (e.g. a phone left locked) hangs up after 5 s
// instead of 50 s, so it doesn't hold one of the free plan's 200 live connections
const sb: SupabaseClient | null = IS_DEMO ? null : createClient(url!, key!, {
  realtime: { disconnectOnEmptyChannelsAfterMs: 5000 } as any,
})

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await sb!.rpc(fn, args)
  if (error) {
    console.error(`[PicklePoint] rpc ${fn} failed:`, error.message, args)
    // the admin session is no longer valid (expired, or the competition was recreated): ask the UI to show the PIN pad again
    if (error.message === 'NOT_ADMIN' && typeof window !== 'undefined') window.dispatchEvent(new Event('pp:admin-expired'))
    throw new Error(error.message)
  }
  return data as T
}

export async function join(code: string): Promise<Bundle> {
  if (IS_DEMO) return demo.join(code)
  return joinLight(code)
}

/** Team pictures are big (full-quality cartoon logos ~150-260 kB each, 32 teams
 *  per code), so every viewer downloads each picture ONCE: it is kept in this
 *  browser (memory + IndexedDB, survives reloads) together with the team's
 *  logo_rev, and only fetched again when an admin or the player changes it
 *  (the database bumps logo_rev on every change). Pictures are never resized here. */
type LogoEntry = { rev: number; logo: string | null }
const logoCache = new Map<string, LogoEntry>()
const TEAM_COLS = 'id,event_id,name,player1,player2,seed,pool,checked_in,side,roster'
let hasRev: boolean | null = null                 // false = database without logo_rev yet (old behaviour)

const IDB_NAME = 'pp-logos', IDB_STORE = 'logos'
let idbP: Promise<IDBDatabase | null> | null = null
function idb(): Promise<IDBDatabase | null> {
  if (idbP) return idbP
  idbP = new Promise(res => {
    try {
      if (typeof indexedDB === 'undefined') return res(null)
      const r = indexedDB.open(IDB_NAME, 1)
      r.onupgradeneeded = () => { try { r.result.createObjectStore(IDB_STORE) } catch { /* exists */ } }
      r.onsuccess = () => res(r.result)
      r.onerror = () => res(null)
      r.onblocked = () => res(null)
    } catch { res(null) }
  })
  return idbP
}
async function idbGet(ids: string[]): Promise<Map<string, LogoEntry>> {
  const out = new Map<string, LogoEntry>()
  const db = await idb(); if (!db || !ids.length) return out
  return new Promise(res => {
    try {
      const tx = db.transaction(IDB_STORE, 'readonly'), st = tx.objectStore(IDB_STORE)
      for (const id of ids) {
        const g = st.get(id)
        g.onsuccess = () => { const v = g.result; if (v && typeof v.rev === 'number') out.set(id, v) }
      }
      tx.oncomplete = () => res(out); tx.onerror = () => res(out); tx.onabort = () => res(out)
    } catch { res(out) }
  })
}
async function idbPut(entries: Array<[string, LogoEntry]>) {
  const db = await idb(); if (!db || !entries.length) return
  try {
    const tx = db.transaction(IDB_STORE, 'readwrite'), st = tx.objectStore(IDB_STORE)
    for (const [id, v] of entries) st.put(v, id)
  } catch { /* storage full / private mode: memory cache still works */ }
}

async function teamsWithLogos(eventIds: string[]): Promise<any[] | null> {
  if (hasRev !== false) {
    const tr = await sb!.from('teams').select(TEAM_COLS + ',logo_rev').in('event_id', eventIds)
    if (!tr.error) {
      hasRev = true
      const teams = (tr.data ?? []) as any[]
      const stale = (t: any) => { const c = logoCache.get(t.id); return !c || c.rev !== (t.logo_rev ?? 0) }
      let need = teams.filter(stale)
      if (need.length) {                                   // this browser may have them from an earlier visit
        const saved = await idbGet(need.map(t => t.id))
        for (const t of need) { const s = saved.get(t.id); if (s && s.rev === (t.logo_rev ?? 0)) logoCache.set(t.id, s) }
        need = need.filter(stale)
      }
      for (let i = 0; i < need.length; i += 8) {            // small batches: no single huge response
        const part = need.slice(i, i + 8)
        const { data, error } = await sb!.from('teams').select('id,logo,logo_rev').in('id', part.map(t => t.id))
        if (error) throw new Error(error.message)
        const put: Array<[string, LogoEntry]> = []
        for (const t of (data ?? []) as any[]) {
          const e = { rev: t.logo_rev ?? 0, logo: t.logo ?? null }
          logoCache.set(t.id, e); put.push([t.id, e])
        }
        void idbPut(put)
      }
      return teams.map(t => ({ ...t, logo: logoCache.get(t.id)?.logo ?? null }))
    }
    if (!/logo_rev/.test(tr.error.message)) throw new Error(tr.error.message)
    hasRev = false
  }
  return null
}

/** Old databases (no logo_rev column yet): pictures re-read on full loads only. */
const legacyLogo = new Map<string, string | null>()
let legacyFull = 0

async function joinLight(code: string, opts?: { full?: boolean }): Promise<Bundle> {
  const head = await rpc<any>('join_competition', { p_code: code })
  const eventIds = head.events.map((e: any) => e.id)
  const [teams, mr] = await Promise.all([
    teamsWithLogos(eventIds),
    sb!.from('matches').select('*').in('event_id', eventIds).order('sequence'),
  ])
  if (mr.error) throw new Error(mr.error.message)
  if (teams) return { ...head, teams, matches: mr.data ?? [] }
  // ---- legacy path
  const now = Date.now()
  if (opts?.full || now - legacyFull > 180000 || !legacyLogo.size) {
    const { data, error } = await sb!.from('teams').select('*').in('event_id', eventIds)
    if (error) throw new Error(error.message)
    legacyFull = now
    for (const t of data ?? []) legacyLogo.set(t.id, t.logo ?? null)
    return { ...head, teams: data ?? [], matches: mr.data ?? [] }
  }
  const tr = await sb!.from('teams').select(TEAM_COLS).in('event_id', eventIds)
  if (tr.error) throw new Error(tr.error.message)
  const tl = (tr.data ?? []) as any[]
  const unknown = tl.filter(t => !legacyLogo.has(t.id)).map(t => t.id)
  if (unknown.length) {
    const { data } = await sb!.from('teams').select('id,logo').in('id', unknown)
    for (const t of data ?? []) legacyLogo.set(t.id, (t as any).logo ?? null)
  }
  return { ...head, teams: tl.map(t => ({ ...t, logo: legacyLogo.get(t.id) ?? null })), matches: mr.data ?? [] }
}

export async function refresh(code: string, opts?: { light?: boolean }): Promise<Bundle> {
  if (IS_DEMO) return demo.refresh()
  return joinLight(code, { full: !opts?.light })
}

export type LiveStatus = 'live' | 'down'
export type RowChange = { type: 'INSERT' | 'UPDATE' | 'DELETE'; row: any; oldId?: string }

/** Live updates. Demo mode uses BroadcastChannel across tabs. Only this
 *  competition's games wake this screen (not every court of every code).
 *  onRow (viewers): the changed match row itself, so the screen can update
 *  without re-reading the whole competition (200 phones x every point would
 *  otherwise hammer the free database). onStatus: 'down' when the server
 *  refuses or drops the channel (e.g. free plan's 200-connection limit) so the
 *  screen can poll faster until it is back. */
export function subscribe(
  bundle: Bundle, onChange: () => void,
  opts?: { onRow?: (c: RowChange) => void; onStatus?: (s: LiveStatus) => void },
): () => void {
  if (IS_DEMO) return demo.subscribe(onChange)

  const ids = bundle.events.map(e => e.id)
  let closed = false
  const ch = sb!
    .channel(`comp:${bundle.competition.id}:${Math.random().toString(36).slice(2, 8)}`)
    .on('postgres_changes', {
      event: '*', schema: 'public', table: 'matches',
      ...(ids.length > 0 && ids.length <= 100 ? { filter: `event_id=in.(${ids.join(',')})` } : {}),
    }, (p: any) => {
      if (closed) return
      if (opts?.onRow) {
        const row = p?.new && Object.keys(p.new).length ? p.new : null
        if (p?.eventType === 'DELETE') opts.onRow({ type: 'DELETE', row: null, oldId: p?.old?.id })
        else if (row && ids.includes(row.event_id)) opts.onRow({ type: p.eventType, row })
        else onChange()
      } else onChange()
    })
    .subscribe(status => {
      if (closed) return
      if (status === 'SUBSCRIBED') { opts?.onStatus?.('live'); onChange() }   // catch up on anything missed while joining
      else opts?.onStatus?.('down')
    })
  return () => { closed = true; void sb!.removeChannel(ch) }
}

export async function unlockCourt(courtId: string, pin: string): Promise<string> {
  if (IS_DEMO) return demo.unlock(courtId, pin)
  return rpc<string>('unlock_court', {
    p_court_id: courtId, p_pin: pin, p_device_id: deviceId,
  })
}

export async function scorePoint(
  matchId: string, side: 'left' | 'right', token: string, clientEventId: string,
): Promise<Match> {
  if (IS_DEMO) return demo.score(matchId, side, clientEventId)
  return rpc<Match>('score_point', {
    p_match_id: matchId, p_side: side, p_token: token,
    p_client_event_id: clientEventId, p_device_id: deviceId,
  })
}

export async function undoPoint(matchId: string, token: string): Promise<Match> {
  if (IS_DEMO) return demo.undo(matchId)
  return rpc<Match>('undo_point', { p_match_id: matchId, p_token: token })
}

export async function confirmMatch(matchId: string, token: string): Promise<Match> {
  if (IS_DEMO) return demo.confirm(matchId)
  return rpc<Match>('confirm_match', { p_match_id: matchId, p_token: token })
}

export async function resetMatch(matchId: string, token: string): Promise<Match> {
  if (IS_DEMO) return demo.resetMatch(matchId)
  return rpc<Match>('reset_match', { p_match_id: matchId, p_token: token })
}

export async function flipSides(matchId: string, token: string): Promise<Match> {
  if (IS_DEMO) return demo.flipSides(matchId)
  return rpc<Match>('flip_sides', { p_match_id: matchId, p_token: token })
}

/** Referee picks who serves first — only takes effect before any point has
 *  been played on the match; a no-op once the score has moved off 0-0. */
export async function setFirstServer(
  matchId: string, side: 'left' | 'right', token: string,
): Promise<Match> {
  if (IS_DEMO) return demo.setFirstServer(matchId, side)
  return rpc<Match>('set_first_server', { p_match_id: matchId, p_side: side, p_token: token })
}

export async function callTimeout(
  matchId: string, side: 'left' | 'right', token: string,
): Promise<void> {
  if (IS_DEMO) return
  await rpc('call_timeout', { p_match_id: matchId, p_side: side, p_token: token })
}

export async function matchEvents(matchId: string): Promise<PointEvent[]> {
  if (IS_DEMO) return demo.events(matchId)
  const { data } = await sb!
    .from('point_events').select('*')
    .eq('match_id', matchId).order('seq')
  return data ?? []
}

// ------------------------------------------------------------- setup
export interface CreateResult {
  code: string
  admin_pin: string
  admin_token: string
  competition_id: string
  courts: Array<{ number: number; scorer_pin: string }>
}

export async function createCompetition(p: CreatePayload): Promise<CreateResult> {
  if (IS_DEMO) return demo.create(p)

  // groups_ko also ships an empty bracket, which needs the second wiring pass
  // that only create_competition_v3 does. Every other format keeps using the
  // original function, untouched.
  const isGroupsKo = p.event.format === 'groups_ko'
  const payload: Record<string, unknown> = {
    name: p.name, venue: p.venue, event_date: p.event_date, admin_pin: p.admin_pin,
    event: p.event,
    courts: p.courts,
    teams: p.teams,
    matches: p.matches.map(m => ({
      a: m.aIdx, b: m.bIdx, court: m.courtIdx, sequence: m.sequence,
      round: m.label ?? `Round ${m.round}`,
    })),
    ...(p.code?.trim() ? { code: p.code.trim() } : {}),
  }
  if (isGroupsKo) {
    payload.bracket = (p.bracket ?? []).map(m => ({
      key: m.key, round: m.round, sequence: m.sequence,
      next_key: m.nextKey, next_slot: m.nextSlot,
      loser_next_key: m.loserNextKey, loser_next_slot: m.loserNextSlot,
    }))
  }
  return rpc<CreateResult>(
    isGroupsKo ? 'create_competition_v3' : 'create_competition',
    { p_payload: payload },
  )
}

/** Lock the group tables and drop the qualifiers into round one of the
 *  bracket. `pairs` comes from the client, which already ranks the group
 *  tables with the wins -> head-to-head -> point-difference chain. */
export async function adminSeedBracket(
  token: string, eventId: string,
  pairs: Array<{ key: string; a: string | null; b: string | null }>,
): Promise<{ matches: number; byes: number }> {
  if (IS_DEMO) return demo.seedBracket(eventId, pairs)
  return rpc('admin_seed_bracket', {
    p_token: token, p_event_id: eventId, p_pairs: pairs,
  })
}

/** Clear the bracket back to empty so a mis-scored group match can be fixed
 *  and the draw redone. Refuses once a knockout match has been played. */
export async function adminUnseedBracket(token: string, eventId: string): Promise<void> {
  if (IS_DEMO) return demo.unseedBracket(eventId)
  await rpc('admin_unseed_bracket', { p_token: token, p_event_id: eventId })
}

/** Permanently deletes the competition and everything under it. Once this
 *  resolves the admin token is dead too — the caller should drop it and
 *  navigate away rather than reload the (now gone) bundle. */
export async function adminDeleteCompetition(token: string): Promise<{ ok: boolean; code: string }> {
  if (IS_DEMO) return demo.deleteCompetition()
  return rpc('admin_delete_competition', { p_token: token })
}

// ------------------------------------------------------------- admin
export async function adminLogin(code: string, pin: string): Promise<string> {
  if (IS_DEMO) return demo.adminLogin(code, pin)
  return rpc<string>('admin_login', { p_code: code, p_pin: pin })
}

export interface AdminBundle {
  competition: Competition & { admin_pin: string }
  courts: Array<Court & { scorer_pin: string }>
}

export async function adminBundle(token: string): Promise<AdminBundle> {
  if (IS_DEMO) return demo.adminBundle() as unknown as AdminBundle
  return rpc<AdminBundle>('admin_bundle', { p_token: token })
}

export async function adminUpdateCompetition(token: string, name: string, venue: string, eventDate?: string) {
  if (IS_DEMO) return demo.updateCompetition(name, venue, eventDate)
  await rpc('admin_update_competition', { p_token: token, p_name: name, p_venue: venue, p_event_date: eventDate ?? null })
}

export async function adminUpdateEvent(
  token: string, eventId: string, name: string,
  r: {
    target_score: number; win_by: number; cap: number; switch_at: number
    side_a_name?: string; side_b_name?: string; serve_mode?: 'winner' | 'alternate'
  },
) {
  if (IS_DEMO) return demo.updateEvent(eventId, { name, ...r })
  await rpc('admin_update_event', {
    p_token: token, p_event_id: eventId, p_name: name,
    p_target: r.target_score, p_win_by: r.win_by, p_cap: r.cap, p_switch_at: r.switch_at,
    p_side_a_name: r.side_a_name ?? null, p_side_b_name: r.side_b_name ?? null,
    p_serve_mode: r.serve_mode ?? null,
  })
}

export async function adminUpsertTeam(
  token: string, eventId: string, teamId: string | null, name: string,
  pool: string, side?: 'A' | 'B' | null,
) {
  if (IS_DEMO) return demo.upsertTeam(eventId, teamId, name, pool, side)
  await rpc('admin_upsert_team', {
    p_token: token, p_event_id: eventId, p_team_id: teamId,
    p_name: name, p_pool: pool, p_side: side ?? null, p_p1: null, p_p2: null,
  })
}

export async function adminDeleteTeam(token: string, teamId: string) {
  if (IS_DEMO) return demo.deleteTeam(teamId)
  await rpc('admin_delete_team', { p_token: token, p_team_id: teamId })
}

export async function adminSetTeamLogo(token: string, teamId: string, logo: string | null) {
  if (IS_DEMO) return demo.setTeamLogo(teamId, logo)
  await rpc('admin_set_team_logo', { p_token: token, p_team_id: teamId, p_logo: logo })
}

export async function adminSetCourtPin(token: string, courtId: string, pin: string) {
  if (IS_DEMO) return demo.setCourtPin(courtId, pin)
  await rpc('admin_set_court_pin', { p_token: token, p_court_id: courtId, p_pin: pin })
}

export async function adminSetAdminPin(token: string, pin: string) {
  if (IS_DEMO) return demo.setAdminPin(pin)
  await rpc('admin_set_admin_pin', { p_token: token, p_pin: pin })
}

export async function adminReplaceSchedule(
  token: string, eventId: string, draft: DraftMatch[],
  teamIds: string[], courtIds: string[],
) {
  if (IS_DEMO) return demo.replaceSchedule(eventId, draft)
  await rpc('admin_replace_schedule', {
    p_token: token, p_event_id: eventId,
    p_matches: draft.map(m => ({
      a: m.aIdx, b: m.bIdx, court: m.courtIdx, sequence: m.sequence,
      round: m.label ?? `Round ${m.round}`,
    })),
    p_team_ids: teamIds, p_court_ids: courtIds,
  })
}

export async function adminResetMatch(token: string, matchId: string): Promise<Match> {
  if (IS_DEMO) return demo.resetMatch(matchId)
  return rpc<Match>('admin_reset_match', { p_token: token, p_match_id: matchId })
}

export async function adminMoveMatch(
  token: string, matchId: string, dir: 'up' | 'down',
): Promise<void> {
  if (IS_DEMO) return demo.moveMatch(matchId, dir)
  await rpc('admin_move_match', { p_token: token, p_match_id: matchId, p_dir: dir })
}

export async function adminOverrideScore(
  matchId: string, adminPin: string, a: number, b: number,
) {
  if (IS_DEMO) return demo.overrideScore(matchId, a, b)
  await rpc('admin_override', {
    p_match_id: matchId, p_admin_pin: adminPin, p_score_a: a, p_score_b: b,
  })
}


// ------------------------------------------------------------- owner console
export interface OwnerCompetition {
  id: string; code: string; name: string; venue: string | null
  event_date: string; status: string; created_at: string
  admin_pin: string
  courts: Array<{ number: number; label: string | null; scorer_pin: string }>
  team_count: number; match_count: number
}

export async function ownerLogin(pin: string): Promise<string> {
  if (IS_DEMO) throw new Error('NOT_AVAILABLE_IN_DEMO')
  return rpc<string>('owner_login', { p_pin: pin })
}

export async function ownerListCompetitions(token: string): Promise<OwnerCompetition[]> {
  if (IS_DEMO) return []
  return rpc<OwnerCompetition[]>('owner_list_competitions', { p_token: token })
}

export async function ownerDeleteCompetition(token: string, competitionId: string): Promise<void> {
  if (IS_DEMO) return
  await rpc('owner_delete_competition', { p_token: token, p_competition_id: competitionId })
}


export async function ownerGetSettings(token: string): Promise<{ frozen: boolean }> {
  if (IS_DEMO) return { frozen: false }
  return rpc<{ frozen: boolean }>('owner_get_settings', { p_token: token })
}

export async function ownerSetFrozen(token: string, frozen: boolean): Promise<void> {
  if (IS_DEMO) return
  await rpc('owner_set_frozen', { p_token: token, p_frozen: frozen })
}

export { demo }

// ---------------------------------------------------- multi-sport (opt-in)
export async function adminAddSportEvent(token: string, p: {
  name: string; sport: string; target_score: number; win_by: number; cap: number
  switch_at: number; serve_mode: string
  courts: Array<{ label: string; scorer_pin: string }>
  teams: Array<{ name: string; pool: string; roster: number }>
}): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_add_sport_event', {
    p_token: token, p_name: p.name, p_sport: p.sport,
    p_target: p.target_score, p_win_by: p.win_by, p_cap: p.cap,
    p_switch_at: p.switch_at, p_serve_mode: p.serve_mode,
    p_courts: p.courts, p_teams: p.teams,
  })
}

export async function adminSetTeamRoster(token: string, teamId: string, roster: number): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_set_team_roster', { p_token: token, p_team_id: teamId, p_roster: roster })
}

export async function adminReplaceTieSchedule(
  token: string, eventId: string,
  draft: Array<{ aIdx: number; bIdx: number; courtIdx: number; sequence: number; round: number; label?: string; tie: string; game: string }>,
  teamIds: string[], courtIds: string[],
): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_replace_tie_schedule', {
    p_token: token, p_event_id: eventId,
    p_matches: draft.map(m => ({
      a: m.aIdx, b: m.bIdx, court: m.courtIdx, sequence: m.sequence,
      round: m.label ?? `Round ${m.round}`, tie: m.tie, game: m.game,
    })),
    p_team_ids: teamIds, p_court_ids: courtIds,
  })
}

export async function adminSetSportCourts(
  token: string, sport: string,
  plan: { MD1: number; MD2: number; XD: number; order?: Array<'MD1' | 'MD2' | 'XD'> },
): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_set_sport_courts', { p_token: token, p_sport: sport, p_plan: plan })
}

// --------------------------------------------- multi-sport knockout (0025)
export async function adminTieFinalEvent(token: string, groupEventId: string, r: {
  target_score: number; win_by: number; cap: number; switch_at: number; serve_mode: string
}): Promise<string> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  return rpc<string>('admin_tie_final_event', {
    p_token: token, p_group_event: groupEventId,
    p_target: r.target_score, p_win_by: r.win_by, p_cap: r.cap,
    p_switch_at: r.switch_at, p_serve_mode: r.serve_mode,
  })
}

export async function adminAddTieStage(
  token: string, eventId: string, stage: string,
  games: Array<{ a: string; b: string; court: string; seq: number; game: string; set: number | null; round: string }>,
): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_add_tie_stage', { p_token: token, p_event_id: eventId, p_stage: stage, p_games: games })
}

export async function adminClearTieStage(token: string, eventId: string, stage: string): Promise<void> {
  if (IS_DEMO) throw new Error('Multi-sport needs the live database')
  await rpc('admin_clear_tie_stage', { p_token: token, p_event_id: eventId, p_stage: stage })
}

// ------------------------------------------- migration 0026 opt-ins
/** Fresh random group draw (team details move between slots; fixtures stay).
 *  Refused once anything in the event has been scored. */
export async function adminShuffleGroups(
  token: string, eventId: string, map: Array<{ slot: string; src: string }>,
): Promise<void> {
  if (IS_DEMO) return demo.shuffleGroups(eventId, map)
  await rpc('admin_shuffle_groups', { p_token: token, p_event_id: eventId, p_map: map })
}

/** Knockout-only scoring rules (events that opted in with ko_target_score). */
export async function adminSetKoRules(
  token: string, eventId: string,
  r: { target_score: number; win_by: number; cap: number; switch_at: number },
): Promise<void> {
  if (IS_DEMO) return demo.setKoRules(eventId, r)
  await rpc('admin_set_ko_rules', {
    p_token: token, p_event_id: eventId,
    p_target: r.target_score, p_win_by: r.win_by, p_cap: r.cap, p_switch_at: r.switch_at,
  })
}

/** Public self-registration (MCMD/MCXD): no admin PIN. Needs migration 0028. */
export async function registerTeam(code: string, p1: string, p2: string, logo: string, token: string, pin: string): Promise<{ team_id: string; name: string; edited: boolean }> {
  if (IS_DEMO) throw new Error('REG_CLOSED')
  return rpc<{ team_id: string; name: string; edited: boolean }>('register_team', { p_code: code, p_p1: p1, p_p2: p2, p_logo: logo, p_token: token, p_pin: pin })
}

/** 4-digit team code check (migration 0030) */
export async function registerCheck(code: string, pin: string, token: string): Promise<void> {
  if (IS_DEMO) throw new Error('REG_CLOSED')
  await rpc('register_check', { p_code: code, p_pin: pin, p_token: token })
}
export async function adminGenRegCodes(token: string): Promise<void> {
  if (IS_DEMO) return
  await rpc('admin_gen_reg_codes', { p_token: token })
}
export async function adminRegCodes(token: string): Promise<{ pin: string; team: string | null; claimed: boolean }[]> {
  if (IS_DEMO) return []
  return rpc('admin_reg_codes', { p_token: token })
}

/** AI team-picture usage (migration 0029) */
export async function adminAiUsage(token: string): Promise<{ today: number; today_code: number; total_code: number; cap: number } | null> {
  if (IS_DEMO) return null
  return rpc('admin_ai_usage', { p_token: token })
}

// ------------------------------------------------- captain ball (migration 0031)
/** Save the full captain-ball game state (clock, fouls, time-outs, score log). */
export async function cbSave(
  matchId: string, token: string, cb: unknown, scoreA: number, scoreB: number, aOnLeft: boolean,
): Promise<Match> {
  if (IS_DEMO) return demo.cbSave(matchId, cb, scoreA, scoreB, aOnLeft)
  return rpc<Match>('cb_save', {
    p_match_id: matchId, p_token: token, p_cb: cb,
    p_score_a: scoreA, p_score_b: scoreB, p_a_on_left: aOnLeft,
  })
}

/** Lock a captain-ball result (a level score is a draw) and start the next game. */
export async function cbFinish(matchId: string, token: string): Promise<Match> {
  if (IS_DEMO) return demo.cbFinish(matchId)
  return rpc<Match>('cb_finish', { p_match_id: matchId, p_token: token })
}

export async function adminSetCbRules(token: string, eventId: string, rules: unknown): Promise<void> {
  if (IS_DEMO) return demo.adminSetCbRules(eventId, rules)
  await rpc('admin_set_cb_rules', { p_token: token, p_event_id: eventId, p_rules: rules })
}
