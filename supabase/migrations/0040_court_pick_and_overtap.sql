-- =====================================================================
-- PicklePoint migration 0040 (additive; nothing existing is replaced)
--   court_pick_match   the referee of a court plays another waiting game
--                      of that court first (a team is late). Only while the
--                      game on court has no point yet. The postponed game
--                      goes back to the front of the court's queue and
--                      starts by itself after the picked game.
--                      Printed time slots (0039): the two games exchange
--                      places in the timetable, so no court is held up.
--   no_overtap         a point tapped after the game is already over
--                      (second phone on the same court, late retry) is
--                      refused instead of making the score 16-10.
-- =====================================================================
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

create or replace function _no_overtap() returns trigger
language plpgsql as $fn$
begin
  raise exception 'MATCH_FINISHED';
end $fn$;

drop trigger if exists no_overtap on matches;
create trigger no_overtap before update of score_a, score_b on matches
for each row when (old.status = 'awaiting_confirm' and new.status = 'awaiting_confirm'
                   and new.score_a + new.score_b > old.score_a + old.score_b)
execute function _no_overtap();
