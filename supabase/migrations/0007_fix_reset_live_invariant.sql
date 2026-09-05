-- =====================================================================
-- Fix: resetting a finished match to 'live' could leave a court with
-- two simultaneously-live matches, because confirm_match had already
-- auto-promoted the next queued match on that court (see 0004) before
-- the reset happened. Both reset_match and admin_reset_match now
-- demote any other 'live' match on the same court back to 'scheduled'
-- first, so "one live match per court" always holds.
-- =====================================================================

create or replace function reset_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;

  delete from point_events where match_id = p_match_id;

  update matches set status = 'scheduled'
   where court_id = v_court and status = 'live' and id <> p_match_id;

  update matches set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    status = 'live', winner_id = null, started_at = null, finished_at = null,
    duration_seconds = null
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

create or replace function admin_reset_match(p_token text, p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; c uuid; v_comp uuid; begin
  c := _require_admin(p_token);

  select e.competition_id into v_comp
    from matches mm join events e on e.id = mm.event_id
   where mm.id = p_match_id;

  if v_comp is null or v_comp is distinct from c then raise exception 'NO_MATCH'; end if;

  select * into m from matches where id = p_match_id for update;

  delete from point_events where match_id = p_match_id;

  if m.court_id is not null then
    update matches set status = 'scheduled'
     where court_id = m.court_id and status = 'live' and id <> p_match_id;
  end if;

  update matches set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    status = 'live', winner_id = null, started_at = null, finished_at = null,
    duration_seconds = null
  where id = p_match_id
  returning * into m;

  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'reset_match', jsonb_build_object('match_id', p_match_id));

  return to_jsonb(m);
end $$;

grant execute on function reset_match(uuid, text) to anon, authenticated;
grant execute on function admin_reset_match(text, uuid) to anon, authenticated;
