-- =====================================================================
-- PicklePoint migration 0037: own rules + best-of-N for the Final only
-- Additive, opt-in per event:
--   events.ko_final_only  true = ko_target_score / ko_win_by / ko_cap apply to
--                         the Final games only (other knockout games keep the
--                         event rules). Default false = unchanged behaviour.
--   events.final_best_of  1 (default) or 3: the Final is a series. Game 2 gets
--                         its teams when game 1 ends, game 3 only at 1-1; the
--                         unneeded game is removed once a team has 2 wins.
--   admin_set_final_rules sets both for the competition's group+knockout event.
-- score_point / undo_point are re-created from 0026 with ONE extra condition.
-- =====================================================================
alter table events add column if not exists ko_final_only boolean not null default false;
alter table events add column if not exists final_best_of int not null default 1;

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
  if m.bracket_key is not null and e.ko_target_score is not null
     and (not coalesce(e.ko_final_only, false) or m.bracket_key like 'KO-2-0%') then
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
  if m.bracket_key is not null and e.ko_target_score is not null
     and (not coalesce(e.ko_final_only, false) or m.bracket_key like 'KO-2-0%') then
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

-- ------------------------------------------------------ final series flow
create or replace function _final_series() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev events; v_a uuid; v_b uuid; wa int; wb int; v_next uuid; begin
  select * into ev from events where id = new.event_id;
  if coalesce(ev.final_best_of, 1) < 2 then return null; end if;
  select team_a_id, team_b_id into v_a, v_b from matches
   where event_id = new.event_id and bracket_key = 'KO-2-0';
  if v_a is null or v_b is null then return null; end if;
  select count(*) filter (where winner_id = v_a), count(*) filter (where winner_id = v_b)
    into wa, wb
    from matches where event_id = new.event_id and bracket_key like 'KO-2-0%' and status = 'finished';
  if greatest(wa, wb) >= ev.final_best_of / 2 + 1 then
    -- series decided: the games nobody needs go away
    delete from matches
     where event_id = new.event_id and bracket_key like 'KO-2-0-%'
       and status = 'scheduled' and court_id is null and score_a = 0 and score_b = 0;
    return null;
  end if;
  -- next game of the series gets the two teams; ko_match_flow then puts it on a court
  select id into v_next from matches
   where event_id = new.event_id and bracket_key like 'KO-2-0-%' and team_a_id is null
   order by bracket_key limit 1;
  if v_next is not null then
    update matches set team_a_id = v_a, team_b_id = v_b where id = v_next;
  end if;
  return null;
end $$;

drop trigger if exists final_series on matches;
create trigger final_series after update of status on matches
  for each row
  when (new.bracket_key like 'KO-2-0%' and new.status = 'finished' and old.status is distinct from 'finished')
  execute function _final_series();

-- ------------------------------------------------ admin_set_final_rules
create or replace function admin_set_final_rules(
  p_token text, p_target int, p_win_by int, p_cap int, p_best_of int)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; ev events; v_seq int; i int; begin
  c := _require_admin(p_token);
  if p_target < 1 or p_win_by < 1 or p_cap < p_target or p_best_of not in (1, 3, 5) then
    raise exception 'BAD_RULES';
  end if;
  for ev in select * from events where competition_id = c and format = 'groups_ko' loop
    if not exists (select 1 from matches where event_id = ev.id and bracket_key = 'KO-2-0') then
      continue;
    end if;
    if exists (select 1 from matches where event_id = ev.id and bracket_key like 'KO-2-0%'
                and (status in ('live','awaiting_confirm','finished') or score_a > 0 or score_b > 0)) then
      raise exception 'FINAL_STARTED';
    end if;
    update events set ko_target_score = p_target, ko_win_by = p_win_by, ko_cap = p_cap,
                      ko_final_only = true, final_best_of = p_best_of
     where id = ev.id;
    delete from matches where event_id = ev.id and bracket_key like 'KO-2-0-%';
    select coalesce(max(sequence), 0) into v_seq from matches where event_id = ev.id;
    for i in 2..p_best_of loop
      insert into matches (event_id, court_id, round, sequence, bracket_key, status)
      values (ev.id, null, 'Final', v_seq + i - 1, 'KO-2-0-' || i, 'scheduled');
    end loop;
  end loop;
end $$;
grant execute on function admin_set_final_rules(text, int, int, int, int) to anon, authenticated;
