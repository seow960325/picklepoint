-- =====================================================================
-- PicklePoint migration 0048: correct a GROUP result even after the knockout
-- bracket was drawn. The bracket is taken back automatically (while no knockout
-- game has been played) and the Admin page draws it again from the corrected
-- tables. Run AFTER 0046.
-- =====================================================================
create or replace function admin_set_result(
  p_token text, p_match_id uuid, p_score_a int, p_score_b int, p_winner text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; m matches; n matches; v_win uuid; v_lose uuid; v_old uuid; begin
  c := _require_admin(p_token);
  select mm.* into m from matches mm join events e on e.id = mm.event_id
   where mm.id = p_match_id and e.competition_id = c for update of mm;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'finished' then raise exception 'NOT_FINISHED'; end if;
  if p_winner not in ('a', 'b') or p_score_a < 0 or p_score_b < 0 then raise exception 'BAD_RESULT'; end if;
  if (p_winner = 'a' and p_score_a <= p_score_b) or (p_winner = 'b' and p_score_b <= p_score_a) then
    raise exception 'WINNER_NEEDS_MORE_POINTS';
  end if;
  v_win := case when p_winner = 'a' then m.team_a_id else m.team_b_id end;
  v_lose := case when p_winner = 'a' then m.team_b_id else m.team_a_id end;

  if m.bracket_key is null then
    if exists (select 1 from matches where event_id = m.event_id and bracket_key is not null and team_a_id is not null) then
      -- the knockout is drawn from the group tables: take it back (only while no knockout
      -- game has been played) so it is drawn again from the corrected result
      if exists (select 1 from matches where event_id = m.event_id and bracket_key is not null
                  and (score_a > 0 or score_b > 0)) then
        raise exception 'BRACKET_IN_PLAY';
      end if;
      update matches set
        team_a_id = null, team_b_id = null, court_id = null, winner_id = null,
        score_a = 0, score_b = 0, status = 'scheduled', finished_at = null,
        started_at = null, duration_seconds = null
       where event_id = m.event_id and bracket_key is not null;
      update events set bracket_seeded_at = null where id = m.event_id;
    end if;
  else
    -- the winner / loser go on to games: only while those have not started
    for n in select * from matches where id in (m.next_match_id, m.loser_match_id) loop
      if n.status in ('live', 'awaiting_confirm', 'finished') or n.score_a > 0 or n.score_b > 0 then
        raise exception 'NEXT_STARTED';
      end if;
    end loop;
    if m.next_match_id is not null then
      if m.next_slot = 'a' then update matches set team_a_id = v_win where id = m.next_match_id;
      else update matches set team_b_id = v_win where id = m.next_match_id; end if;
    end if;
    if m.loser_match_id is not null and v_lose is not null then
      if m.loser_slot = 'a' then update matches set team_a_id = v_lose where id = m.loser_match_id;
      else update matches set team_b_id = v_lose where id = m.loser_match_id; end if;
    end if;
  end if;

  update matches set score_a = p_score_a, score_b = p_score_b, winner_id = v_win
   where id = p_match_id returning * into m;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'set_result', jsonb_build_object('match_id', p_match_id,
          'score_a', p_score_a, 'score_b', p_score_b, 'winner', v_win));
  return to_jsonb(m);
end $fn$;
grant execute on function admin_set_result(text, uuid, int, int, text) to anon, authenticated;
