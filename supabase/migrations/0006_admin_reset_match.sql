-- =====================================================================
-- admin_reset_match: lets the tournament admin (logged in with the admin
-- PIN, not a court's scorer token) zero out any match in their
-- competition, regardless of which browser/device scored it.
-- Mirrors reset_match's effect but authorizes via admin session token.
-- =====================================================================

create or replace function admin_reset_match(p_token text, p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; c uuid; v_comp uuid; begin
  c := _require_admin(p_token);

  select e.competition_id into v_comp
    from matches mm join events e on e.id = mm.event_id
   where mm.id = p_match_id;

  if v_comp is null or v_comp is distinct from c then raise exception 'NO_MATCH'; end if;

  delete from point_events where match_id = p_match_id;

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

grant execute on function admin_reset_match(text, uuid) to anon, authenticated;
