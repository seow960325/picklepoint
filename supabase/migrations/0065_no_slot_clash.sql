-- =====================================================================
-- PicklePoint 0065: no more double-booked time slots (13 Nov 2026)
--
-- Cause: "Play a different game" (referee, court_pick_match) and "Move up"
-- (admin, admin_move_up) swap the printed slot of two games. They never
-- checked whether a team of the moved game already had another game in that
-- slot on another court, and "Reset" never put the slots back. Every test run
-- left more games in the wrong slot (e.g. one team twice at 10:00 on Courts
-- 5 and 6, or twice at 12:15).
--
-- This update:
--  1. rebuilds the printed timetable of MCMD, MCXD, BMMD, BMXD, PBMD, PBXD
--     (slot, play order, home court of every group game). Which team sits in
--     which group place (the clash-free draw) is kept as it is.
--  2. remembers that plan on every group game (plan_slot / plan_seq /
--     plan_court); Reset now puts every game back to its printed slot.
--  3. "Play a different game" and "Move up" refuse a swap that would put a
--     team in two games of the same slot (error SLOT_CLASH).
-- Scores are not touched. Safe to run more than once. It stops with an
-- error and changes nothing if a category's games don't match the plan.
-- =====================================================================
begin;

alter table matches add column if not exists plan_slot  int;
alter table matches add column if not exists plan_seq   int;
alter table matches add column if not exists plan_court uuid;

drop table if exists pp;
create table pp (code text, pool text, pa int, pb int, slot int, court int, seq int);
alter table pp enable row level security;
insert into pp values
  ('MCMD','A',1,2,1,1,1),
  ('MCMD','B',1,2,1,2,2),
  ('MCMD','C',1,2,1,3,3),
  ('MCMD','D',1,2,2,1,4),
  ('MCMD','E',1,2,2,2,5),
  ('MCMD','A',1,3,3,1,6),
  ('MCMD','B',1,3,3,2,7),
  ('MCMD','C',1,3,3,3,8),
  ('MCMD','D',1,3,4,1,9),
  ('MCMD','E',1,3,4,2,10),
  ('MCMD','A',2,3,5,1,11),
  ('MCMD','B',2,3,5,2,12),
  ('MCMD','C',2,3,5,3,13),
  ('MCMD','D',2,3,6,1,14),
  ('MCMD','E',2,3,6,2,15),
  ('MCMD','A',2,1,7,1,16),
  ('MCMD','B',2,1,7,2,17),
  ('MCMD','C',2,1,7,3,18),
  ('MCMD','D',2,1,8,1,19),
  ('MCMD','E',2,1,8,2,20),
  ('MCMD','A',3,1,9,1,21),
  ('MCMD','B',3,1,9,2,22),
  ('MCMD','C',3,1,9,3,23),
  ('MCMD','D',3,1,10,1,24),
  ('MCMD','E',3,1,10,2,25),
  ('MCMD','A',3,2,11,1,26),
  ('MCMD','B',3,2,11,2,27),
  ('MCMD','C',3,2,11,3,28),
  ('MCMD','D',3,2,12,1,29),
  ('MCMD','E',3,2,12,2,30),
  ('MCXD','B',1,2,1,4,1),
  ('MCXD','D',1,3,1,5,2),
  ('MCXD','E',2,3,1,6,3),
  ('MCXD','A',2,4,2,4,4),
  ('MCXD','C',1,3,2,5,5),
  ('MCXD','D',2,4,2,6,6),
  ('MCXD','B',1,3,3,4,7),
  ('MCXD','E',1,4,3,5,8),
  ('MCXD','F',2,4,3,6,9),
  ('MCXD','A',1,4,4,4,10),
  ('MCXD','C',2,3,4,5,11),
  ('MCXD','D',2,3,4,6,12),
  ('MCXD','B',3,4,5,4,13),
  ('MCXD','E',3,4,5,5,14),
  ('MCXD','F',2,3,5,6,15),
  ('MCXD','A',1,2,6,4,16),
  ('MCXD','D',1,2,6,5,17),
  ('MCXD','E',1,2,6,6,18),
  ('MCXD','A',3,4,7,4,19),
  ('MCXD','C',2,4,7,5,20),
  ('MCXD','F',1,4,7,6,21),
  ('MCXD','B',2,3,8,4,22),
  ('MCXD','D',1,4,8,5,23),
  ('MCXD','E',2,4,8,6,24),
  ('MCXD','A',2,3,9,4,25),
  ('MCXD','B',1,4,9,5,26),
  ('MCXD','C',1,4,9,6,27),
  ('MCXD','E',1,3,10,4,28),
  ('MCXD','F',1,2,10,5,29),
  ('MCXD','F',3,4,10,6,30),
  ('MCXD','A',1,3,11,4,31),
  ('MCXD','B',2,4,11,5,32),
  ('MCXD','D',3,4,11,6,33),
  ('MCXD','C',1,2,12,4,34),
  ('MCXD','C',3,4,12,5,35),
  ('MCXD','F',1,3,12,6,36),
  ('BMMD','A',1,2,1,2,1),
  ('BMMD','A',3,4,1,3,2),
  ('BMMD','B',1,2,1,4,3),
  ('BMMD','B',3,4,1,5,4),
  ('BMMD','A',2,3,2,2,5),
  ('BMMD','B',1,4,2,3,6),
  ('BMMD','C',2,3,2,4,7),
  ('BMMD','D',2,3,2,5,8),
  ('BMMD','A',1,4,3,2,9),
  ('BMMD','B',1,3,3,3,10),
  ('BMMD','B',2,4,3,4,11),
  ('BMMD','D',1,3,3,5,12),
  ('BMMD','A',1,3,4,2,13),
  ('BMMD','A',2,4,4,3,14),
  ('BMMD','C',2,3,4,4,15),
  ('BMMD','D',2,3,4,5,16),
  ('BMMD','B',1,4,5,2,17),
  ('BMMD','B',2,3,5,3,18),
  ('BMMD','C',1,3,5,4,19),
  ('BMMD','D',1,3,5,5,20),
  ('BMMD','A',1,2,6,2,21),
  ('BMMD','A',3,4,6,3,22),
  ('BMMD','C',1,2,6,4,23),
  ('BMMD','D',1,2,6,5,24),
  ('BMMD','A',2,3,7,2,25),
  ('BMMD','B',1,2,7,3,26),
  ('BMMD','B',3,4,7,4,27),
  ('BMMD','C',1,3,7,5,28),
  ('BMMD','A',1,4,8,2,29),
  ('BMMD','B',2,3,8,3,30),
  ('BMMD','C',1,2,8,4,31),
  ('BMMD','D',1,2,8,5,32),
  ('BMMD','A',2,4,9,2,33),
  ('BMMD','A',1,3,9,3,34),
  ('BMMD','B',2,4,9,4,35),
  ('BMMD','B',1,3,9,5,36),
  ('BMXD','A',1,2,1,6,1),
  ('BMXD','B',1,2,1,7,2),
  ('BMXD','A',1,3,2,6,3),
  ('BMXD','B',1,3,2,7,4),
  ('BMXD','A',2,3,4,6,5),
  ('BMXD','B',2,3,4,7,6),
  ('BMXD','A',1,3,5,6,7),
  ('BMXD','B',1,3,5,7,8),
  ('BMXD','A',1,2,7,6,9),
  ('BMXD','B',1,2,7,7,10),
  ('BMXD','A',2,3,8,6,11),
  ('BMXD','B',2,3,8,7,12),
  ('PBMD','A',1,2,1,2,1),
  ('PBMD','B',1,2,1,3,2),
  ('PBMD','A',3,4,2,2,3),
  ('PBMD','B',3,4,2,3,4),
  ('PBMD','A',1,3,3,2,5),
  ('PBMD','B',1,3,3,3,6),
  ('PBMD','A',2,4,4,2,7),
  ('PBMD','B',2,4,4,3,8),
  ('PBMD','A',1,4,5,2,9),
  ('PBMD','B',1,4,5,3,10),
  ('PBMD','A',2,3,6,2,11),
  ('PBMD','B',2,3,6,3,12),
  ('PBMD','A',1,4,7,2,13),
  ('PBMD','B',1,4,7,3,14),
  ('PBMD','A',2,3,8,2,15),
  ('PBMD','B',2,3,8,3,16),
  ('PBMD','A',1,2,9,2,17),
  ('PBMD','B',1,2,9,3,18),
  ('PBMD','A',3,4,10,2,19),
  ('PBMD','B',3,4,10,3,20),
  ('PBMD','A',2,4,11,2,21),
  ('PBMD','B',2,4,11,3,22),
  ('PBMD','A',1,3,12,2,23),
  ('PBMD','B',1,3,12,3,24),
  ('PBXD','A',1,2,1,1,1),
  ('PBXD','A',3,4,2,1,2),
  ('PBXD','A',1,3,3,1,3),
  ('PBXD','A',2,4,4,1,4),
  ('PBXD','A',1,4,5,1,5),
  ('PBXD','A',2,3,6,1,6),
  ('PBXD','A',1,4,7,1,7),
  ('PBXD','A',2,3,8,1,8),
  ('PBXD','A',1,2,9,1,9),
  ('PBXD','A',3,4,10,1,10),
  ('PBXD','A',2,4,11,1,11),
  ('PBXD','A',1,3,12,1,12);

drop table if exists fix_report;
create table fix_report (code text, games int, moved int, groups int, unsure_groups text);
alter table fix_report enable row level security;

do $m$
declare ev record; r record; v_moved int; v_votes int; v_amb text[]; v_plan int; v_games int; v_tgt int;
begin
  for ev in select e.id, c.code from events e join competitions c on c.id = e.competition_id
             where c.code in (select distinct code from pp) and e.format = 'groups_ko' loop

    -- 1. which team sits in which group place: of every possible order of the
    --    group's teams, take the one where the printed fixtures exist (home /
    --    away as printed) and most games are still in their printed position
    create temp table asg (team uuid, pool text, place int) on commit drop;
    v_votes := 0; v_amb := '{}';
    for r in select pool, array_agg(id order by id) ids from teams where event_id = ev.id group by pool loop
      create temp table sc on commit drop as
      with recursive perm(arr) as (
        select array[]::uuid[]
        union all
        select arr || t from perm, unnest(r.ids) t
         where not t = any(arr) and cardinality(arr) < cardinality(r.ids)
      )
      select arr,
             (select count(*) from pp p where p.code = ev.code and p.pool = r.pool and exists (
                select 1 from matches m where m.event_id = ev.id and m.bracket_key is null
                   and m.team_a_id = arr[p.pa] and m.team_b_id = arr[p.pb])) * 1000
           + (select count(*) from pp p where p.code = ev.code and p.pool = r.pool and exists (
                select 1 from matches m join courts k on k.id = m.home_court
                 where m.event_id = ev.id and m.bracket_key is null
                   and m.team_a_id = arr[p.pa] and m.team_b_id = arr[p.pb]
                   and m.slot = p.slot and k.number = p.court)) as score
        from perm where cardinality(arr) = cardinality(r.ids);
      insert into asg
      select u.team, r.pool, u.place::int
        from (select arr from sc order by score desc, arr limit 1) b, unnest(b.arr) with ordinality u(team, place);
      if (select count(*) from sc where score = (select max(score) from sc)) > 1 then
        v_amb := v_amb || r.pool;
      end if;
      drop table sc;
      v_votes := v_votes + 1;
    end loop;

    -- 2. the printed position of every game (a pair met twice in the same
    --    order: earlier game -> earlier printed slot)
    create temp table tgt on commit drop as
    select m.id, x.slot, x.seq, k.id court_id from
      (select p.*, a.team ta, b.team tb,
              row_number() over (partition by p.pool, p.pa, p.pb order by p.slot, p.seq) rn
         from pp p join asg a on a.pool = p.pool and a.place = p.pa
                   join asg b on b.pool = p.pool and b.place = p.pb
        where p.code = ev.code) x
      join (select m.*, row_number() over (partition by m.team_a_id, m.team_b_id order by m.slot nulls last, m.sequence, m.id) rn
              from matches m where m.event_id = ev.id and m.bracket_key is null) m
        on m.team_a_id = x.ta and m.team_b_id = x.tb and m.rn = x.rn
      join courts k on k.number = x.court
                   and k.competition_id = (select competition_id from events where id = ev.id);

    select count(*) into v_plan from pp where code = ev.code;
    select count(*) into v_games from matches where event_id = ev.id and bracket_key is null;
    select count(distinct id) into v_tgt from tgt;
    if v_plan <> v_games or v_tgt <> v_plan or (select count(*) from tgt) <> v_plan then
      raise exception 'PLAN_MISMATCH in %: % printed games, % games in the app, % matched', ev.code, v_plan, v_games, v_tgt;
    end if;

    update matches m set slot = t.slot, sequence = t.seq, home_court = t.court_id
      from tgt t where m.id = t.id
       and (m.slot, m.sequence, m.home_court) is distinct from (t.slot, t.seq, t.court_id);
    get diagnostics v_moved = row_count;
    update matches m set plan_slot = t.slot, plan_seq = t.seq, plan_court = t.court_id
      from tgt t where m.id = t.id;

    -- unstarted games already called to a court: call the right ones
    if v_moved > 0 then
      update matches set court_id = null, status = 'scheduled', started_at = null
       where event_id = ev.id and bracket_key is null and status = 'live'
         and score_a = 0 and score_b = 0
         and not exists (select 1 from point_events pe where pe.match_id = matches.id);
      perform _pool_dispatch(ev.id);
    end if;

    if exists (select 1 from matches x join matches y on x.event_id = y.event_id and x.id < y.id and x.slot = y.slot
                where x.event_id = ev.id and x.bracket_key is null and y.bracket_key is null
                  and (x.team_a_id in (y.team_a_id, y.team_b_id) or x.team_b_id in (y.team_a_id, y.team_b_id))) then
      raise exception 'STILL_CLASHING in %', ev.code;
    end if;

    insert into fix_report values (ev.code, v_games, v_moved, v_votes, nullif(array_to_string(v_amb, ','), ''));
    drop table asg; drop table tgt;
  end loop;
end $m$;

-- a team would be in two games of one slot if pick took ref's slot (or ref pick's)
create or replace function _slot_clash(pick matches, ref matches) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from matches x
     where x.event_id = pick.event_id and x.bracket_key is null
       and x.id not in (pick.id, ref.id) and x.status <> 'finished'
       and ((x.slot = ref.slot and (x.team_a_id in (pick.team_a_id, pick.team_b_id)
                                    or x.team_b_id in (pick.team_a_id, pick.team_b_id)))
         or (x.slot = pick.slot and (x.team_a_id in (ref.team_a_id, ref.team_b_id)
                                     or x.team_b_id in (ref.team_a_id, ref.team_b_id)))))
$$;
revoke all on function _slot_clash(matches, matches) from public, anon, authenticated;

create or replace function court_pick_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare
  v_court uuid; cur matches; pick matches; ref matches; e events;
  v_pooled boolean;
begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into pick from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  select * into e from events where id = pick.event_id;
  if not exists (select 1 from courts c where c.id = v_court and c.competition_id = e.competition_id) then
    raise exception 'WRONG_COURT';
  end if;
  if pick.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;
  if pick.team_a_id is null or pick.team_b_id is null then raise exception 'TEAMS_NOT_KNOWN'; end if;
  if not (pick.court_id = v_court
          or (pick.court_id is null and (pick.home_court is null or pick.home_court = v_court))) then
    raise exception 'WRONG_COURT';
  end if;

  select * into cur from matches
   where court_id = v_court and status in ('live','awaiting_confirm')
   order by sequence limit 1 for update;
  if found then
    if cur.status <> 'live' or cur.score_a <> 0 or cur.score_b <> 0
       or exists (select 1 from point_events where match_id = cur.id) then
      raise exception 'GAME_STARTED';
    end if;
  end if;

  if exists (
    select 1 from matches x
     where x.status in ('live','awaiting_confirm') and x.id is distinct from cur.id
       and x.event_id in (select id from events where competition_id = e.competition_id)
       and (x.team_a_id in (pick.team_a_id, pick.team_b_id)
            or x.team_b_id in (pick.team_a_id, pick.team_b_id))) then
    raise exception 'TEAM_BUSY';
  end if;

  -- the game this one jumps ahead of: the one on court, else the first one waiting for this court
  if cur.id is not null then
    ref := cur;
  else
    select * into ref from matches m
     where m.status = 'scheduled' and m.id <> pick.id and m.bracket_key is null
       and m.event_id = pick.event_id
       and (m.court_id = v_court or (m.court_id is null and m.home_court = v_court))
     order by m.sequence limit 1;
  end if;

  if cur.id is not null then
    select (ev.court_dispatch = 'pool' and cur.bracket_key is null) into v_pooled
      from events ev where ev.id = cur.event_id;
    update matches
       set status = 'scheduled', started_at = null, a_on_left = true,
           initial_server = null, serving_team = null, server_no = null, last_scorer = null,
           court_id = case when v_pooled then null else court_id end
     where id = cur.id;
  end if;

  if ref.id is not null and ref.slot is not null and pick.slot is not null and pick.slot > ref.slot
     and _slot_clash(pick, ref) then
    raise exception 'SLOT_CLASH';
  end if;
  if ref.id is not null and ref.slot is not null and pick.slot is not null and pick.slot > ref.slot then
    -- the two games exchange places in the printed timetable (slot and running order)
    update matches set slot = pick.slot, sequence = pick.sequence where id = ref.id;
    update matches set slot = ref.slot, sequence = ref.sequence where id = pick.id;
  end if;

  update matches set court_id = v_court, status = 'live' where id = pick.id
  returning * into pick;
  return to_jsonb(pick);
end $fn$;


grant execute on function court_pick_match(uuid, text) to anon, authenticated;

create or replace function admin_move_up(p_token text, p_match_id uuid, p_court_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; pick matches; ref matches; v_court uuid;
begin
  c := _require_admin(p_token);
  select * into pick from matches where id = p_match_id for update;
  if not found or not exists (select 1 from events e where e.id = pick.event_id and e.competition_id = c) then
    raise exception 'NO_MATCH';
  end if;
  if pick.status <> 'scheduled' or pick.court_id is not null then raise exception 'NOT_WAITING'; end if;
  if pick.bracket_key is not null then raise exception 'GROUP_ONLY'; end if;
  v_court := coalesce(p_court_id, pick.home_court);
  if v_court is null or not exists (select 1 from courts where id = v_court and competition_id = c) then
    raise exception 'BAD_COURT';
  end if;

  select * into ref from matches m
   where m.event_id = pick.event_id and m.id <> pick.id and m.bracket_key is null
     and m.status = 'scheduled' and m.court_id is null and m.home_court = v_court
   order by m.sequence limit 1 for update;

  if found and ref.sequence < pick.sequence and _slot_clash(pick, ref) then
    raise exception 'SLOT_CLASH';
  end if;
  if ref.id is not null and ref.sequence < pick.sequence then
    update matches set slot = pick.slot, sequence = pick.sequence, home_court = pick.home_court,
           alert_at = now(), alert_note = 'later' where id = ref.id;
    update matches set slot = ref.slot, sequence = ref.sequence where id = pick.id;
  end if;
  update matches set home_court = v_court, alert_at = now(), alert_note = 'up' where id = pick.id;
  perform _pool_dispatch(pick.event_id);
  return jsonb_build_object('ok', true);
end $fn$;

grant execute on function admin_move_up(text, uuid, uuid) to anon, authenticated;

-- Reset puts every group game back in its printed slot / order / court
create or replace function _restore_plan(p_event uuid) returns int
language plpgsql security definer set search_path = public as $$
declare n int; begin
  update matches set slot = plan_slot, sequence = plan_seq, home_court = plan_court
   where event_id = p_event and plan_slot is not null
     and (slot, sequence, home_court) is distinct from (plan_slot, plan_seq, plan_court);
  get diagnostics n = row_count;
  return n;
end $$;
revoke all on function _restore_plan(uuid) from public, anon, authenticated;

create or replace function _reset_competition(c uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; ev record; begin
  n := _reset_competition_core(c);
  perform _ensure_final_series_rows(c);
  for ev in select id, court_dispatch from events where competition_id = c loop
    if _restore_plan(ev.id) > 0 and ev.court_dispatch = 'pool' then
      update matches set court_id = null, status = 'scheduled'
       where event_id = ev.id and bracket_key is null and status = 'live';
      perform _pool_dispatch(ev.id);
    end if;
  end loop;
  return n;
end $$;
revoke all on function _reset_competition(uuid) from public, anon, authenticated;

drop table pp;
commit;

select * from fix_report order by code;
