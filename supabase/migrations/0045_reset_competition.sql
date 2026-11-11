-- =====================================================================
-- PicklePoint migration 0045: "Start over" for a whole competition.
-- Wipes every score / result / knockout line-up of this competition and
-- puts all games back to "waiting", so the event can be played again (same
-- teams and settings; groups, rules and schedule can then be changed and
-- regenerated). Captain ball events are left alone. Run AFTER 0044.
-- =====================================================================
create or replace function admin_reset_competition(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; ev record; n int := 0;
begin
  c := _require_admin(p_token);
  perform pg_advisory_xact_lock(hashtext('reset_comp:' || c::text));

  delete from point_events where match_id in (
    select m.id from matches m join events e on e.id = m.event_id
     where e.competition_id = c and coalesce(e.sport, 'pickleball') <> 'captainball');

  update matches m set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    last_scorer = null, initial_server = null, serving_team = null, server_no = null,
    status = 'scheduled', winner_id = null,
    started_at = null, finished_at = null, duration_seconds = null,
    alert_at = null, alert_note = null,
    court_id = case when e.court_dispatch = 'pool' then null else m.court_id end,
    team_a_id = case when m.bracket_key is not null then null else m.team_a_id end,
    team_b_id = case when m.bracket_key is not null then null else m.team_b_id end
   from events e
  where e.id = m.event_id and e.competition_id = c
    and coalesce(e.sport, 'pickleball') <> 'captainball';
  get diagnostics n = row_count;

  for ev in select id, court_dispatch from events
             where competition_id = c and coalesce(sport, 'pickleball') <> 'captainball' loop
    if ev.court_dispatch = 'pool' then
      perform _pool_dispatch(ev.id);
    else
      update matches m set status = 'live'
       where m.event_id = ev.id and m.bracket_key is null
         and m.id in (select distinct on (court_id) id from matches
                       where event_id = ev.id and bracket_key is null and court_id is not null
                       order by court_id, sequence);
    end if;
  end loop;

  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'reset_competition', jsonb_build_object('matches', n));
  return jsonb_build_object('ok', true, 'matches', n);
end $fn$;
grant execute on function admin_reset_competition(text) to anon, authenticated;
