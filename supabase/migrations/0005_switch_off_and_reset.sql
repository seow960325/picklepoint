-- =====================================================================
-- PicklePoint migration 0005:
--  1. switch_at = 0 now means "end-switching is off" (previously any value
--     had to be between 1 and target_score; the UI now offers an OFF toggle).
--  2. new reset_match rpc — lets the on-court referee zero out a match
--     (score, point log, sides, status) without needing the admin PIN.
--     Same access as score_point/undo_point: requires a valid court session
--     token for the court the match is on.
-- =====================================================================

create or replace function score_point(
  p_match_id uuid, p_side text, p_token text,
  p_client_event_id text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; e events; v_court uuid; v_team uuid;
  v_a int; v_b int; v_hi int; v_lo int;
begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  if exists (select 1 from point_events where client_event_id = p_client_event_id) then
    select * into m from matches where id = p_match_id;
    return to_jsonb(m);
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into e from events where id = m.event_id;

  if (p_side = 'left') = m.a_on_left then
    v_team := m.team_a_id; v_a := m.score_a + 1; v_b := m.score_b;
  else
    v_team := m.team_b_id; v_a := m.score_a;     v_b := m.score_b + 1;
  end if;

  insert into point_events (match_id, client_event_id, team_id, delta,
                            score_a_after, score_b_after, device_id)
  values (p_match_id, p_client_event_id, v_team, 1, v_a, v_b, p_device_id);

  v_hi := greatest(v_a, v_b); v_lo := least(v_a, v_b);

  update matches set
    score_a = v_a,
    score_b = v_b,
    started_at = coalesce(started_at, now()),
    -- switch ends the first time the leader reaches switch_at; switch_at <= 0
    -- means the organizer turned end-switching off entirely
    sides_switched = sides_switched or (e.switch_at > 0 and v_hi >= e.switch_at),
    a_on_left = case when not sides_switched and e.switch_at > 0 and v_hi >= e.switch_at
                     then not a_on_left else a_on_left end,
    status = case
      when (v_hi >= e.target_score and v_hi - v_lo >= e.win_by) or v_hi >= e.cap
      then 'awaiting_confirm' else 'live' end
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

create or replace function undo_point(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; last_ev point_events; prev_a int; prev_b int; e events; v_hi int; begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into last_ev from point_events
   where match_id = p_match_id order by seq desc limit 1;
  if not found then return to_jsonb(m); end if;

  delete from point_events where id = last_ev.id;

  select score_a_after, score_b_after into prev_a, prev_b
    from point_events where match_id = p_match_id
   order by seq desc limit 1;
  prev_a := coalesce(prev_a, 0); prev_b := coalesce(prev_b, 0);

  select * into e from events where id = m.event_id;
  v_hi := greatest(prev_a, prev_b);

  update matches set
    score_a = prev_a,
    score_b = prev_b,
    a_on_left = case when e.switch_at > 0 and sides_switched and v_hi < e.switch_at
                     then not a_on_left else a_on_left end,
    sides_switched = sides_switched and (e.switch_at > 0 and v_hi >= e.switch_at),
    status = 'live'
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- admin_update_event: allow p_switch_at = 0 (disabled) alongside the normal
-- 1..target_score range.
create or replace function admin_update_event(
  p_token text, p_event_id uuid, p_name text,
  p_target int, p_win_by int, p_cap int, p_switch_at int,
  p_side_a_name text default null, p_side_b_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  if p_switch_at <> 0 and (p_switch_at < 1 or p_switch_at > p_target) then
    raise exception 'BAD_SWITCH_AT';
  end if;

  update events set
    name = coalesce(nullif(p_name,''), name),
    target_score = p_target, win_by = p_win_by, cap = p_cap, switch_at = p_switch_at,
    side_a_name = coalesce(nullif(p_side_a_name,''), side_a_name),
    side_b_name = coalesce(nullif(p_side_b_name,''), side_b_name)
  where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- reset_match: on-court referee can zero out a match they're scoring,
-- without needing the admin PIN. Clears the point log too.
create or replace function reset_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;

  delete from point_events where match_id = p_match_id;

  update matches set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    status = 'live', winner_id = null, started_at = null, finished_at = null,
    duration_seconds = null
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

grant execute on function reset_match(uuid, text) to anon, authenticated;
