export type MatchStatus =
  | 'scheduled' | 'on_deck' | 'live' | 'awaiting_confirm' | 'finished'

export interface Competition {
  id: string; code: string; name: string
  venue: string | null; event_date: string; status: string
}
export interface EventCfg {
  id: string; competition_id: string; name: string; format: string
  target_score: number; win_by: number; cap: number; switch_at: number
  sort_order: number
  // only set when format === 'duel' — two-side team battle (e.g. country vs country)
  side_a_name?: string | null
  side_b_name?: string | null
  // only set when format === 'groups_ko' — group stage into a knockout bracket
  group_size?: number | null
  advance_per_group?: number | null
  third_place?: boolean | null
  bracket_seeded_at?: string | null
}
export interface Court { id: string; number: number; label: string | null }
export interface Team {
  id: string; event_id: string; name: string
  player1: string | null; player2: string | null; pool: string | null
  // only set when the event format is 'duel'
  side?: 'A' | 'B' | null
}
export interface Match {
  id: string; event_id: string; court_id: string | null
  round: string | null; sequence: number
  team_a_id: string | null; team_b_id: string | null
  score_a: number; score_b: number
  a_on_left: boolean; sides_switched: boolean
  status: MatchStatus; winner_id: string | null
  next_match_id: string | null; next_slot: 'a' | 'b' | null
  // only set on groups_ko knockout slots — null for every group, round-robin
  // and duel match, which is what keeps the two formats from ever interacting
  bracket_key?: string | null
  loser_match_id?: string | null
  loser_slot?: 'a' | 'b' | null
  started_at: string | null; finished_at: string | null
  duration_seconds: number | null
}
export interface PointEvent {
  id: string; match_id: string; team_id: string | null
  score_a_after: number; score_b_after: number; created_at: string
}
export interface Bundle {
  competition: Competition
  events: EventCfg[]
  courts: Court[]
  teams: Team[]
  matches: Match[]
}
