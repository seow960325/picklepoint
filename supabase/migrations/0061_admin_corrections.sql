-- =====================================================================
-- PicklePoint migration 0061: organiser corrections that always work.
--  1. admin_set_result
--     * a knockout result can be corrected while the next game is only WAITING on its court
--       (on court at 0-0 with no point yet used to count as "started" and blocked every fix)
--     * a score-only fix (same winner) is always allowed
--     * a group result can be corrected even after a knockout game has been played: the tables
--       are updated and the knockout is left as it is (use admin_set_ko_slot if a team must change)
--  2. admin_set_ko_slot: put a team into a knockout place by hand (auto draw wrong, team
--     withdrawn ...). Only while that game has no point. If the team already sits in another
--     game of the same round that has not started, the two teams change places.
-- Additive: nothing is deleted, no data is changed. Run AFTER 0060.
-- =====================================================================
create or replace function admin_set_result(
  p_token text, p_match_id uuid, p_score_a int, p_score_b int, p_winner text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; m matches; n matches; v_win uuid; v_lose uuid; v_kept boolean := false; begin
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
      if exists (select 1 from matches where event_id = m.event_id and bracket_key is not null
                  and (score_a > 0 or score_b > 0 or status in ('awaiting_confirm', 'finished'))) then
        -- the knockout is being played: keep it, only the group tables change
        v_kept := true;
      else
        -- not started: take the draw back so it is written again from the corrected tables
        update matches set
          team_a_id = null, team_b_id = null, court_id = null, winner_id = null,
          score_a = 0, score_b = 0, status = 'scheduled', finished_at = null,
          started_at = null, duration_seconds = null
         where event_id = m.event_id and bracket_key is not null;
        update events set bracket_seeded_at = null where id = m.event_id;
      end if;
    end if;
  elsif v_win is distinct from m.winner_id then
    -- the winner / loser go on to games: only while those have no point yet
    for n in select * from matches where id in (m.next_match_id, m.loser_match_id) loop
      if n.status in ('awaiting_confirm', 'finished') or n.score_a > 0 or n.score_b > 0
         or exists (select 1 from point_events p where p.match_id = n.id) then
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
          'score_a', p_score_a, 'score_b', p_score_b, 'winner', v_win, 'knockout_kept', v_kept));
  return to_jsonb(m) || jsonb_build_object('knockout_kept', v_kept);
end $fn$;
grant execute on function admin_set_result(text, uuid, int, int, text) to anon, authenticated;

create or replace function admin_set_ko_slot(
  p_token text, p_match_id uuid, p_slot text, p_team_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; m matches; o matches; v_old uuid; v_oslot text; begin
  c := _require_admin(p_token);
  select mm.* into m from matches mm join events e on e.id = mm.event_id
   where mm.id = p_match_id and e.competition_id = c for update of mm;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.bracket_key is null then raise exception 'NOT_KNOCKOUT'; end if;
  if p_slot not in ('a', 'b') then raise exception 'BAD_SLOT'; end if;
  if m.status in ('awaiting_confirm', 'finished') or m.score_a > 0 or m.score_b > 0
     or exists (select 1 from point_events p where p.match_id = m.id) then
    raise exception 'GAME_STARTED';
  end if;
  if p_team_id is not null and not exists (select 1 from teams where id = p_team_id and event_id = m.event_id) then
    raise exception 'BAD_TEAM';
  end if;
  v_old := case when p_slot = 'a' then m.team_a_id else m.team_b_id end;
  if p_team_id is not distinct from v_old then return to_jsonb(m); end if;
  if p_team_id is not null and p_team_id = (case when p_slot = 'a' then m.team_b_id else m.team_a_id end) then
    raise exception 'SAME_TEAM_TWICE';
  end if;

  -- the team already sits in another game of this round: the two teams change places
  if p_team_id is not null then
    select * into o from matches
     where event_id = m.event_id and bracket_key is not null and id <> m.id
       and round is not distinct from m.round and (team_a_id = p_team_id or team_b_id = p_team_id)
     limit 1 for update;
    if found then
      if o.status in ('awaiting_confirm', 'finished') or o.score_a > 0 or o.score_b > 0
         or exists (select 1 from point_events p where p.match_id = o.id) then
        raise exception 'OTHER_GAME_STARTED';
      end if;
      v_oslot := case when o.team_a_id = p_team_id then 'a' else 'b' end;
      if v_old is null then
        -- nobody to send back: that game waits off court until its place is filled again
        update matches set team_a_id = case when v_oslot = 'a' then null else team_a_id end,
                           team_b_id = case when v_oslot = 'b' then null else team_b_id end,
                           status = 'scheduled', court_id = null where id = o.id;
      elsif v_oslot = 'a' then update matches set team_a_id = v_old where id = o.id;
      else update matches set team_b_id = v_old where id = o.id;
      end if;
    end if;
  end if;

  if p_team_id is null then
    update matches set team_a_id = case when p_slot = 'a' then null else team_a_id end,
                       team_b_id = case when p_slot = 'b' then null else team_b_id end,
                       status = 'scheduled', court_id = null where id = m.id;
  elsif p_slot = 'a' then update matches set team_a_id = p_team_id where id = m.id;
  else update matches set team_b_id = p_team_id where id = m.id;
  end if;
  -- the draw is now the organiser's: the automatic draw must not write over it
  update events set bracket_seeded_at = coalesce(bracket_seeded_at, now()) where id = m.event_id;

  select * into m from matches where id = p_match_id;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'admin', 'set_ko_slot', jsonb_build_object('match_id', p_match_id, 'key', m.bracket_key,
          'slot', p_slot, 'team', p_team_id, 'was', v_old));
  return to_jsonb(m);
end $fn$;
revoke all on function admin_set_ko_slot(text, uuid, text, uuid) from public;
grant execute on function admin_set_ko_slot(text, uuid, text, uuid) to anon, authenticated;
