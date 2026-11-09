-- =====================================================================
-- PicklePoint migration 0038: printed-plan knockouts (Christmas Outreach
-- fundraiser MCMD / MCXD). Run AFTER 0037. Additive and opt-in per event;
-- every event that does not set the new columns behaves exactly as before.
--   events.ko_from_sf     true = ko_target_score / ko_win_by / ko_cap apply to
--                         semi-finals, 3rd place and Final only (quarter-finals
--                         keep the group rules).
--   events.ko_court_plan  {"KO-4-0": 1, ...} bracket key -> court number: a
--                         knockout game goes to that court (queued behind the
--                         game already there) instead of the quietest court.
--   events.pool_strict    shared queue (court_dispatch = 'pool'): each court
--                         plays its home games in printed order and waits
--                         while a team of its next game is still on court.
--   events.tiebreak       new value 'diff_only' = wins -> point difference
--                         (no head-to-head; the client handles ranking).
-- score_point / undo_point re-created from 0037 with ONE extra condition;
-- _ko_match_flow from 0010 and _pool_dispatch from 0026 each get one branch.
-- =====================================================================
alter table events add column if not exists ko_from_sf boolean not null default false;
alter table events add column if not exists ko_court_plan jsonb;
alter table events add column if not exists pool_strict boolean not null default false;
alter table events drop constraint if exists events_tiebreak_check;
alter table events add constraint events_tiebreak_check check (tiebreak in ('h2h','diff','diff_only'));

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
  if m.bracket_key is not null and e.ko_target_score is not null
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

-- ------------------------------------------------ knockout flow + court plan
create or replace function _ko_match_flow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loser uuid; v_court uuid; v_busy int; v_plan jsonb; begin
  if new.bracket_key is null then return null; end if;

  -- (a) result just locked in: feed the winner and the loser onward.
  if new.status = 'finished' and coalesce(old.status,'') <> 'finished'
     and new.winner_id is not null then
    if new.next_match_id is not null then
      if new.next_slot = 'a' then
        update matches set team_a_id = new.winner_id where id = new.next_match_id;
      else
        update matches set team_b_id = new.winner_id where id = new.next_match_id;
      end if;
    end if;
    if new.loser_match_id is not null then
      v_loser := case when new.winner_id = new.team_a_id then new.team_b_id else new.team_a_id end;
      if v_loser is not null then
        if new.loser_slot = 'a' then
          update matches set team_a_id = v_loser where id = new.loser_match_id;
        else
          update matches set team_b_id = v_loser where id = new.loser_match_id;
        end if;
      end if;
    end if;
  end if;

  -- (b) both teams now known and still unplaced: the planned court (0038),
  -- else the quietest court; start it if that court has nothing live.
  if new.status = 'scheduled' and new.court_id is null
     and new.team_a_id is not null and new.team_b_id is not null then
    select ko_court_plan into v_plan from events where id = new.event_id;
    if v_plan is not null and v_plan ? new.bracket_key then
      select c.id into v_court
        from courts c join events e on e.id = new.event_id
       where c.competition_id = e.competition_id
         and c.number = (v_plan ->> new.bracket_key)::int
       limit 1;
    end if;
    if v_court is null then
      select c.id into v_court
        from courts c
        join events e on e.id = new.event_id
       where c.competition_id = e.competition_id
       order by (select count(*) from matches m
                  where m.court_id = c.id and m.status in ('scheduled','on_deck','live')),
                c.number
       limit 1;
    end if;
    if v_court is not null then
      select count(*) into v_busy from matches
       where court_id = v_court and status in ('live','awaiting_confirm');
      -- planned courts: an earlier game already queued there goes first (the
      -- court's confirm promotes it), so this one only queues behind it
      -- and a game confirmed on that court in this same transaction means
      -- confirm_match is about to start the court's next queued game itself
      if v_plan is not null and v_busy = 0 then
        select count(*) into v_busy from matches
         where court_id = v_court
           and ((status in ('scheduled','on_deck') and sequence < new.sequence)
                or (status = 'finished' and finished_at = now()));
      end if;
      update matches
         set court_id = v_court,
             status = case when v_busy = 0 then 'live' else 'scheduled' end
       where id = new.id;
    end if;
  end if;

  return null;
end $$;

-- ------------------------------------------------ shared queue, strict order
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
    if coalesce(e.pool_strict, false) then
      -- 0038: this court's next game in printed order, only once both of its
      -- teams are off court (else the court waits for them)
      select m.id into v_next from matches m
       where m.event_id = p_event and m.court_id is null and m.bracket_key is null
         and m.status = 'scheduled'
         and (m.home_court is null or m.home_court = ct.id)
       order by m.sequence limit 1;
      if v_next is not null and not exists (
           select 1 from matches x, matches m
            where m.id = v_next and x.event_id = p_event
              and x.status in ('live','awaiting_confirm')
              and (x.team_a_id in (m.team_a_id, m.team_b_id)
                   or x.team_b_id in (m.team_a_id, m.team_b_id))) then
        update matches set court_id = ct.id, status = 'live'
         where id = v_next and court_id is null and status = 'scheduled';
      end if;
      continue;
    end if;
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      select q.id into v_next from (
        select m.id, m.sequence,
               coalesce(extract(epoch from now() - (
                 select max(f.finished_at) from matches f
                  where f.event_id = p_event and f.status = 'finished'
                    and (f.team_a_id in (m.team_a_id, m.team_b_id)
                         or f.team_b_id in (m.team_a_id, m.team_b_id)))), 1e9) as rest
          from matches m
         where m.event_id = p_event and m.court_id is null and m.bracket_key is null
           and m.status = 'scheduled'
           and (m.home_court is null or m.home_court = ct.id)
           and not exists (
             select 1 from matches x
              where x.event_id = p_event and x.status in ('live','awaiting_confirm')
                and (x.team_a_id in (m.team_a_id, m.team_b_id)
                     or x.team_b_id in (m.team_a_id, m.team_b_id)))
      ) q
      order by (q.rest >= 900) desc,
               case when q.rest >= 900 then q.sequence end,
               q.rest desc
      limit 1;
      exit when v_next is null;               -- nothing playable on this court now
      update matches set court_id = ct.id, status = 'live'
       where id = v_next and court_id is null and status = 'scheduled';
      exit when found or v_tries >= 5;
    end loop;
  end loop;
end $fn$;
