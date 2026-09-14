-- =====================================================================
-- PicklePoint migration 0021: serve mode + serve indicator
--
-- Adds a per-event serve_mode setting:
--   'winner'    (default) — whichever team wins the point serves next
--               (this was already the app's informal behaviour; this
--               migration just makes it official/configurable).
--   'alternate' — service swaps sides every 2 total points, regardless
--               of who scores (a rally-scoring "2-point swap" mode).
--
-- Also adds matches.last_scorer ('a'|'b'|null), the team that won the
-- most recent point. 'winner' mode reads it directly; 'alternate' mode
-- ignores it and derives the server from the score total instead. The
-- client mirrors all of this in src/lib/scoring.ts (servingSide()) to
-- draw the pickleball-icon serve indicator on the Court component.
-- =====================================================================

alter table events
  add column serve_mode text not null default 'winner'
    check (serve_mode in ('winner', 'alternate'));

alter table matches
  add column last_scorer text check (last_scorer in ('a', 'b'));

-- ------------------------------------------------------- score_point
create or replace function score_point(
  p_match_id uuid, p_side text, p_token text,
  p_client_event_id text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; e events; v_court uuid; v_team uuid; v_scorer text;
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
    v_team := m.team_a_id; v_a := m.score_a + 1; v_b := m.score_b; v_scorer := 'a';
  else
    v_team := m.team_b_id; v_a := m.score_a;     v_b := m.score_b + 1; v_scorer := 'b';
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
    last_scorer = v_scorer,
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
  e events; v_hi int; v_scorer text;
begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into last_ev from point_events
   where match_id = p_match_id order by seq desc limit 1;
  if not found then return to_jsonb(m); end if;

  delete from point_events where id = last_ev.id;

  select score_a_after, score_b_after, team_id into prev_a, prev_b, prev_team
    from point_events where match_id = p_match_id
   order by seq desc limit 1;
  prev_a := coalesce(prev_a, 0); prev_b := coalesce(prev_b, 0);
  v_scorer := case when prev_team is null then null
                   when prev_team = m.team_a_id then 'a'
                   when prev_team = m.team_b_id then 'b'
                   else null end;

  select * into e from events where id = m.event_id;
  v_hi := greatest(prev_a, prev_b);

  update matches set
    score_a = prev_a,
    score_b = prev_b,
    a_on_left = case when e.switch_at > 0 and sides_switched and v_hi < e.switch_at
                     then not a_on_left else a_on_left end,
    sides_switched = sides_switched and (e.switch_at > 0 and v_hi >= e.switch_at),
    last_scorer = v_scorer,
    status = 'live'
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- ------------------------------------------------------- reset_match
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
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false, last_scorer = null,
    status = 'live', winner_id = null, started_at = null, finished_at = null,
    duration_seconds = null
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- --------------------------------------------------- create_competition
create or replace function create_competition(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c competitions; e events; v_ev jsonb := p_payload->'event';
  court_ids uuid[]; team_ids uuid[];
  r jsonb; v_id uuid; v_tok text; v_code text;
begin
  if coalesce(jsonb_array_length(p_payload->'teams'), 0) < 2 then
    raise exception 'NEED_TWO_TEAMS';
  end if;
  if coalesce(jsonb_array_length(p_payload->'courts'), 0) < 1 then
    raise exception 'NEED_ONE_COURT';
  end if;

  v_code := upper(nullif(p_payload->>'code',''));
  if v_code is not null then
    if v_code !~ '^[A-Z0-9]{3,12}$' then raise exception 'BAD_CODE'; end if;
    if exists (select 1 from competitions where code = v_code) then raise exception 'CODE_TAKEN'; end if;
  end if;

  insert into competitions (code, name, venue, event_date, admin_pin, status)
  values (coalesce(v_code, gen_join_code()),
          coalesce(nullif(p_payload->>'name',''), 'Untitled competition'),
          nullif(p_payload->>'venue',''),
          coalesce((p_payload->>'event_date')::date, current_date),
          coalesce(nullif(p_payload->>'admin_pin',''),
                   lpad((floor(random()*10000))::text, 4, '0')),
          'live')
  returning * into c;

  insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                      side_a_name, side_b_name, serve_mode)
  values (c.id,
          coalesce(nullif(v_ev->>'name',''), 'Main event'),
          coalesce(nullif(v_ev->>'format',''), 'round_robin'),
          coalesce((v_ev->>'target_score')::int, 15),
          coalesce((v_ev->>'win_by')::int, 2),
          coalesce((v_ev->>'cap')::int, 17),
          coalesce((v_ev->>'switch_at')::int, 8),
          nullif(v_ev->>'side_a_name',''),
          nullif(v_ev->>'side_b_name',''),
          coalesce(nullif(v_ev->>'serve_mode',''), 'winner'))
  returning * into e;

  for r in select * from jsonb_array_elements(p_payload->'courts') loop
    insert into courts (competition_id, number, label, scorer_pin)
    values (c.id, (r->>'number')::int, nullif(r->>'label',''),
            coalesce(nullif(r->>'scorer_pin',''),
                     lpad((floor(random()*10000))::text, 4, '0')))
    returning id into v_id;
    court_ids := court_ids || v_id;
  end loop;

  for r in select * from jsonb_array_elements(p_payload->'teams') loop
    insert into teams (event_id, name, pool, side, player1, player2)
    values (e.id, r->>'name', nullif(r->>'pool',''), nullif(r->>'side',''),
            nullif(r->>'player1',''), nullif(r->>'player2',''))
    returning id into v_id;
    team_ids := team_ids || v_id;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_payload->'matches','[]'::jsonb)) loop
    insert into matches (event_id, court_id, round, sequence,
                         team_a_id, team_b_id, status)
    values (e.id,
            court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            team_ids[(r->>'a')::int + 1],
            team_ids[(r->>'b')::int + 1],
            'scheduled');
  end loop;

  update matches m set status = 'live'
   where m.event_id = e.id
     and m.id in (
       select distinct on (court_id) id from matches
        where event_id = e.id order by court_id, sequence);

  insert into admin_sessions (competition_id) values (c.id) returning token into v_tok;

  return jsonb_build_object(
    'code', c.code,
    'admin_pin', c.admin_pin,
    'admin_token', v_tok,
    'competition_id', c.id,
    'courts', (select jsonb_agg(jsonb_build_object('number', number, 'scorer_pin', scorer_pin)
                                order by number) from courts where competition_id = c.id)
  );
end $$;

-- ------------------------------------------------ create_competition_v3
create or replace function create_competition_v3(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c competitions; e events; v_ev jsonb := p_payload->'event';
  court_ids uuid[]; team_ids uuid[];
  r jsonb; v_id uuid; v_tok text; v_code text;
  ko_keys text[] := '{}'; ko_ids uuid[] := '{}'; v_pos int;
begin
  if coalesce(jsonb_array_length(p_payload->'teams'), 0) < 2 then
    raise exception 'NEED_TWO_TEAMS';
  end if;
  if coalesce(jsonb_array_length(p_payload->'courts'), 0) < 1 then
    raise exception 'NEED_ONE_COURT';
  end if;

  v_code := upper(nullif(p_payload->>'code',''));
  if v_code is not null then
    if v_code !~ '^[A-Z0-9]{3,12}$' then raise exception 'BAD_CODE'; end if;
    if exists (select 1 from competitions where code = v_code) then raise exception 'CODE_TAKEN'; end if;
  end if;

  insert into competitions (code, name, venue, event_date, admin_pin, status)
  values (coalesce(v_code, gen_join_code()),
          coalesce(nullif(p_payload->>'name',''), 'Untitled competition'),
          nullif(p_payload->>'venue',''),
          coalesce((p_payload->>'event_date')::date, current_date),
          coalesce(nullif(p_payload->>'admin_pin',''),
                   lpad((floor(random()*10000))::text, 4, '0')),
          'live')
  returning * into c;

  insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                      side_a_name, side_b_name, group_size, advance_per_group, third_place, serve_mode)
  values (c.id,
          coalesce(nullif(v_ev->>'name',''), 'Main event'),
          coalesce(nullif(v_ev->>'format',''), 'round_robin'),
          coalesce((v_ev->>'target_score')::int, 15),
          coalesce((v_ev->>'win_by')::int, 2),
          coalesce((v_ev->>'cap')::int, 17),
          coalesce((v_ev->>'switch_at')::int, 8),
          nullif(v_ev->>'side_a_name',''),
          nullif(v_ev->>'side_b_name',''),
          (v_ev->>'group_size')::int,
          (v_ev->>'advance_per_group')::int,
          coalesce((v_ev->>'third_place')::boolean, true),
          coalesce(nullif(v_ev->>'serve_mode',''), 'winner'))
  returning * into e;

  for r in select * from jsonb_array_elements(p_payload->'courts') loop
    insert into courts (competition_id, number, label, scorer_pin)
    values (c.id, (r->>'number')::int, nullif(r->>'label',''),
            coalesce(nullif(r->>'scorer_pin',''),
                     lpad((floor(random()*10000))::text, 4, '0')))
    returning id into v_id;
    court_ids := court_ids || v_id;
  end loop;

  for r in select * from jsonb_array_elements(p_payload->'teams') loop
    insert into teams (event_id, name, pool, side, player1, player2)
    values (e.id, r->>'name', nullif(r->>'pool',''), nullif(r->>'side',''),
            nullif(r->>'player1',''), nullif(r->>'player2',''))
    returning id into v_id;
    team_ids := team_ids || v_id;
  end loop;

  -- group-stage fixtures: real teams, real courts, exactly as before
  for r in select * from jsonb_array_elements(coalesce(p_payload->'matches','[]'::jsonb)) loop
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status)
    values (e.id,
            court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            team_ids[(r->>'a')::int + 1],
            team_ids[(r->>'b')::int + 1],
            'scheduled');
  end loop;

  -- pass 1: empty knockout slots, no teams and NO COURT yet
  for r in select * from jsonb_array_elements(coalesce(p_payload->'bracket','[]'::jsonb)) loop
    insert into matches (event_id, court_id, round, sequence, bracket_key, status)
    values (e.id, null, r->>'round', (r->>'sequence')::int, r->>'key', 'scheduled')
    returning id into v_id;
    ko_keys := ko_keys || (r->>'key'); ko_ids := ko_ids || v_id;
  end loop;

  -- pass 2: wire winner and loser destinations now that every key has a uuid
  for r in select * from jsonb_array_elements(coalesce(p_payload->'bracket','[]'::jsonb)) loop
    v_pos := array_position(ko_keys, r->>'key');
    if v_pos is null then continue; end if;
    update matches set
      next_match_id  = case when nullif(r->>'next_key','') is null then null
                            else ko_ids[array_position(ko_keys, r->>'next_key')] end,
      next_slot      = nullif(r->>'next_slot',''),
      loser_match_id = case when nullif(r->>'loser_next_key','') is null then null
                            else ko_ids[array_position(ko_keys, r->>'loser_next_key')] end,
      loser_slot     = nullif(r->>'loser_next_slot','')
    where id = ko_ids[v_pos];
  end loop;

  -- first match on each court goes live. court_id is not null excludes every
  -- empty bracket slot, so a court can never open on a match with no teams.
  update matches m set status = 'live'
   where m.event_id = e.id
     and m.id in (
       select distinct on (court_id) id from matches
        where event_id = e.id and court_id is not null
        order by court_id, sequence);

  insert into admin_sessions (competition_id) values (c.id) returning token into v_tok;

  return jsonb_build_object(
    'code', c.code,
    'admin_pin', c.admin_pin,
    'admin_token', v_tok,
    'competition_id', c.id,
    'courts', (select jsonb_agg(jsonb_build_object('number', number, 'scorer_pin', scorer_pin)
                                order by number) from courts where competition_id = c.id)
  );
end $$;

-- -------------------------------------------------------- admin_update_event
-- adds an appended, defaulted p_serve_mode param -- same pattern 0005 used to
-- add p_side_a_name/p_side_b_name, so existing callers keep working untouched.
create or replace function admin_update_event(
  p_token text, p_event_id uuid, p_name text,
  p_target int, p_win_by int, p_cap int, p_switch_at int,
  p_side_a_name text default null, p_side_b_name text default null,
  p_serve_mode text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  if p_switch_at <> 0 and (p_switch_at < 1 or p_switch_at > p_target) then
    raise exception 'BAD_SWITCH_AT';
  end if;
  if p_serve_mode is not null and p_serve_mode not in ('winner', 'alternate') then
    raise exception 'BAD_SERVE_MODE';
  end if;

  update events set
    name = coalesce(nullif(p_name,''), name),
    target_score = p_target, win_by = p_win_by, cap = p_cap, switch_at = p_switch_at,
    side_a_name = coalesce(nullif(p_side_a_name,''), side_a_name),
    side_b_name = coalesce(nullif(p_side_b_name,''), side_b_name),
    serve_mode = coalesce(p_serve_mode, serve_mode)
  where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $$;
