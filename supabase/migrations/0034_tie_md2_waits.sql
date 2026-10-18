-- Badminton 3rd place + Final (multi-sport, organiser's sheet):
--   MD1 (Court 1) and XD (Court 2) are played together. MD2 is played only at
--   1-1, on the MD1 court, after both are decided. 2-0 -> MD2 is dropped.
-- While MD1 / XD are undecided, MD2's unplayed games are taken off the court
-- (court_id null) so the court queue cannot start them early; at 1-1 they go
-- back on the MD1 court. Replaces _tie_dead_rubber from 0032. Badminton only;
-- group stage and semi-finals are untouched.
create or replace function _tie_dead_rubber() returns trigger
language plpgsql security definer set search_path = public as $$
declare wa int; wb int; v_units int; v_open int; v_court uuid; begin
  if not exists (select 1 from events where id = new.event_id and sport = 'badminton') then
    return null;
  end if;

  with unit as (
    select game_label,
           count(*) filter (where status = 'finished' and winner_id = new.team_a_id) as a_g,
           count(*) filter (where status = 'finished' and winner_id = new.team_b_id) as b_g,
           bool_or(set_no is not null) as is_set
      from matches where tie_id = new.tie_id group by game_label),
  u as (
    select game_label,
           (is_set and a_g >= 2) or (not is_set and a_g >= 1) as a_won,
           (is_set and b_g >= 2) or (not is_set and b_g >= 1) as b_won
      from unit)
  select count(*) filter (where a_won), count(*) filter (where b_won), count(*),
         count(*) filter (where game_label is distinct from 'MD2' and not a_won and not b_won)
    into wa, wb, v_units, v_open from u;

  -- decided (2-0 or 2-1): nothing else is played
  if greatest(wa, wb) >= 2 then
    delete from matches
     where tie_id = new.tie_id and status = 'scheduled' and score_a = 0 and score_b = 0;
    return null;
  end if;

  if v_units < 3 then return null; end if;

  if v_open > 0 then
    -- MD1 or XD still being played: MD2 waits off court
    update matches set court_id = null
     where tie_id = new.tie_id and game_label = 'MD2'
       and status = 'scheduled' and score_a = 0 and score_b = 0;
    return null;
  end if;

  -- 1-1: MD2 decides it, on the MD1 court
  select court_id into v_court from matches
   where tie_id = new.tie_id and game_label = 'MD1' and court_id is not null
   order by sequence limit 1;
  if v_court is null then return null; end if;

  update matches set court_id = v_court
   where tie_id = new.tie_id and game_label = 'MD2' and status = 'scheduled' and court_id is null;

  -- the game just finished on another court: start MD2 here ourselves.
  -- (finished on this court: confirm_match starts it as the next game.)
  if new.court_id is distinct from v_court
     and not exists (select 1 from matches where court_id = v_court and status in ('live','awaiting_confirm')) then
    update matches set status = 'live'
     where id = (select id from matches where court_id = v_court and status = 'scheduled'
                  order by sequence limit 1);
  end if;
  return null;
end $$;

drop trigger if exists tie_dead_rubber on matches;
create trigger tie_dead_rubber after update of status on matches
  for each row
  when (new.tie_stage in ('3P','F') and new.status = 'finished' and old.status is distinct from 'finished')
  execute function _tie_dead_rubber();
