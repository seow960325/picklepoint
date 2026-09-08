-- =====================================================================
-- PicklePoint migration 0011: custom join code + delete competition
--
-- Two small, orthogonal additions on top of 0010:
--   1. An organizer can pick their own join code instead of the random
--      6-character one, on EITHER format's creation path.
--   2. An admin can permanently delete a finished competition, so test
--      runs and one-off events don't sit in the database forever.
--
-- Both are additive in effect (fully backward compatible -- omitting the
-- new "code" field behaves exactly as before) but this migration DOES
-- create-or-replace create_competition and create_competition_v3, unlike
-- 0010's rule of never touching an existing function. That's deliberate:
-- 0010's rule existed to keep the untested knockout-bracket logic out of
-- the well-tested duel/round_robin path while it was being built and
-- simulated. A custom-code parameter is a small, independently-testable
-- change, and it needs to reach BOTH creation paths to be useful, not
-- just groups_ko's.
-- =====================================================================

-- ------------------------------------------------------------ 1. create_competition
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
                      side_a_name, side_b_name)
  values (c.id,
          coalesce(nullif(v_ev->>'name',''), 'Main event'),
          coalesce(nullif(v_ev->>'format',''), 'round_robin'),
          coalesce((v_ev->>'target_score')::int, 15),
          coalesce((v_ev->>'win_by')::int, 2),
          coalesce((v_ev->>'cap')::int, 17),
          coalesce((v_ev->>'switch_at')::int, 8),
          nullif(v_ev->>'side_a_name',''),
          nullif(v_ev->>'side_b_name',''))
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

-- --------------------------------------------------------- 2. create_competition_v3
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
                      side_a_name, side_b_name, group_size, advance_per_group, third_place)
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
          coalesce((v_ev->>'third_place')::boolean, true))
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

-- ------------------------------------------------------- 3. admin_delete_competition
-- Every child table (events, courts, teams, matches, point_events,
-- timeouts, audit_log, court_sessions, admin_sessions) references
-- competitions with "on delete cascade", so one delete on the parent
-- row is the whole cleanup -- nothing is left behind.
create or replace function admin_delete_competition(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_code text; begin
  c := _require_admin(p_token);
  select code into v_code from competitions where id = c;
  delete from competitions where id = c;
  return jsonb_build_object('ok', true, 'code', v_code);
end $$;

grant execute on function create_competition(jsonb)          to anon, authenticated;
grant execute on function create_competition_v3(jsonb)       to anon, authenticated;
grant execute on function admin_delete_competition(text)     to anon, authenticated;
