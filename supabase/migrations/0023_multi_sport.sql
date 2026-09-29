-- =====================================================================
-- PicklePoint migration 0023: multi-sport competitions (opt-in)
--
-- Everything here is ADDITIVE and OPT-IN. Every new column has a default
-- that reproduces today's behaviour, and every new RPC refuses to run
-- unless the competition has multi_sport = true. Existing competitions
-- never get that flag, so their scoring, scheduling, standings and boards
-- are untouched. The scoring RPCs (score_point / undo_point / reset_match
-- / confirm_match) are NOT modified: each game in a tie is an ordinary
-- match row scored by the existing engine.
--
-- Model:
--   competitions.multi_sport  opt-in flag (set by hand for one code)
--   events.sport              'pickleball' | 'badminton' (one event per sport)
--   courts.sport              which sport a court is used for
--   teams.roster              6 = MD+MD+XD tie, 4 = MD+XD tie
--   matches.tie_id/game_label a "tie" = several games (MD1, MD2, XD) between
--                             the same two teams; each game is its own match
--
-- After running this, enable it for ONE competition only:
--   update competitions set multi_sport = true where code = 'YC2626';
-- =====================================================================

alter table competitions add column if not exists multi_sport boolean not null default false;
alter table events       add column if not exists sport text not null default 'pickleball';
alter table courts       add column if not exists sport text not null default 'pickleball';
alter table teams        add column if not exists roster int;
alter table matches      add column if not exists tie_id uuid;
alter table matches      add column if not exists game_label text;

do $$ begin
  alter table events add constraint events_sport_check check (sport in ('pickleball','badminton'));
exception when duplicate_object then null; end $$;
do $$ begin
  alter table courts add constraint courts_sport_check check (sport in ('pickleball','badminton'));
exception when duplicate_object then null; end $$;

create index if not exists matches_tie_idx on matches (tie_id) where tie_id is not null;

-- ------------------------------------------------------ join_competition
-- same payload as before plus two extra keys (multi_sport, court sport).
create or replace function join_competition(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c competitions; begin
  select * into c from competitions where upper(code) = upper(trim(p_code));
  if not found then raise exception 'INVALID_CODE'; end if;
  return jsonb_build_object(
    'competition', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name,
                                      'venue', c.venue, 'event_date', c.event_date,
                                      'status', c.status, 'multi_sport', c.multi_sport),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order, e.name)
                          from events e where e.competition_id = c.id), '[]'::jsonb),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'number', ct.number,
                                                            'label', ct.label, 'sport', ct.sport)
                                         order by ct.number)
                          from courts ct where ct.competition_id = c.id), '[]'::jsonb)
  );
end $$;
grant execute on function join_competition(text) to anon, authenticated;

-- --------------------------------------------------- admin_add_sport_event
-- Adds a second (third...) sport to a multi_sport competition: the event,
-- its own courts (numbered after the existing ones) and its teams.
--   p_courts: [{ "label": "Badminton 1", "scorer_pin": "1234" }, ...]
--   p_teams:  [{ "name": "...", "pool": "A", "roster": 6 }, ...]
create or replace function admin_add_sport_event(
  p_token text, p_name text, p_sport text,
  p_target int, p_win_by int, p_cap int, p_switch_at int, p_serve_mode text,
  p_courts jsonb, p_teams jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; v_ev events; r jsonb; v_next int; v_id uuid; v_sort int;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  if p_sport not in ('pickleball','badminton') then raise exception 'BAD_SPORT'; end if;
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

-- ------------------------------------------------------ admin_set_team_roster
create or replace function admin_set_team_roster(p_token text, p_team_id uuid, p_roster int)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  if p_roster not in (4, 6) then raise exception 'BAD_ROSTER'; end if;
  update teams set roster = p_roster
   where id = p_team_id
     and event_id in (select id from events where competition_id = c);
end $$;
grant execute on function admin_set_team_roster(text, uuid, int) to anon, authenticated;

-- ---------------------------------------------- admin_replace_tie_schedule
-- Like admin_replace_schedule, but each fixture carries a tie key and a game
-- label, and games are only placed on courts of the event's own sport.
--   p_matches: [{ a, b, court, sequence, round, tie, game }, ...]
create or replace function admin_replace_tie_schedule(
  p_token text, p_event_id uuid, p_matches jsonb, p_team_ids uuid[], p_court_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; r jsonb; n int := 0; v_sport text;
  v_ties jsonb := '{}'::jsonb; v_key text; v_tie uuid;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if exists (select 1 from matches
              where event_id = p_event_id and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;
  if exists (select 1 from unnest(p_court_ids) x(id)
              where not exists (select 1 from courts where id = x.id and competition_id = c
                                   and sport = v_sport)) then
    raise exception 'WRONG_SPORT_COURT';
  end if;

  delete from matches where event_id = p_event_id;

  for r in select * from jsonb_array_elements(p_matches) loop
    v_key := coalesce(r->>'tie', r->>'sequence');
    if v_ties ? v_key then
      v_tie := (v_ties->>v_key)::uuid;
    else
      v_tie := gen_random_uuid();
      v_ties := v_ties || jsonb_build_object(v_key, v_tie);
    end if;
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status,
                         tie_id, game_label)
    values (p_event_id,
            p_court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            p_team_ids[(r->>'a')::int + 1],
            p_team_ids[(r->>'b')::int + 1],
            'scheduled', v_tie, nullif(r->>'game',''));
    n := n + 1;
  end loop;

  update matches m set status = 'live'
   where m.event_id = p_event_id
     and m.id in (select distinct on (court_id) id from matches
                   where event_id = p_event_id and court_id is not null
                   order by court_id, sequence);

  return jsonb_build_object('created', n);
end $$;
grant execute on function admin_replace_tie_schedule(text, uuid, jsonb, uuid[], uuid[])
  to anon, authenticated;
