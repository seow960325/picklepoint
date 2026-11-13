-- PicklePoint 0067 (MC26 + TESTMC only): knockout games follow the printed slots.
-- QF1 + QF2 = slot 1 after the groups, QF3 + QF4 = slot 2, semi-finals 3, 3rd place 4, Final 5.
-- A knockout game cannot get its first serve / first point while a knockout game of an
-- earlier slot is unfinished (on top of 0066: a round starts together).
update matches m set slot = g.last + v.off
  from (values ('KO-8-0', 1), ('KO-8-1', 1), ('KO-8-2', 2), ('KO-8-3', 2),
               ('KO-4-0', 3), ('KO-4-1', 3), ('KO-3P', 4), ('KO-2-0', 5)) v(k, off),
       (select x.event_id, max(x.slot) last from matches x
          join events e on e.id = x.event_id join competitions c on c.id = e.competition_id
         where c.code in ('MCMD', 'MCXD', 'TESTMD', 'TESTXD') and x.bracket_key is null
         group by x.event_id) g
 where m.event_id = g.event_id and m.bracket_key = v.k;

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
  if new.slot is not null and exists (select 1 from matches x
              where x.event_id = new.event_id and x.id <> new.id
                and x.bracket_key is not null and x.slot is not null and x.slot < new.slot
                and x.status <> 'finished') then
    raise exception 'ROUND_NOT_READY';
  end if;
  return new;
end $$;

select c.code, m.bracket_key, m.slot from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
 where c.code in ('MCMD', 'MCXD', 'TESTMD', 'TESTXD') and m.bracket_key is not null order by c.code, m.slot, m.bracket_key;
