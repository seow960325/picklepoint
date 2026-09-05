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

const sb: SupabaseClient | null = IS_DEMO ? null : createClient(url!, key!)

const rpc = async <T,>(fn: string, args: Record<string, unknown>): Promise<T> => {
  const { data, error } = await sb!.rpc(fn, args)
  if (error) throw new Error(error.message)
  return data as T
}

export async function join(code: string): Promise<Bundle> {
  if (IS_DEMO) return demo.join(code)

  const head = await rpc<any>('join_competition', { p_code: code })
  const eventIds = head.events.map((e: any) => e.id)
  const [{ data: teams }, { data: matches }] = await Promise.all([
    sb!.from('teams').select('*').in('event_id', eventIds),
    sb!.from('matches').select('*').in('event_id', eventIds).order('sequence'),
  ])
  return { ...head, teams: teams ?? [], matches: matches ?? [] }
}

export async function refresh(code: string): Promise<Bundle> {
  return IS_DEMO ? demo.refresh() : join(code)
}

/** Live updates. Demo mode uses BroadcastChannel across tabs. */
export function subscribe(bundle: Bundle, onChange: () => void): () => void {
  if (IS_DEMO) return demo.subscribe(onChange)

  const ch = sb!
    .channel(`comp:${bundle.competition.id}`)
    .on('postgres_changes', { event: '*', schema: 'public', table: 'matches' }, onChange)
    .subscribe()
  return () => { sb!.removeChannel(ch) }
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
  return rpc<CreateResult>('create_competition', {
    p_payload: {
      name: p.name, venue: p.venue, event_date: p.event_date, admin_pin: p.admin_pin,
      event: p.event,
      courts: p.courts,
      teams: p.teams,
      matches: p.matches.map(m => ({
        a: m.aIdx, b: m.bIdx, court: m.courtIdx, sequence: m.sequence,
        round: m.label ?? `Round ${m.round}`,
      })),
    },
  })
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

export async function adminUpdateCompetition(token: string, name: string, venue: string) {
  if (IS_DEMO) return demo.updateCompetition(name, venue)
  await rpc('admin_update_competition', { p_token: token, p_name: name, p_venue: venue })
}

export async function adminUpdateEvent(
  token: string, eventId: string, name: string,
  r: {
    target_score: number; win_by: number; cap: number; switch_at: number
    side_a_name?: string; side_b_name?: string
  },
) {
  if (IS_DEMO) return demo.updateEvent(eventId, { name, ...r })
  await rpc('admin_update_event', {
    p_token: token, p_event_id: eventId, p_name: name,
    p_target: r.target_score, p_win_by: r.win_by, p_cap: r.cap, p_switch_at: r.switch_at,
    p_side_a_name: r.side_a_name ?? null, p_side_b_name: r.side_b_name ?? null,
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

export async function adminSetCourtPin(token: string, courtId: string, pin: string) {
  if (IS_DEMO) return demo.setCourtPin(courtId, pin)
  await rpc('admin_set_court_pin', { p_token: token, p_court_id: courtId, p_pin: pin })
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

export async function adminOverrideScore(
  matchId: string, adminPin: string, a: number, b: number,
) {
  if (IS_DEMO) return demo.overrideScore(matchId, a, b)
  await rpc('admin_override', {
    p_match_id: matchId, p_admin_pin: adminPin, p_score_a: a, p_score_b: b,
  })
}

export { demo }
