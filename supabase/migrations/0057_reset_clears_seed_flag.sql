-- =====================================================================
-- PicklePoint migration 0057: "Reset points" also clears the draw flag
-- (events.bracket_seeded_at). Before this, reset emptied the knockout slots
-- but left the flag set, so when the groups finished again the automatic
-- draw was refused (ALREADY_SEEDED) and the bracket stayed empty.
-- Applies to YC26 and MC26 (every groups_ko category). Run AFTER 0056.
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
