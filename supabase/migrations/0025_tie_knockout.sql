-- =====================================================================
-- PicklePoint migration 0025: knockout stage for multi-sport ties
--
-- Additive + opt-in like 0023/0024. Only multi_sport competitions (YC2626)
-- can call these RPCs; every other competition never gets a tie_stage /
-- set_no value, so nothing here touches them. score_point / undo_point /
-- confirm_match are NOT modified.
--
--   matches.tie_stage  null = group tie; 'SF1' | 'SF2' | '3P' | 'F'
--   matches.set_no     Final only: game 1/2/3 of a best-of-3 discipline
--   events.stage       'final' = rules-only event the Final is scored with
--                      (e.g. pickleball 11 side-out, badminton 15)
-- =====================================================================

alter table matches add column if not exists tie_stage text;
alter table matches add column if not exists set_no int;
alter table events  add column if not exists stage text;

alter table matches drop constraint if exists matches_tie_stage_check;
alter table matches add constraint matches_tie_stage_check
  check (tie_stage is null or tie_stage in ('SF1','SF2','3P','F'));

-- ------------------------------------------------- admin_tie_final_event
-- Creates (or updates the rules of) the Final's rules event for one sport.
create or replace function admin_tie_final_event(
  p_token text, p_group_event uuid,
  p_target int, p_win_by int, p_cap int, p_switch_at int, p_serve_mode text)
returns uuid language plpgsql security definer set search_path = public as $$
declare c uuid; g events; v uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select * into g from events where id = p_group_event and competition_id = c and stage is null;
  if not found then raise exception 'NO_EVENT'; end if;
  if p_target < 1 or p_win_by < 1 or p_cap < p_target then raise exception 'BAD_RULES'; end if;

  select id into v from events where competition_id = c and sport = g.sport and stage = 'final';
  if v is null then
    insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                        serve_mode, sport, sort_order, stage)
    values (c, g.name || ' Final', 'round_robin', p_target, p_win_by, p_cap, p_switch_at,
            coalesce(nullif(p_serve_mode,''), 'winner'), g.sport, g.sort_order, 'final')
    returning id into v;
  else
    update events set target_score = p_target, win_by = p_win_by, cap = p_cap,
                      switch_at = p_switch_at, serve_mode = coalesce(nullif(p_serve_mode,''), 'winner')
     where id = v;
  end if;
  return v;
end $$;
grant execute on function admin_tie_final_event(text, uuid, int, int, int, int, text) to anon, authenticated;

-- --------------------------------------------------- admin_add_tie_stage
-- Appends one knockout tie (all its games) to the court queues.
--   p_games: [{ a, b, court, seq, game, set, round }]  (a/b/court are ids)
create or replace function admin_add_tie_stage(
  p_token text, p_event_id uuid, p_stage text, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; v_sport text; v_base int; v_tie uuid := gen_random_uuid(); r jsonb; n int := 0;
  v_court uuid;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if p_stage not in ('SF1','SF2','3P','F') then raise exception 'BAD_STAGE'; end if;
  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage) then
    raise exception 'STAGE_EXISTS';
  end if;

  select coalesce(max(m.sequence), 0) into v_base
    from matches m join events e on e.id = m.event_id where e.competition_id = c;

  for r in select * from jsonb_array_elements(p_games) loop
    if not exists (select 1 from teams t join events e on e.id = t.event_id
                    where t.id = (r->>'a')::uuid and e.competition_id = c and e.sport = v_sport)
       or not exists (select 1 from teams t join events e on e.id = t.event_id
                    where t.id = (r->>'b')::uuid and e.competition_id = c and e.sport = v_sport) then
      raise exception 'WRONG_TEAM';
    end if;
    if not exists (select 1 from courts where id = (r->>'court')::uuid
                    and competition_id = c and sport = v_sport) then
      raise exception 'WRONG_SPORT_COURT';
    end if;
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status,
                         tie_id, game_label, tie_stage, set_no)
    values (p_event_id, (r->>'court')::uuid, nullif(r->>'round',''),
            v_base + coalesce((r->>'seq')::int, n + 1),
            (r->>'a')::uuid, (r->>'b')::uuid, 'scheduled',
            v_tie, nullif(r->>'game',''), p_stage, nullif(r->>'set','')::int);
    n := n + 1;
  end loop;

  -- idle courts start their first queued game straight away
  for v_court in select distinct (x->>'court')::uuid from jsonb_array_elements(p_games) x loop
    if not exists (select 1 from matches where court_id = v_court
                    and status in ('live','awaiting_confirm')) then
      update matches set status = 'live'
       where id = (select id from matches where court_id = v_court and status = 'scheduled'
                    order by sequence limit 1);
    end if;
  end loop;

  return jsonb_build_object('tie_id', v_tie, 'created', n);
end $$;
grant execute on function admin_add_tie_stage(text, uuid, text, jsonb) to anon, authenticated;

-- ------------------------------------------------- admin_clear_tie_stage
-- Removes a knockout stage again, only while none of its games has a point.
create or replace function admin_clear_tie_stage(p_token text, p_event_id uuid, p_stage text)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; v_sport text; begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage
                and (m.status = 'finished' or m.score_a > 0 or m.score_b > 0)) then
    raise exception 'STAGE_STARTED';
  end if;
  delete from matches m using events e
   where m.event_id = e.id and e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage;
end $$;
grant execute on function admin_clear_tie_stage(text, uuid, text) to anon, authenticated;

-- ------------------------------------------- best-of-3: drop unneeded game 3
-- Fires only for rows that carry a set_no (Final games of a multi-sport
-- competition). When a discipline is decided 2-0, its queued game 3 is
-- removed before confirm_match advances the court queue.
create or replace function _tie_set_cleanup() returns trigger
language plpgsql security definer set search_path = public as $$
declare wa int; wb int; begin
  select count(*) filter (where winner_id = new.team_a_id),
         count(*) filter (where winner_id = new.team_b_id)
    into wa, wb
    from matches
   where tie_id = new.tie_id and game_label is not distinct from new.game_label
     and set_no is not null and status = 'finished';
  if greatest(wa, wb) >= 2 then
    delete from matches
     where tie_id = new.tie_id and game_label is not distinct from new.game_label
       and set_no is not null and status = 'scheduled' and score_a = 0 and score_b = 0;
  end if;
  return null;
end $$;

drop trigger if exists tie_set_cleanup on matches;
create trigger tie_set_cleanup after update of status on matches
  for each row
  when (new.set_no is not null and new.status = 'finished' and old.status is distinct from 'finished')
  execute function _tie_set_cleanup();
