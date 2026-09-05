-- =====================================================================
-- flip_sides: on-court referee manually swaps which team is on the left
-- vs right, to match the physical court. Persisted (a_on_left) so the
-- live board and TV mode show the same arrangement. Court-authorized.
-- Scoring stays correct because score_point maps the tapped side to a
-- team via a_on_left.
-- =====================================================================

create or replace function flip_sides(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;

  update matches set a_on_left = not a_on_left where id = p_match_id returning * into m;
  return to_jsonb(m);
end $$;

grant execute on function flip_sides(uuid, text) to anon, authenticated;
