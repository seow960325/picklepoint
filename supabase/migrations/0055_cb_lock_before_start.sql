-- Captain ball: no points / fouls / calls before the referee has started the game clock.
-- The scorer disables the buttons; this makes the server refuse a save that scores while the game is still "ready".
create or replace function cb_save(
  p_match_id uuid, p_token text, p_cb jsonb,
  p_score_a int, p_score_b int, p_a_on_left boolean)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; v_sport text; v_old int; v_new int; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  select sport into v_sport from events where id = m.event_id;
  if v_sport is distinct from 'captainball' then raise exception 'NOT_CAPTAIN_BALL'; end if;
  if m.status not in ('live', 'awaiting_confirm') then raise exception 'MATCH_NOT_LIVE'; end if;
  if p_score_a < 0 or p_score_b < 0 or p_score_a > 999 or p_score_b > 999 then
    raise exception 'BAD_SCORE';
  end if;
  if coalesce(p_cb->>'phase', 'ready') = 'ready'
     and (p_score_a <> m.score_a or p_score_b <> m.score_b
          or coalesce(jsonb_array_length(p_cb->'log'), 0) > 0) then
    raise exception 'GAME_NOT_STARTED';
  end if;

  v_new := coalesce((p_cb->>'rev')::int, 0);
  v_old := case when m.started_at is null then 0 else coalesce((m.cb->>'rev')::int, 0) end;
  if v_new <= v_old then raise exception 'CB_STALE'; end if;

  update matches set
    cb = p_cb, score_a = p_score_a, score_b = p_score_b,
    a_on_left = coalesce(p_a_on_left, a_on_left),
    started_at = coalesce(started_at, now()), status = 'live'
  where id = p_match_id
  returning * into m;
  return to_jsonb(m);
end $$;
grant execute on function cb_save(uuid, text, jsonb, int, int, boolean) to anon, authenticated;
