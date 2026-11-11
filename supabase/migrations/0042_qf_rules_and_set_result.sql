-- =====================================================================
-- PicklePoint migration 0042: own scoring for the quarter-finals + admin
-- "correct a result". Run AFTER 0041. Additive; events that do not set the
-- new columns behave exactly as before.
--   events.qf_target_score / qf_win_by / qf_cap
--       quarter-final rules (bracket keys KO-8-*). Null = the group rules.
--       Printed plan events get them filled with their current group rules,
--       so nothing changes until the organiser edits them.
--   admin_set_qf_rules(token, event, target, win_by, cap)
--   admin_set_result(token, match, score_a, score_b, winner)
--       fixes a FINISHED game (system error, disqualification): new score and
--       winner; the next round / 3rd place slot is re-filled when that game
--       has not started yet. Audit-logged.
-- score_point / undo_point re-created from 0038 with ONE extra branch.
-- =====================================================================
alter table events add column if not exists qf_target_score int;
alter table events add column if not exists qf_win_by int;
alter table events add column if not exists qf_cap int;
update events set qf_target_score = target_score, qf_win_by = win_by, qf_cap = cap
 where coalesce(ko_from_sf, false) and qf_target_score is null;

create or replace function score_point(
  p_match_id uuid, p_side text, p_token text,
  p_client_event_id text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; e events; v_court uuid; v_team uuid; v_winner text;
  v_a int; v_b int; v_hi int; v_lo int;
  v_serving text; v_server_no int; v_new_serving text; v_new_server_no int;
  v_last_scorer text;
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
  -- 0026: knockout games of an event with its own knockout rules. Null on
  -- every other event, so their games keep the event rules unchanged.
  if m.bracket_key ~ '^KO-8-' and e.qf_target_score is not null then
    e.target_score := e.qf_target_score;
    e.win_by       := coalesce(e.qf_win_by, e.win_by);
    e.cap          := coalesce(e.qf_cap, e.qf_target_score);
  elsif m.bracket_key is not null and e.ko_target_score is not null
     and (not coalesce(e.ko_final_only, false) or m.bracket_key like 'KO-2-0%')
     -- 0038: ko_from_sf = own rules for semi-finals, 3rd place and Final only
     and (not coalesce(e.ko_from_sf, false) or m.bracket_key ~ '^KO-(4|2)-|^KO-3P') then
    e.target_score := e.ko_target_score;
    e.win_by       := coalesce(e.ko_win_by, e.win_by);
    e.cap          := coalesce(e.ko_cap, e.ko_target_score);
    e.switch_at    := coalesce(e.ko_switch_at, e.switch_at);
  end if;

  -- physical side -> which team WON this rally (the referee always taps
  -- the winning side, same gesture in both serve modes)
  if (p_side = 'left') = m.a_on_left then
    v_team := m.team_a_id; v_winner := 'a';
  else
    v_team := m.team_b_id; v_winner := 'b';
  end if;

  v_last_scorer := null;
  v_new_serving := null; v_new_server_no := null;

  if e.serve_mode = 'alternate' then
    v_serving := coalesce(m.serving_team, m.initial_server, 'a');
    -- official first-service-of-the-game exception: one server, not two
    v_server_no := coalesce(m.server_no, 2);

    if v_winner = v_serving then
      v_a := m.score_a + (case when v_winner = 'a' then 1 else 0 end);
      v_b := m.score_b + (case when v_winner = 'b' then 1 else 0 end);
      v_new_serving := v_serving; v_new_server_no := v_server_no;
    else
      -- serving side lost the rally — no point scored (side-out scoring)
      v_a := m.score_a; v_b := m.score_b;
      if v_server_no = 1 then
        v_new_serving := v_serving; v_new_server_no := 2;              -- 1st fault: partner's turn
      else
        v_new_serving := case when v_serving = 'a' then 'b' else 'a' end; -- 2nd fault: side-out
        v_new_server_no := 1;
      end if;
    end if;
  else
    v_a := m.score_a + (case when v_winner = 'a' then 1 else 0 end);
    v_b := m.score_b + (case when v_winner = 'b' then 1 else 0 end);
    v_last_scorer := v_winner;
  end if;

  insert into point_events (match_id, client_event_id, team_id, delta,
                            score_a_after, score_b_after, device_id,
                            serving_team_after, server_no_after)
  values (p_match_id, p_client_event_id, v_team,
          case when v_a + v_b > m.score_a + m.score_b then 1 else 0 end,
          v_a, v_b, p_device_id, v_new_serving, v_new_server_no);

  v_hi := greatest(v_a, v_b); v_lo := least(v_a, v_b);

  update matches set
    score_a = v_a,
    score_b = v_b,
    started_at = coalesce(started_at, now()),
    sides_switched = sides_switched or (e.switch_at > 0 and v_hi >= e.switch_at),
    a_on_left = case when not sides_switched and e.switch_at > 0 and v_hi >= e.switch_at
                     then not a_on_left else a_on_left end,
    last_scorer = coalesce(v_last_scorer, last_scorer),
    serving_team = case when e.serve_mode = 'alternate' then v_new_serving else serving_team end,
    server_no = case when e.serve_mode = 'alternate' then v_new_server_no else server_no end,
    status = case
      when (v_hi >= e.target_score and v_hi - v_lo >= e.win_by) or v_hi >= e.cap
      then 'awaiting_confirm' else 'live' end
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

create or replace function undo_point(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; last_ev point_events; prev_a int; prev_b int; prev_team uuid;
  prev_serving text; prev_server_no int;
  e events; v_hi int; v_scorer text;
begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into last_ev from point_events
   where match_id = p_match_id order by seq desc limit 1;
  if not found then return to_jsonb(m); end if;

  delete from point_events where id = last_ev.id;

  select score_a_after, score_b_after, team_id, serving_team_after, server_no_after
    into prev_a, prev_b, prev_team, prev_serving, prev_server_no
    from point_events where match_id = p_match_id
   order by seq desc limit 1;
  prev_a := coalesce(prev_a, 0); prev_b := coalesce(prev_b, 0);
  v_scorer := case when prev_team is null then null
                   when prev_team = m.team_a_id then 'a'
                   when prev_team = m.team_b_id then 'b'
                   else null end;

  select * into e from events where id = m.event_id;
  -- 0026: knockout games of an event with its own knockout rules. Null on
  -- every other event, so their games keep the event rules unchanged.
  if m.bracket_key ~ '^KO-8-' and e.qf_target_score is not null then
    e.target_score := e.qf_target_score;
    e.win_by       := coalesce(e.qf_win_by, e.win_by);
    e.cap          := coalesce(e.qf_cap, e.qf_target_score);
  elsif m.bracket_key is not null and e.ko_target_score is not null
     and (not coalesce(e.ko_final_only, false) or m.bracket_key like 'KO-2-0%')
     -- 0038: ko_from_sf = own rules for semi-finals, 3rd place and Final only
     and (not coalesce(e.ko_from_sf, false) or m.bracket_key ~ '^KO-(4|2)-|^KO-3P') then
    e.target_score := e.ko_target_score;
    e.win_by       := coalesce(e.ko_win_by, e.win_by);
    e.cap          := coalesce(e.ko_cap, e.ko_target_score);
    e.switch_at    := coalesce(e.ko_switch_at, e.switch_at);
  end if;
  v_hi := greatest(prev_a, prev_b);

  update matches set
    score_a = prev_a,
    score_b = prev_b,
    a_on_left = case when e.switch_at > 0 and sides_switched and v_hi < e.switch_at
                     then not a_on_left else a_on_left end,
    sides_switched = sides_switched and (e.switch_at > 0 and v_hi >= e.switch_at),
    last_scorer = case when e.serve_mode = 'alternate' then last_scorer else v_scorer end,
    serving_team = case when e.serve_mode = 'alternate' then prev_serving else serving_team end,
    server_no = case when e.serve_mode = 'alternate' then prev_server_no else server_no end,
    status = 'live'
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

create or replace function admin_set_qf_rules(
  p_token text, p_event_id uuid, p_target int, p_win_by int, p_cap int)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_target < 1 or p_win_by < 1 then raise exception 'BAD_RULES'; end if;
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  update events set qf_target_score = p_target, qf_win_by = p_win_by, qf_cap = p_cap
   where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_set_qf_rules(text, uuid, int, int, int) to anon, authenticated;

create or replace function admin_set_result(
  p_token text, p_match_id uuid, p_score_a int, p_score_b int, p_winner text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; m matches; n matches; v_win uuid; v_lose uuid; v_old uuid; begin
  c := _require_admin(p_token);
  select mm.* into m from matches mm join events e on e.id = mm.event_id
   where mm.id = p_match_id and e.competition_id = c for update of mm;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'finished' then raise exception 'NOT_FINISHED'; end if;
  if p_winner not in ('a', 'b') or p_score_a < 0 or p_score_b < 0 then raise exception 'BAD_RESULT'; end if;
  if (p_winner = 'a' and p_score_a <= p_score_b) or (p_winner = 'b' and p_score_b <= p_score_a) then
    raise exception 'WINNER_NEEDS_MORE_POINTS';
  end if;
  v_win := case when p_winner = 'a' then m.team_a_id else m.team_b_id end;
  v_lose := case when p_winner = 'a' then m.team_b_id else m.team_a_id end;

  if m.bracket_key is null then
    if exists (select 1 from matches where event_id = m.event_id and bracket_key is not null and team_a_id is not null) then
      raise exception 'BRACKET_SEEDED';
    end if;
  else
    -- the winner / loser go on to games: only while those have not started
    for n in select * from matches where id in (m.next_match_id, m.loser_match_id) loop
      if n.status in ('live', 'awaiting_confirm', 'finished') or n.score_a > 0 or n.score_b > 0 then
        raise exception 'NEXT_STARTED';
      end if;
    end loop;
    if m.next_match_id is not null then
      if m.next_slot = 'a' then update matches set team_a_id = v_win where id = m.next_match_id;
      else update matches set team_b_id = v_win where id = m.next_match_id; end if;
    end if;
    if m.loser_match_id is not null and v_lose is not null then
      if m.loser_slot = 'a' then update matches set team_a_id = v_lose where id = m.loser_match_id;
      else update matches set team_b_id = v_lose where id = m.loser_match_id; end if;
    end if;
  end if;

  update matches set score_a = p_score_a, score_b = p_score_b, winner_id = v_win
   where id = p_match_id returning * into m;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'set_result', jsonb_build_object('match_id', p_match_id,
          'score_a', p_score_a, 'score_b', p_score_b, 'winner', v_win));
  return to_jsonb(m);
end $fn$;
grant execute on function admin_set_result(text, uuid, int, int, text) to anon, authenticated;
