-- 3rd place + Final (multi-sport): once one team has won 2 disciplines the
-- third is not played - its queued, unplayed games are removed before
-- confirm_match advances the court queue. Group stage and semi-finals untouched.
create or replace function _tie_dead_rubber() returns trigger
language plpgsql security definer set search_path = public as $$
declare wa int; wb int; begin
  with unit as (
    select game_label,
           count(*) filter (where status = 'finished' and winner_id = new.team_a_id) as a_g,
           count(*) filter (where status = 'finished' and winner_id = new.team_b_id) as b_g,
           bool_or(set_no is not null) as is_set
      from matches where tie_id = new.tie_id group by game_label)
  select count(*) filter (where (is_set and a_g >= 2) or (not is_set and a_g >= 1)),
         count(*) filter (where (is_set and b_g >= 2) or (not is_set and b_g >= 1))
    into wa, wb from unit;
  if greatest(wa, wb) >= 2 then
    delete from matches
     where tie_id = new.tie_id and status = 'scheduled' and score_a = 0 and score_b = 0;
  end if;
  return null;
end $$;

drop trigger if exists tie_dead_rubber on matches;
create trigger tie_dead_rubber after update of status on matches
  for each row
  when (new.tie_stage in ('3P','F') and new.status = 'finished' and old.status is distinct from 'finished')
  execute function _tie_dead_rubber();
