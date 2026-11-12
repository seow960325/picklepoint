-- =====================================================================
-- PicklePoint migration 0057: "Reset points" also clears the draw flag
-- (events.bracket_seeded_at). Before this, reset emptied the knockout slots
-- but left the flag set, so when the groups finished again the automatic
-- draw was refused (ALREADY_SEEDED) and the bracket stayed empty.
-- Applies to YC26 and MC26 (every groups_ko category). Run AFTER 0056.
-- Also: the automatic draw only refuses when a knockout slot really has a team,
-- so a leftover flag can never block it again.
-- =====================================================================
create or replace function _reset_competition(c uuid)
returns int language plpgsql security definer set search_path = public as $fn$
declare ev record; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('reset_comp:' || c::text));

  delete from point_events where match_id in (
    select m.id from matches m join events e on e.id = m.event_id where e.competition_id = c);

  -- knockout games created stage by stage (captain ball playoff / semi-finals /
  -- 3rd place / Final) are built from the group result: remove them, they are
  -- created again automatically when the groups finish
  delete from matches m using events e
   where m.event_id = e.id and e.competition_id = c and m.tie_stage is not null;

  update matches m set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    last_scorer = null, initial_server = null, serving_team = null, server_no = null,
    status = 'scheduled', winner_id = null,
    started_at = null, finished_at = null, duration_seconds = null,
    alert_at = null, alert_note = null,
    cb = case when e.sport = 'captainball' then null else m.cb end,
    court_id = case when e.court_dispatch = 'pool' then null else m.court_id end,
    team_a_id = case when (coalesce(e.sport,'pickleball') <> 'captainball' and m.bracket_key is not null)
                       or m.id in (select next_match_id from matches where next_match_id is not null and event_id = e.id)
                     then null else m.team_a_id end,
    team_b_id = case when (coalesce(e.sport,'pickleball') <> 'captainball' and m.bracket_key is not null)
                       or m.id in (select next_match_id from matches where next_match_id is not null and event_id = e.id)
                     then null else m.team_b_id end
   from events e
  where e.id = m.event_id and e.competition_id = c;
  get diagnostics n = row_count;
  -- the knockout draw is empty again: let it seed itself when the groups finish
  update events set bracket_seeded_at = null where competition_id = c;

  for ev in select id, court_dispatch from events where competition_id = c loop
    if ev.court_dispatch = 'pool' then
      perform _pool_dispatch(ev.id);
    else
      update matches m set status = 'live'
       where m.event_id = ev.id and m.court_id is not null
         and m.team_a_id is not null and m.team_b_id is not null
         and m.id in (select distinct on (court_id) id from matches
                       where event_id = ev.id and court_id is not null
                         and team_a_id is not null and team_b_id is not null
                       order by court_id, sequence);
    end if;
  end loop;

  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'reset_competition', jsonb_build_object('matches', n));
  return n;
end $fn$;
revoke all on function _reset_competition(uuid) from public, anon, authenticated;

-- repair categories already reset: flag set but no team in any knockout slot
update events e set bracket_seeded_at = null
 where e.bracket_seeded_at is not null
   and not exists (select 1 from matches m
                    where m.event_id = e.id and m.bracket_key is not null
                      and (m.team_a_id is not null or m.team_b_id is not null));

create or replace function court_seed_bracket(p_token text, p_event_id uuid, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_court uuid; c uuid; e events; r jsonb; m matches;
  v_a uuid; v_b uuid; v_filled int := 0; v_byes int := 0;
begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;
  select competition_id into c from courts where id = v_court;
  select * into e from events where id = p_event_id and competition_id = c for update;
  if not found then raise exception 'NO_EVENT'; end if;
  if e.format <> 'groups_ko' then raise exception 'NOT_GROUPS_KO'; end if;
  if e.bracket_seeded_at is not null and exists (select 1 from matches
       where event_id = p_event_id and bracket_key is not null
         and (team_a_id is not null or team_b_id is not null)) then
    raise exception 'ALREADY_SEEDED';
  end if;
  if exists (select 1 from matches where event_id = p_event_id and bracket_key is null and status <> 'finished') then
    raise exception 'GROUP_STAGE_UNFINISHED';
  end if;

  for r in select * from jsonb_array_elements(p_pairs) loop
    v_a := nullif(r->>'a','')::uuid;
    v_b := nullif(r->>'b','')::uuid;
    if v_a is null and v_b is null then continue; end if;
    if v_a is not null and not exists (select 1 from teams where id = v_a and event_id = p_event_id) then raise exception 'BAD_TEAM'; end if;
    if v_b is not null and not exists (select 1 from teams where id = v_b and event_id = p_event_id) then raise exception 'BAD_TEAM'; end if;
    select * into m from matches where event_id = p_event_id and bracket_key = (r->>'key') for update;
    if not found then raise exception 'NO_BRACKET_SLOT'; end if;
    if m.status = 'finished' then raise exception 'SLOT_ALREADY_PLAYED'; end if;
    if v_a is null or v_b is null then
      update matches set team_a_id = coalesce(v_a, v_b), team_b_id = null,
             status = 'finished', winner_id = coalesce(v_a, v_b), finished_at = now() where id = m.id;
      v_byes := v_byes + 1;
    else
      update matches set team_a_id = v_a, team_b_id = v_b where id = m.id;
      v_filled := v_filled + 1;
    end if;
  end loop;

  update events set bracket_seeded_at = now() where id = p_event_id;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'court', 'seed_bracket', jsonb_build_object('event_id', p_event_id, 'matches', v_filled, 'byes', v_byes, 'auto', true));
  return jsonb_build_object('ok', true, 'matches', v_filled, 'byes', v_byes);
end $$;
grant execute on function court_seed_bracket(text, uuid, jsonb) to anon, authenticated;
