-- =====================================================================
-- PicklePoint migration 0026: groups_ko opt-ins (first used by MCMD / MCXD)
--
-- ADDITIVE + OPT-IN. Every new column defaults to "off", and every new
-- trigger / branch checks its column first, so competitions that never set
-- them (TEST01, YC2626, MCMC26 ...) run exactly the code they run today.
--
--   legs             2 = each pair in a group meets twice (fixtures are
--                    built by the client; stored for display only)
--   tiebreak         'diff' = wins -> point difference -> head-to-head ->
--                    coin toss (client-side ranking; stored for display)
--   ko_*             knockout games use their own scoring rules
--   play_clock       game time = first point -> last point
--   court_dispatch   'pool' = group matches wait off-court in one queue; a
--                    freed court takes the next match whose teams are idle
--   bracket_preview  show the fixed bracket before the groups finish
--   tv_partner       sister category code for the combined TV screen
--
-- score_point / undo_point are re-created byte-for-byte from 0022 plus ONE
-- guarded block (knockout rules) that only runs when ko_target_score is set.
-- =====================================================================

-- ------------------------------------------------------------ 1. schema
alter table events add column if not exists legs            int not null default 1;
alter table events add column if not exists tiebreak        text not null default 'h2h';
alter table events add column if not exists ko_target_score int;
alter table events add column if not exists ko_win_by       int;
alter table events add column if not exists ko_cap          int;
alter table events add column if not exists ko_switch_at    int;
alter table events add column if not exists play_clock      boolean not null default false;
alter table events add column if not exists court_dispatch  text not null default 'fixed';
alter table events add column if not exists bracket_preview boolean not null default false;
alter table events add column if not exists tv_partner      text;

alter table events drop constraint if exists events_tiebreak_check;
alter table events add constraint events_tiebreak_check check (tiebreak in ('h2h','diff'));
alter table events drop constraint if exists events_court_dispatch_check;
alter table events add constraint events_court_dispatch_check check (court_dispatch in ('fixed','pool'));
alter table events drop constraint if exists events_legs_check;
alter table events add constraint events_legs_check check (legs in (1, 2));

-- ------------------------------------------- 2. knockout scoring rules
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
  if m.bracket_key is not null and e.ko_target_score is not null then
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

-- -------------------------------------------------------- undo_point
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
  if m.bracket_key is not null and e.ko_target_score is not null then
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

-- ------------------------------------------------- 3. shared court queue
-- court_dispatch = 'pool' only. Fills every idle court of the competition
-- with the next queued group match (lowest sequence) whose two teams are not
-- on a court. A court is idle when it has nothing live, awaiting confirm or
-- queued on it. Serialised per event so two courts finishing at the same
-- moment can never grab the same match.
create or replace function _pool_dispatch(p_event uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare e events; ct record; v_next uuid; v_tries int;
begin
  select * into e from events where id = p_event;
  if not found or e.court_dispatch <> 'pool' then return; end if;
  perform pg_advisory_xact_lock(hashtext('pool_dispatch:' || p_event::text));

  for ct in
    select c.id from courts c
     where c.competition_id = e.competition_id
       and not exists (select 1 from matches x
                        where x.court_id = c.id
                          and x.status in ('live','awaiting_confirm','scheduled','on_deck'))
     order by c.number
  loop
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      select m.id into v_next from matches m
       where m.event_id = p_event and m.court_id is null and m.bracket_key is null
         and m.status = 'scheduled'
         and not exists (
           select 1 from matches x
            where x.event_id = p_event and x.status in ('live','awaiting_confirm')
              and (x.team_a_id in (m.team_a_id, m.team_b_id)
                   or x.team_b_id in (m.team_a_id, m.team_b_id)))
       order by m.sequence
       limit 1;
      if v_next is null then return; end if;   -- nothing playable for any court
      update matches set court_id = ct.id, status = 'live'
       where id = v_next and court_id is null and status = 'scheduled';
      exit when found or v_tries >= 5;
    end loop;
  end loop;
end $fn$;

create or replace function _pool_dispatch_trg() returns trigger
language plpgsql security definer set search_path = public as $fn$
begin
  perform _pool_dispatch(new.event_id);
  return null;
end $fn$;

drop trigger if exists pool_dispatch on matches;
create trigger pool_dispatch after update of status on matches
  for each row when (new.status = 'finished' and old.status is distinct from 'finished')
  execute function _pool_dispatch_trg();

-- --------------------------------------------------------- 4. play clock
-- play_clock only: when a game is confirmed, its time is first point -> last
-- point (not "first point -> confirm button"). Undo before confirm simply
-- removes the last point, so the clock follows the corrected score.
create or replace function _play_clock() returns trigger
language plpgsql security definer set search_path = public as $fn$
declare v_on boolean; v_first timestamptz; v_last timestamptz;
begin
  select play_clock into v_on from events where id = new.event_id;
  if not coalesce(v_on, false) then return new; end if;
  select min(created_at), max(created_at) into v_first, v_last
    from point_events where match_id = new.id;
  if v_first is not null then
    new.started_at := v_first;
    new.duration_seconds := extract(epoch from (v_last - v_first))::int;
  end if;
  return new;
end $fn$;

drop trigger if exists play_clock on matches;
create trigger play_clock before update of status on matches
  for each row when (new.status = 'finished' and old.status is distinct from 'finished')
  execute function _play_clock();

-- ---------------------------------------------- 5. admin: knockout rules
create or replace function admin_set_ko_rules(
  p_token text, p_event_id uuid, p_target int, p_win_by int, p_cap int, p_switch_at int)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_target < 1 or p_win_by < 1 then raise exception 'BAD_RULES'; end if;
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  if p_switch_at <> 0 and (p_switch_at < 1 or p_switch_at > p_target) then
    raise exception 'BAD_SWITCH_AT';
  end if;
  update events set ko_target_score = p_target, ko_win_by = p_win_by,
                    ko_cap = p_cap, ko_switch_at = p_switch_at
   where id = p_event_id and competition_id = c and ko_target_score is not null;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_set_ko_rules(text, uuid, int, int, int, int) to anon, authenticated;

-- -------------------------------------------- 6. admin: random group draw
-- Moves team details (name, players, logo) between the event's team slots
-- according to a permutation the client draws. Fixtures stay where they
-- are, so this is a fresh random group draw. Refused once anything in the
-- event has been scored.
create or replace function admin_shuffle_groups(p_token text, p_event_id uuid, p_map jsonb)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; v_n int; v_teams int; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events where id = p_event_id and competition_id = c) then
    raise exception 'NO_EVENT';
  end if;
  if exists (select 1 from matches where event_id = p_event_id
              and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;

  select count(*) into v_teams from teams where event_id = p_event_id;
  -- must be a full permutation of this event's teams
  select count(*) into v_n from (
    select distinct x.slot, x.src
      from jsonb_to_recordset(p_map) as x(slot uuid, src uuid)
      join teams ts on ts.id = x.slot and ts.event_id = p_event_id
      join teams tr on tr.id = x.src  and tr.event_id = p_event_id) q;
  if v_n <> v_teams
     or (select count(distinct x.slot) from jsonb_to_recordset(p_map) as x(slot uuid, src uuid)) <> v_teams
     or (select count(distinct x.src)  from jsonb_to_recordset(p_map) as x(slot uuid, src uuid)) <> v_teams then
    raise exception 'BAD_TEAM';
  end if;

  -- one statement: the FROM side reads the pre-update snapshot, so a swap
  -- never sees a half-moved row
  update teams t set
    name = q.name, player1 = q.player1, player2 = q.player2, logo = q.logo
  from (
    select x.slot, s.name, s.player1, s.player2, s.logo
      from jsonb_to_recordset(p_map) as x(slot uuid, src uuid)
      join teams s on s.id = x.src
  ) q
  where t.id = q.slot;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_shuffle_groups(text, uuid, jsonb) to anon, authenticated;
