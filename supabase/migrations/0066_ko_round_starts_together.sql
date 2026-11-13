-- PicklePoint 0066: a knockout round starts together (MC26 + YC26 pickleball / badminton).
-- A quarter-final, semi-final, playoff ... cannot get its first serve or first point
-- until every game of the same round has both teams. Captain ball and the extra games
-- of a best-of-3 Final are not affected. The referee screen shows "please wait" meanwhile.
create or replace function _ko_round_gate() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if exists (select 1 from events e where e.id = new.event_id and e.sport = 'captainball') then
    return new;
  end if;
  if exists (select 1 from matches x
              where x.event_id = new.event_id and x.id <> new.id
                and x.bracket_key is not null and x.bracket_key !~ '^KO-2-0-'
                and x.round is not distinct from new.round and x.status <> 'finished'
                and (x.team_a_id is null or x.team_b_id is null)) then
    raise exception 'ROUND_NOT_READY';
  end if;
  return new;
end $$;

drop trigger if exists ko_round_gate on matches;
create trigger ko_round_gate before update of score_a, score_b, initial_server on matches
for each row when (new.bracket_key is not null and old.score_a = 0 and old.score_b = 0
                   and (new.score_a + new.score_b > 0 or (old.initial_server is null and new.initial_server is not null)))
execute function _ko_round_gate();
