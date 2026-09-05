-- =====================================================================
-- PicklePoint migration 0002: competition setup + admin editing
-- =====================================================================

-- proof that someone entered the competition's admin PIN
create table admin_sessions (
  token          text primary key default encode(gen_random_bytes(24), 'hex'),
  competition_id uuid not null references competitions(id) on delete cascade,
  created_at     timestamptz not null default now(),
  expires_at     timestamptz not null default now() + interval '24 hours'
);
alter table admin_sessions enable row level security;

create or replace function _admin_comp(p_token text)
returns uuid language sql stable security definer set search_path = public as $$
  select competition_id from admin_sessions
   where token = p_token and expires_at > now()
$$;

create or replace function _require_admin(p_token text) returns uuid
language plpgsql stable security definer set search_path = public as $$
declare c uuid; begin
  c := _admin_comp(p_token);
  if c is null then raise exception 'NOT_ADMIN'; end if;
  return c;
end $$;

-- ------------------------------------------------------------ create
-- The client builds the draw (src/lib/draw.ts) and posts the whole thing.
-- payload = {
--   name, venue, event_date, admin_pin,
--   event: { name, target_score, win_by, cap, switch_at },
--   courts: [{ number, label, scorer_pin }],
--   teams:  [{ name, pool, player1, player2 }],
--   matches:[{ a, b, court, sequence, round }]      -- a/b/court are indexes
-- }
create or replace function create_competition(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c competitions; e events; v_ev jsonb := p_payload->'event';
  court_ids uuid[]; team_ids uuid[];
  r jsonb; v_id uuid; v_tok text;
begin
  if coalesce(jsonb_array_length(p_payload->'teams'), 0) < 2 then
    raise exception 'NEED_TWO_TEAMS';
  end if;
  if coalesce(jsonb_array_length(p_payload->'courts'), 0) < 1 then
    raise exception 'NEED_ONE_COURT';
  end if;

  insert into competitions (name, venue, event_date, admin_pin, status)
  values (coalesce(nullif(p_payload->>'name',''), 'Untitled competition'),
          nullif(p_payload->>'venue',''),
          coalesce((p_payload->>'event_date')::date, current_date),
          coalesce(nullif(p_payload->>'admin_pin',''),
                   lpad((floor(random()*10000))::text, 4, '0')),
          'live')
  returning * into c;

  insert into events (competition_id, name, target_score, win_by, cap, switch_at)
  values (c.id,
          coalesce(nullif(v_ev->>'name',''), 'Main event'),
          coalesce((v_ev->>'target_score')::int, 15),
          coalesce((v_ev->>'win_by')::int, 2),
          coalesce((v_ev->>'cap')::int, 17),
          coalesce((v_ev->>'switch_at')::int, 8))
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
    insert into teams (event_id, name, pool, player1, player2)
    values (e.id, r->>'name', nullif(r->>'pool',''),
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

  -- first match on each court goes live so the courts are usable immediately
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

-- ------------------------------------------------------------- admin
create or replace function admin_login(p_code text, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; t text; begin
  select id into v_id from competitions
   where upper(code) = upper(trim(p_code)) and admin_pin = trim(p_pin);
  if v_id is null then raise exception 'BAD_PIN'; end if;
  insert into admin_sessions (competition_id) values (v_id) returning token into t;
  return t;
end $$;

create or replace function admin_update_competition(
  p_token text, p_name text, p_venue text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  update competitions set name = coalesce(nullif(p_name,''), name), venue = p_venue
   where id = c;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_update_event(
  p_token text, p_event_id uuid, p_name text,
  p_target int, p_win_by int, p_cap int, p_switch_at int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  if p_switch_at < 1 or p_switch_at > p_target then raise exception 'BAD_SWITCH_AT'; end if;

  update events set
    name = coalesce(nullif(p_name,''), name),
    target_score = p_target, win_by = p_win_by, cap = p_cap, switch_at = p_switch_at
  where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_upsert_team(
  p_token text, p_event_id uuid, p_team_id uuid,
  p_name text, p_pool text, p_p1 text, p_p2 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_id uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events where id = p_event_id and competition_id = c) then
    raise exception 'NO_EVENT';
  end if;

  if p_team_id is null then
    insert into teams (event_id, name, pool, player1, player2)
    values (p_event_id, p_name, nullif(p_pool,''), nullif(p_p1,''), nullif(p_p2,''))
    returning id into v_id;
  else
    update teams set name = p_name, pool = nullif(p_pool,''),
                     player1 = nullif(p_p1,''), player2 = nullif(p_p2,'')
     where id = p_team_id and event_id = p_event_id
    returning id into v_id;
    if v_id is null then raise exception 'NO_TEAM'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

create or replace function admin_delete_team(p_token text, p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if exists (
    select 1 from matches m join events e on e.id = m.event_id
     where e.competition_id = c and m.status = 'finished'
       and (m.team_a_id = p_team_id or m.team_b_id = p_team_id)
  ) then raise exception 'TEAM_HAS_RESULTS'; end if;

  delete from teams t using events e
   where t.id = p_team_id and e.id = t.event_id and e.competition_id = c;
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_set_court_pin(p_token text, p_court_id uuid, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN_MUST_BE_4_DIGITS'; end if;
  update courts set scorer_pin = p_pin where id = p_court_id and competition_id = c;
  if not found then raise exception 'NO_COURT'; end if;
  delete from court_sessions where court_id = p_court_id;   -- force a re-unlock
  return jsonb_build_object('ok', true);
end $$;

-- replace the fixture list; refuses once anything has been played
create or replace function admin_replace_schedule(
  p_token text, p_event_id uuid, p_matches jsonb, p_team_ids uuid[], p_court_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; r jsonb; n int := 0; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events where id = p_event_id and competition_id = c) then
    raise exception 'NO_EVENT';
  end if;
  if exists (select 1 from matches
              where event_id = p_event_id and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;

  delete from matches where event_id = p_event_id;

  for r in select * from jsonb_array_elements(p_matches) loop
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status)
    values (p_event_id,
            p_court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            p_team_ids[(r->>'a')::int + 1],
            p_team_ids[(r->>'b')::int + 1],
            'scheduled');
    n := n + 1;
  end loop;

  update matches m set status = 'live'
   where m.event_id = p_event_id
     and m.id in (select distinct on (court_id) id from matches
                   where event_id = p_event_id order by court_id, sequence);

  return jsonb_build_object('created', n);
end $$;

-- admin reads its own secrets (pins) — never exposed to spectators
create or replace function admin_bundle(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  return jsonb_build_object(
    'competition', (select to_jsonb(x) from competitions x where x.id = c),
    'courts', (select coalesce(jsonb_agg(to_jsonb(x) order by x.number), '[]'::jsonb)
                 from courts x where x.competition_id = c)
  );
end $$;

grant execute on function create_competition(jsonb)                                  to anon, authenticated;
grant execute on function admin_login(text, text)                                    to anon, authenticated;
grant execute on function admin_bundle(text)                                         to anon, authenticated;
grant execute on function admin_update_competition(text, text, text)                 to anon, authenticated;
grant execute on function admin_update_event(text, uuid, text, int, int, int, int)   to anon, authenticated;
grant execute on function admin_upsert_team(text, uuid, uuid, text, text, text, text) to anon, authenticated;
grant execute on function admin_delete_team(text, uuid)                              to anon, authenticated;
grant execute on function admin_set_court_pin(text, uuid, text)                      to anon, authenticated;
grant execute on function admin_replace_schedule(text, uuid, jsonb, uuid[], uuid[])  to anon, authenticated;
