-- =====================================================================
-- PicklePoint migration 0004: fix confirm_match to advance the court queue.
--
-- Bug: confirm_match locked in the result but never promoted the next
-- 'scheduled' match on that court to 'live'. The demo (localStorage) backend
-- already did this, so it went unnoticed until testing against real
-- Postgres — every court after its first match would sit with no live
-- match at all, requiring a manual admin fix for every single game.
-- =====================================================================

create or replace function confirm_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_winner uuid; v_next uuid; begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status <> 'awaiting_confirm' then raise exception 'NOT_AWAITING_CONFIRM'; end if;

  v_winner := case when m.score_a > m.score_b then m.team_a_id else m.team_b_id end;

  update matches set
    status = 'finished', winner_id = v_winner, finished_at = now(),
    duration_seconds = extract(epoch from (now() - coalesce(started_at, now())))::int
  where id = p_match_id returning * into m;

  if m.next_match_id is not null then
    if m.next_slot = 'a' then
      update matches set team_a_id = v_winner where id = m.next_match_id;
    else
      update matches set team_b_id = v_winner where id = m.next_match_id;
    end if;
  end if;

  -- advance the queue: the lowest-sequence still-scheduled match on this
  -- court goes live so the court keeps working without an admin's help
  if m.court_id is not null then
    select id into v_next from matches
     where court_id = m.court_id and status = 'scheduled'
     order by sequence limit 1;
    if v_next is not null then
      update matches set status = 'live' where id = v_next;
    end if;
  end if;

  return to_jsonb(m);
end $$;
