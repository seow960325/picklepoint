-- =====================================================================
-- PicklePoint migration 0031: captain ball (multi-sport, opt-in)
--
-- ADDITIVE ONLY. Captain ball is a third sport for multi_sport codes: a
-- timed, basketball-style game. Its whole game state (clock, half, fouls,
-- time-outs, score log) lives in one new jsonb column, matches.cb, written
-- by the court scorer through cb_save. The existing scoring RPCs
-- (score_point / undo_point / reset_match / confirm_match) are NOT touched
-- and never see a captain ball game. Every other competition is unchanged:
--   * matches.cb / events.cb_rules are NULL everywhere else
--   * cb_save / cb_finish refuse anything that is not a captain ball game
--   * admin_add_sport_event keeps its exact behaviour, it only also
--     accepts 'captainball'
-- =====================================================================

alter table events drop constraint if exists events_sport_check;
alter table events add constraint events_sport_check
  check (sport in ('pickleball','badminton','captainball'));
alter table courts drop constraint if exists courts_sport_check;
alter table courts add constraint courts_sport_check
  check (sport in ('pickleball','badminton','captainball'));

alter table matches add column if not exists cb jsonb;
alter table events  add column if not exists cb_rules jsonb;

-- ----------------------------------------------------------------- cb_save
-- The scorer sends the full new state after every action. rev must go up:
-- an older device can never overwrite a newer state (CB_STALE). A game the
-- admin reset (started_at back to null) starts again from rev 0.
create or replace function cb_save(
  p_match_id uuid, p_token text, p_cb jsonb,
  p_score_a int, p_score_b int, p_a_on_left boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; v_sport text; v_old int; v_new int; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  select sport into v_sport from events where id = m.event_id;
  if v_sport is distinct from 'captainball' then raise exception 'NOT_CAPTAIN_BALL'; end if;
  if m.status not in ('live', 'awaiting_confirm') then raise exception 'MATCH_NOT_LIVE'; end if;
  if p_score_a < 0 or p_score_b < 0 or p_score_a > 999 or p_score_b > 999 then
    raise exception 'BAD_SCORE';
  end if;

  v_new := coalesce((p_cb->>'rev')::int, 0);
  v_old := case when m.started_at is null then 0 else coalesce((m.cb->>'rev')::int, 0) end;
  if v_new <= v_old then raise exception 'CB_STALE'; end if;

  update matches set
    cb = p_cb, score_a = p_score_a, score_b = p_score_b,
    a_on_left = coalesce(p_a_on_left, a_on_left),
    started_at = coalesce(started_at, now()), status = 'live'
  where id = p_match_id
  returning * into m;
  return to_jsonb(m);
end $$;
grant execute on function cb_save(uuid, text, jsonb, int, int, boolean) to anon, authenticated;

-- --------------------------------------------------------------- cb_finish
-- Lock the result. A level score is a draw (winner_id null) — unlike
-- confirm_match. Then the next game on the court goes live.
create or replace function cb_finish(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; v_sport text; v_winner uuid; v_next uuid; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  select sport into v_sport from events where id = m.event_id;
  if v_sport is distinct from 'captainball' then raise exception 'NOT_CAPTAIN_BALL'; end if;
  if m.status = 'finished' then return to_jsonb(m); end if;

  v_winner := case when m.score_a > m.score_b then m.team_a_id
                   when m.score_b > m.score_a then m.team_b_id else null end;

  update matches set
    status = 'finished', winner_id = v_winner, finished_at = now(),
    duration_seconds = extract(epoch from (now() - coalesce(started_at, now())))::int
  where id = p_match_id
  returning * into m;

  if m.next_match_id is not null and v_winner is not null then
    if m.next_slot = 'a' then
      update matches set team_a_id = v_winner where id = m.next_match_id;
    else
      update matches set team_b_id = v_winner where id = m.next_match_id;
    end if;
  end if;

  if m.court_id is not null and not exists (
      select 1 from matches where court_id = m.court_id and status in ('live', 'awaiting_confirm')) then
    select id into v_next from matches
     where court_id = m.court_id and status = 'scheduled'
     order by sequence limit 1;
    if v_next is not null then
      update matches set status = 'live' where id = v_next;
    end if;
  end if;

  return to_jsonb(m);
end $$;
grant execute on function cb_finish(uuid, text) to anon, authenticated;

-- ---------------------------------------------------------- admin_set_cb_rules
create or replace function admin_set_cb_rules(p_token text, p_event_id uuid, p_rules jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events
                  where id = p_event_id and competition_id = c and sport = 'captainball') then
    raise exception 'NO_EVENT';
  end if;
  if coalesce((p_rules->>'half_min')::numeric, 0) <= 0
     or coalesce((p_rules->>'halves')::int, 0) not between 1 and 4 then
    raise exception 'BAD_RULES';
  end if;
  update events set cb_rules = p_rules where id = p_event_id;
end $$;
grant execute on function admin_set_cb_rules(text, uuid, jsonb) to anon, authenticated;

-- --------------------------------------------------- admin_add_sport_event
-- Same as 0023, but 'captainball' is an allowed sport too.
create or replace function admin_add_sport_event(
  p_token text, p_name text, p_sport text,
  p_target int, p_win_by int, p_cap int, p_switch_at int, p_serve_mode text,
  p_courts jsonb, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; v_ev events; r jsonb; v_next int; v_sort int;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  if p_sport not in ('pickleball','badminton','captainball') then raise exception 'BAD_SPORT'; end if;
  if p_target < 1 or p_win_by < 1 or p_cap < p_target then raise exception 'BAD_RULES'; end if;

  select coalesce(max(sort_order), 0) + 1 into v_sort from events where competition_id = c;

  insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                      serve_mode, sport, sort_order)
  values (c, coalesce(nullif(p_name,''), initcap(p_sport)), 'round_robin',
          p_target, p_win_by, p_cap, p_switch_at,
          coalesce(nullif(p_serve_mode,''), 'winner'), p_sport, v_sort)
  returning * into v_ev;

  select coalesce(max(number), 0) into v_next from courts where competition_id = c;
  for r in select * from jsonb_array_elements(coalesce(p_courts, '[]'::jsonb)) loop
    v_next := v_next + 1;
    insert into courts (competition_id, number, label, scorer_pin, sport)
    values (c, v_next, nullif(r->>'label',''),
            coalesce(nullif(r->>'scorer_pin',''), lpad((floor(random()*10000))::text, 4, '0')),
            p_sport);
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_teams, '[]'::jsonb)) loop
    insert into teams (event_id, name, pool, roster)
    values (v_ev.id, r->>'name', coalesce(nullif(r->>'pool',''), 'A'),
            coalesce((r->>'roster')::int, 6));
  end loop;

  return jsonb_build_object('event_id', v_ev.id);
end $$;
grant execute on function admin_add_sport_event(text, text, text, int, int, int, int, text, jsonb, jsonb)
  to anon, authenticated;
