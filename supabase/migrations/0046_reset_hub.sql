-- =====================================================================
-- PicklePoint migration 0046: reset points for the WHOLE hub in one go.
--   _reset_competition(c)     internal worker (no grant) - now also resets
--                             captain ball events (scores, cb state, KO line-up)
--   admin_reset_competition   one category (same as 0045, now incl. captain ball)
--   admin_reset_hub           every category of the caller's hub:
--                             YC26 = YC26, BMMD, BMXD, PBMD, PBXD ; MC26 = MCMD, MCXD
-- Run AFTER 0045. Teams, courts, groups and settings are kept.
-- =====================================================================
create or replace function _reset_competition(c uuid)
returns int language plpgsql security definer set search_path = public as $fn$
declare ev record; n int := 0;
begin
  perform pg_advisory_xact_lock(hashtext('reset_comp:' || c::text));

  delete from point_events where match_id in (
    select m.id from matches m join events e on e.id = m.event_id where e.competition_id = c);

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

create or replace function admin_reset_competition(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; n int;
begin
  c := _require_admin(p_token);
  n := _reset_competition(c);
  return jsonb_build_object('ok', true, 'matches', n);
end $fn$;
grant execute on function admin_reset_competition(text) to anon, authenticated;

create or replace function admin_reset_hub(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; code_ text; codes text[]; r record; n int := 0; k int := 0;
begin
  c := _require_admin(p_token);
  select upper(code) into code_ from competitions where id = c;
  codes := case
    when code_ in ('YC26','BMMD','BMXD','PBMD','PBXD') then array['YC26','BMMD','BMXD','PBMD','PBXD']
    when code_ in ('MCMD','MCXD') then array['MCMD','MCXD']
    else array[code_] end;
  for r in select id from competitions where upper(code) = any(codes) loop
    n := n + _reset_competition(r.id); k := k + 1;
  end loop;
  return jsonb_build_object('ok', true, 'competitions', k, 'matches', n);
end $fn$;
grant execute on function admin_reset_hub(text) to anon, authenticated;
