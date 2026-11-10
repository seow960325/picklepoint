-- =====================================================================
-- PicklePoint migration 0039: printed time slots for the shared queue
-- (Christmas Outreach MCMD / MCXD). Run AFTER 0038. Opt-in: only events
-- with pool_strict whose matches carry a slot number are affected.
--   matches.slot   printed slot of a group game (1, 2, 3 ...)
--   pool_strict    a court starts its next game only when (a) both teams
--                  are off court and (b) every group game of the earlier
--                  slots has finished, so play follows the printed slots and
--                  a team always rests at least one slot between games.
-- =====================================================================
alter table matches add column if not exists slot int;

create or replace function _pool_dispatch(p_event uuid) returns void
language plpgsql security definer set search_path = public as $fn$
declare e events; ct record; v_next uuid; v_tries int;
begin
  select * into e from events where id = p_event;
  if not found or e.court_dispatch <> 'pool' then return; end if;
  perform pg_advisory_xact_lock(hashtext('pool_dispatch:' || p_event::text));

  for ct in
    select c.id from courts c
     where c.competition_id = e.competition_id
       and not exists (select 1 from matches x
                        where x.court_id = c.id
                          and x.status in ('live','awaiting_confirm','scheduled','on_deck'))
     order by c.number
  loop
    if coalesce(e.pool_strict, false) then
      -- this court's next game in printed order, once both teams are off
      -- court and (0039) every game of the earlier slots has finished
      select m.id into v_next from matches m
       where m.event_id = p_event and m.court_id is null and m.bracket_key is null
         and m.status = 'scheduled'
         and (m.home_court is null or m.home_court = ct.id)
       order by m.sequence limit 1;
      if v_next is not null and not exists (
           select 1 from matches x, matches m
            where m.id = v_next and x.event_id = p_event
              and x.status in ('live','awaiting_confirm')
              and (x.team_a_id in (m.team_a_id, m.team_b_id)
                   or x.team_b_id in (m.team_a_id, m.team_b_id)))
         and not exists (
           select 1 from matches x, matches m
            where m.id = v_next and m.slot is not null
              and x.event_id = p_event and x.bracket_key is null
              and x.slot < m.slot and x.status <> 'finished') then
        update matches set court_id = ct.id, status = 'live'
         where id = v_next and court_id is null and status = 'scheduled';
      end if;
      continue;
    end if;
    v_tries := 0;
    loop
      v_tries := v_tries + 1;
      select q.id into v_next from (
        select m.id, m.sequence,
               coalesce(extract(epoch from now() - (
                 select max(f.finished_at) from matches f
                  where f.event_id = p_event and f.status = 'finished'
                    and (f.team_a_id in (m.team_a_id, m.team_b_id)
                         or f.team_b_id in (m.team_a_id, m.team_b_id)))), 1e9) as rest
          from matches m
         where m.event_id = p_event and m.court_id is null and m.bracket_key is null
           and m.status = 'scheduled'
           and (m.home_court is null or m.home_court = ct.id)
           and not exists (
             select 1 from matches x
              where x.event_id = p_event and x.status in ('live','awaiting_confirm')
                and (x.team_a_id in (m.team_a_id, m.team_b_id)
                     or x.team_b_id in (m.team_a_id, m.team_b_id)))
      ) q
      order by (q.rest >= 900) desc,
               case when q.rest >= 900 then q.sequence end,
               q.rest desc
      limit 1;
      exit when v_next is null;
      update matches set court_id = ct.id, status = 'live'
       where id = v_next and court_id is null and status = 'scheduled';
      exit when found or v_tries >= 5;
    end loop;
  end loop;
end $fn$;
