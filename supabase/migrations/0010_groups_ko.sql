-- =====================================================================
-- PicklePoint migration 0010: groups_ko format
--   Random draw into small groups -> round robin -> single-elimination
--   bracket -> third-place playoff + final. FIFA-shaped.
--
-- ADDITIVE ONLY. This migration deliberately does NOT touch any existing
-- RPC. create_competition, confirm_match, score_point and every admin_*
-- function are left byte-identical, so a live duel competition (MCMC26)
-- keeps executing exactly the code it executes today. The one existing
-- object altered is the events.format check constraint, which is widened
-- to allow a new value — every existing row already satisfies it.
-- =====================================================================

-- ------------------------------------------------------------ 1. schema
alter table events add column if not exists group_size        int;
alter table events add column if not exists advance_per_group int;
alter table events add column if not exists third_place       boolean not null default true;
alter table events add column if not exists bracket_seeded_at timestamptz;

-- bracket_key identifies a knockout slot ('KO-8-0', 'KO-3P'). It is NULL for
-- every round_robin, duel and group-stage match, and every guard below keys
-- off that, so nothing here can reach an existing competition's rows.
alter table matches add column if not exists bracket_key     text;
alter table matches add column if not exists loser_match_id  uuid references matches(id) on delete set null;
alter table matches add column if not exists loser_slot      text;

do $$ begin
  alter table matches add constraint matches_loser_slot_check check (loser_slot in ('a','b'));
exception when duplicate_object then null; end $$;

create index if not exists matches_bracket_key_idx on matches (event_id, bracket_key);

alter table events drop constraint if exists events_format_check;
alter table events add constraint events_format_check
  check (format in ('round_robin','knockout','rr_then_ko','duel','groups_ko'));

-- --------------------------------------------- 2. bracket flow trigger
-- Knockout brackets need two things the existing engine cannot do:
--   a) push the LOSER somewhere (confirm_match only propagates winners),
--      which is how a third-place playoff gets its two teams;
--   b) put a knockout match on a court only once both its teams are known.
-- Both are done here rather than by editing confirm_match. Empty bracket
-- matches are created with court_id NULL precisely so that confirm_match's
-- "promote the next scheduled match on this court" queue can never pick up
-- a match with no teams in it.
create or replace function _ko_match_flow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loser uuid; v_court uuid; v_busy int; begin
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

  -- (b) both teams now known and still unplaced: give it the quietest court,
  -- and start it if that court has nothing live.
  if new.status = 'scheduled' and new.court_id is null
     and new.team_a_id is not null and new.team_b_id is not null then
    select c.id into v_court
      from courts c
      join events e on e.id = new.event_id
     where c.competition_id = e.competition_id
     order by (select count(*) from matches m
                where m.court_id = c.id and m.status in ('scheduled','on_deck','live')),
              c.number
     limit 1;
    if v_court is not null then
      select count(*) into v_busy from matches
       where court_id = v_court and status in ('live','awaiting_confirm');
      update matches
         set court_id = v_court,
             status = case when v_busy = 0 then 'live' else 'scheduled' end
       where id = new.id;
    end if;
  end if;

  return null;
end $$;

drop trigger if exists ko_match_flow on matches;
create trigger ko_match_flow after update on matches
  for each row when (new.bracket_key is not null)
  execute function _ko_match_flow();

-- ------------------------------------------- 3. create_competition_v3
-- Same shape as create_competition, plus a `bracket` array of empty knockout
-- slots that are wired to each other by key in a second pass. Left as a NEW
-- function so the existing creation path is untouched.
create or replace function create_competition_v3(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c competitions; e events; v_ev jsonb := p_payload->'event';
  court_ids uuid[]; team_ids uuid[];
  r jsonb; v_id uuid; v_tok text;
  ko_keys text[] := '{}'; ko_ids uuid[] := '{}'; v_pos int;
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

-- ------------------------------------------------ 4. admin_seed_bracket
-- The organizer reviews the group tables, then locks them. The client sends
-- the resolved round-one pairings (it already computes standings with the
-- wins -> head-to-head -> point-difference -> points-for chain), and this
-- validates and writes them. A pairing with only one team is a bye: it is
-- finished immediately and its winner walks into the next round.
create or replace function admin_seed_bracket(
  p_token text, p_event_id uuid, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; e events; r jsonb; m matches;
  v_a uuid; v_b uuid; v_filled int := 0; v_byes int := 0;
begin
  c := _require_admin(p_token);
  select * into e from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if e.format <> 'groups_ko' then raise exception 'NOT_GROUPS_KO'; end if;
  if e.bracket_seeded_at is not null then raise exception 'ALREADY_SEEDED'; end if;

  if exists (select 1 from matches
              where event_id = p_event_id and bracket_key is null
                and status <> 'finished') then
    raise exception 'GROUP_STAGE_UNFINISHED';
  end if;

  for r in select * from jsonb_array_elements(p_pairs) loop
    v_a := nullif(r->>'a','')::uuid;
    v_b := nullif(r->>'b','')::uuid;
    if v_a is null and v_b is null then continue; end if;
    if v_a is not null and not exists
       (select 1 from teams where id = v_a and event_id = p_event_id) then
      raise exception 'BAD_TEAM';
    end if;
    if v_b is not null and not exists
       (select 1 from teams where id = v_b and event_id = p_event_id) then
      raise exception 'BAD_TEAM';
    end if;

    select * into m from matches
     where event_id = p_event_id and bracket_key = (r->>'key') for update;
    if not found then raise exception 'NO_BRACKET_SLOT'; end if;
    if m.status = 'finished' then raise exception 'SLOT_ALREADY_PLAYED'; end if;

    if v_a is null or v_b is null then
      -- bye: nobody plays, the present team advances. The ko_match_flow
      -- trigger picks the winner up and carries it into the next round.
      update matches set
        team_a_id = coalesce(v_a, v_b), team_b_id = null,
        status = 'finished', winner_id = coalesce(v_a, v_b), finished_at = now()
      where id = m.id;
      v_byes := v_byes + 1;
    else
      update matches set team_a_id = v_a, team_b_id = v_b where id = m.id;
      v_filled := v_filled + 1;
    end if;
  end loop;

  update events set bracket_seeded_at = now() where id = p_event_id;

  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'seed_bracket',
          jsonb_build_object('event_id', p_event_id, 'matches', v_filled, 'byes', v_byes));

  return jsonb_build_object('ok', true, 'matches', v_filled, 'byes', v_byes);
end $$;

-- ------------------------------------------------ 5. admin_unseed_bracket
-- Escape hatch: clears the bracket back to empty so a mis-scored group match
-- can be corrected and the draw redone. Refuses once a knockout match has
-- actually been played, which is the point of no return.
create or replace function admin_unseed_bracket(p_token text, p_event_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events
                  where id = p_event_id and competition_id = c and format = 'groups_ko') then
    raise exception 'NO_EVENT';
  end if;
  if exists (select 1 from matches
              where event_id = p_event_id and bracket_key is not null
                and (score_a > 0 or score_b > 0)) then
    raise exception 'BRACKET_IN_PLAY';
  end if;

  update matches set
    team_a_id = null, team_b_id = null, court_id = null, winner_id = null,
    score_a = 0, score_b = 0, status = 'scheduled', finished_at = null,
    started_at = null, duration_seconds = null
  where event_id = p_event_id and bracket_key is not null;

  update events set bracket_seeded_at = null where id = p_event_id;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'unseed_bracket', jsonb_build_object('event_id', p_event_id));
  return jsonb_build_object('ok', true);
end $$;

grant execute on function create_competition_v3(jsonb)                to anon, authenticated;
grant execute on function admin_seed_bracket(text, uuid, jsonb)       to anon, authenticated;
grant execute on function admin_unseed_bracket(text, uuid)            to anon, authenticated;
