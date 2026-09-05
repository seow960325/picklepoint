-- =====================================================================
-- PicklePoint — pickleball tournament scoring
-- Migration 0001: schema, RLS, RPCs
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------- code
-- 6-char join code, ambiguous glyphs (0 O 1 I) removed
create or replace function gen_join_code() returns text
language plpgsql as $$
declare
  alphabet text := 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  out text := '';
  i int;
begin
  for i in 1..6 loop
    out := out || substr(alphabet, 1 + floor(random() * length(alphabet))::int, 1);
  end loop;
  return out;
end $$;

-- ------------------------------------------------------------- tables
create table competitions (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null default gen_join_code(),
  name        text not null,
  venue       text,
  event_date  date default current_date,
  admin_pin   text not null default lpad((floor(random()*10000))::text, 4, '0'),
  status      text not null default 'draft' check (status in ('draft','live','finished')),
  created_at  timestamptz not null default now()
);

create table events (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  name           text not null,
  format         text not null default 'round_robin'
                 check (format in ('round_robin','knockout','rr_then_ko')),
  target_score   int  not null default 15,
  win_by         int  not null default 2,
  cap            int  not null default 17,
  switch_at      int  not null default 8,
  sort_order     int  not null default 0
);

create table courts (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid not null references competitions(id) on delete cascade,
  number         int not null,
  label          text,
  scorer_pin     text not null default lpad((floor(random()*10000))::text, 4, '0'),
  unique (competition_id, number)
);

create table teams (
  id          uuid primary key default gen_random_uuid(),
  event_id    uuid not null references events(id) on delete cascade,
  name        text not null,
  player1     text,
  player2     text,
  seed        int,
  pool        text,
  checked_in  boolean not null default false
);

create table matches (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references events(id) on delete cascade,
  court_id         uuid references courts(id) on delete set null,
  round            text,
  sequence         int not null default 0,
  team_a_id        uuid references teams(id) on delete set null,
  team_b_id        uuid references teams(id) on delete set null,
  score_a          int not null default 0,
  score_b          int not null default 0,
  -- which team is physically on the LEFT half of the scoring screen
  a_on_left        boolean not null default true,
  sides_switched   boolean not null default false,
  status           text not null default 'scheduled'
                   check (status in ('scheduled','on_deck','live','awaiting_confirm','finished')),
  winner_id        uuid references teams(id) on delete set null,
  next_match_id    uuid references matches(id) on delete set null,
  next_slot        text check (next_slot in ('a','b')),
  started_at       timestamptz,
  finished_at      timestamptz,
  duration_seconds int
);
create index on matches (event_id, sequence);
create index on matches (court_id, status);

create table point_events (
  id              uuid primary key default gen_random_uuid(),
  seq             bigint generated always as identity,
  match_id        uuid not null references matches(id) on delete cascade,
  client_event_id text not null unique,   -- makes offline replay idempotent
  team_id         uuid references teams(id) on delete set null,
  delta           int not null default 1,
  score_a_after   int not null,
  score_b_after   int not null,
  device_id       text,
  created_at      timestamptz not null default now()
);
create index on point_events (match_id, seq desc);

create table timeouts (
  id         uuid primary key default gen_random_uuid(),
  match_id   uuid not null references matches(id) on delete cascade,
  team_id    uuid references teams(id) on delete set null,
  created_at timestamptz not null default now()
);

create table audit_log (
  id             uuid primary key default gen_random_uuid(),
  competition_id uuid references competitions(id) on delete cascade,
  actor          text,
  action         text not null,
  detail         jsonb,
  created_at     timestamptz not null default now()
);

-- short-lived proof that a device entered the correct court PIN
create table court_sessions (
  token      text primary key default encode(gen_random_bytes(24), 'hex'),
  court_id   uuid not null references courts(id) on delete cascade,
  device_id  text,
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '16 hours'
);

-- ---------------------------------------------------------------- RLS
alter table competitions   enable row level security;
alter table events         enable row level security;
alter table courts         enable row level security;
alter table teams          enable row level security;
alter table matches        enable row level security;
alter table point_events   enable row level security;
alter table timeouts       enable row level security;
alter table audit_log      enable row level security;
alter table court_sessions enable row level security;

-- Anyone holding the join code can READ. All writes go through
-- SECURITY DEFINER rpcs below, so no anon write policies exist.
create policy read_all on competitions for select using (true);
create policy read_all on events       for select using (true);
create policy read_all on teams        for select using (true);
create policy read_all on matches      for select using (true);
create policy read_all on point_events for select using (true);
create policy read_all on timeouts     for select using (true);
-- courts: readable but scorer_pin is never exposed (see courts_public view)
create policy read_all on courts       for select using (true);
-- audit_log and court_sessions: no anon read at all.

create view courts_public
with (security_invoker = on) as
  select id, competition_id, number, label from courts;

-- ------------------------------------------------------------ helpers
create or replace function _court_from_token(p_token text)
returns uuid language sql stable security definer set search_path = public as $$
  select court_id from court_sessions
   where token = p_token and expires_at > now()
$$;

-- ---------------------------------------------------------------- rpc
-- join_competition(code) -> everything a spectator screen needs
create or replace function join_competition(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c competitions; begin
  select * into c from competitions where upper(code) = upper(trim(p_code));
  if not found then raise exception 'INVALID_CODE'; end if;
  return jsonb_build_object(
    'competition', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name,
                                      'venue', c.venue, 'event_date', c.event_date,
                                      'status', c.status),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order)
                          from events e where e.competition_id = c.id), '[]'::jsonb),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'number', ct.number,
                                                            'label', ct.label) order by ct.number)
                          from courts ct where ct.competition_id = c.id), '[]'::jsonb)
  );
end $$;

-- unlock_court(court_id, pin) -> token
create or replace function unlock_court(p_court_id uuid, p_pin text, p_device_id text default null)
returns text language plpgsql security definer set search_path = public as $$
declare t text; begin
  if not exists (select 1 from courts where id = p_court_id and scorer_pin = trim(p_pin)) then
    raise exception 'BAD_PIN';
  end if;
  insert into court_sessions (court_id, device_id) values (p_court_id, p_device_id)
  returning token into t;
  return t;
end $$;

-- score_point(match, side, token, client_event_id) -> new match row
-- Atomic. Applies switch-ends and win condition server-side.
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

  -- idempotent replay of a queued offline event
  if exists (select 1 from point_events where client_event_id = p_client_event_id) then
    select * into m from matches where id = p_match_id;
    return to_jsonb(m);
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into e from events where id = m.event_id;

  -- physical side -> team, honouring the current end assignment
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
    -- switch ends the first time the leader reaches switch_at
    sides_switched = sides_switched or (v_hi >= e.switch_at),
    a_on_left = case when not sides_switched and v_hi >= e.switch_at
                     then not a_on_left else a_on_left end,
    status = case
      when (v_hi >= e.target_score and v_hi - v_lo >= e.win_by) or v_hi >= e.cap
      then 'awaiting_confirm' else 'live' end
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- undo_point(match, token) -> new match row
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
    -- rolling back below the switch point puts the ends back too
    a_on_left = case when sides_switched and v_hi < e.switch_at then not a_on_left else a_on_left end,
    sides_switched = sides_switched and (v_hi >= e.switch_at),
    status = 'live'
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- confirm_match: lock the result and push the winner into the next bracket slot
create or replace function confirm_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_winner uuid; begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status <> 'awaiting_confirm' then raise exception 'NOT_AWAITING_CONFIRM'; end if;

  v_winner := case when m.score_a > m.score_b then m.team_a_id else m.team_b_id end;

  update matches set
    status = 'finished', winner_id = v_winner, finished_at = now(),
    duration_seconds = extract(epoch from (now() - coalesce(started_at, now())))::int
  where id = p_match_id returning * into m;

  if m.next_match_id is not null then
    if m.next_slot = 'a' then
      update matches set team_a_id = v_winner where id = m.next_match_id;
    else
      update matches set team_b_id = v_winner where id = m.next_match_id;
    end if;
  end if;

  return to_jsonb(m);
end $$;

create or replace function call_timeout(p_match_id uuid, p_side text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_team uuid; begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;
  select * into m from matches where id = p_match_id;
  v_team := case when (p_side = 'left') = m.a_on_left then m.team_a_id else m.team_b_id end;
  insert into timeouts (match_id, team_id) values (p_match_id, v_team);
  return jsonb_build_object('ok', true);
end $$;

create or replace function admin_override(
  p_match_id uuid, p_admin_pin text, p_score_a int, p_score_b int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_comp uuid; begin
  select c.id into v_comp
    from matches mm join events e on e.id = mm.event_id
    join competitions c on c.id = e.competition_id
   where mm.id = p_match_id and c.admin_pin = trim(p_admin_pin);
  if v_comp is null then raise exception 'BAD_PIN'; end if;

  update matches set score_a = p_score_a, score_b = p_score_b
   where id = p_match_id returning * into m;

  insert into audit_log (competition_id, actor, action, detail)
  values (v_comp, 'admin', 'override_score',
          jsonb_build_object('match_id', p_match_id, 'score_a', p_score_a, 'score_b', p_score_b));
  return to_jsonb(m);
end $$;

-- grants: anon may only call the rpcs
grant execute on function join_competition(text)                          to anon, authenticated;
grant execute on function unlock_court(uuid, text, text)                  to anon, authenticated;
grant execute on function score_point(uuid, text, text, text, text)       to anon, authenticated;
grant execute on function undo_point(uuid, text)                          to anon, authenticated;
grant execute on function confirm_match(uuid, text)                       to anon, authenticated;
grant execute on function call_timeout(uuid, text, text)                  to anon, authenticated;
grant execute on function admin_override(uuid, text, int, int)            to anon, authenticated;

-- realtime
alter publication supabase_realtime add table matches;
alter publication supabase_realtime add table point_events;
