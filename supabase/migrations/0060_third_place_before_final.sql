create or replace function _ko_match_flow() returns trigger
language plpgsql security definer set search_path = public as $$
declare v_loser uuid; v_court uuid; v_busy int; v_plan jsonb; begin
  if new.bracket_key is null then return null; end if;

  -- (a) result just locked in: feed the winner and the loser onward.
  if new.status = 'finished' and coalesce(old.status,'') <> 'finished'
     and new.winner_id is not null then
    if new.next_match_id is not null then
      if new.next_slot = 'a' then
        update matches set team_a_id = new.winner_id where id = new.next_match_id;
      else
        update matches set team_b_id = new.winner_id where id = new.next_match_id;
      end if;
    end if;
    if new.loser_match_id is not null then
      v_loser := case when new.winner_id = new.team_a_id then new.team_b_id else new.team_a_id end;
      if v_loser is not null then
        if new.loser_slot = 'a' then
          update matches set team_a_id = v_loser where id = new.loser_match_id;
        else
          update matches set team_b_id = v_loser where id = new.loser_match_id;
        end if;
      end if;
    end if;
  end if;

  -- (b) both teams now known and still unplaced: the planned court (0038),
  -- else the quietest court; start it if that court has nothing live.
  if new.status = 'scheduled' and new.court_id is null
     and new.team_a_id is not null and new.team_b_id is not null then
    select ko_court_plan into v_plan from events where id = new.event_id;
    if v_plan is not null and v_plan ? new.bracket_key then
      select c.id into v_court
        from courts c join events e on e.id = new.event_id
       where c.competition_id = e.competition_id
         and c.number = (v_plan ->> new.bracket_key)::int
       limit 1;
    end if;
    if v_court is null then
      select c.id into v_court
        from courts c
        join events e on e.id = new.event_id
       where c.competition_id = e.competition_id
       order by (select count(*) from matches m
                  where m.court_id = c.id and m.status in ('scheduled','on_deck','live')),
                c.number
       limit 1;
    end if;
    if v_court is not null then
      select count(*) into v_busy from matches
       where court_id = v_court and status in ('live','awaiting_confirm');
      -- planned courts: an earlier game already queued there goes first (the
      -- court's confirm promotes it), so this one only queues behind it
      -- and a game confirmed on that court in this same transaction means
      -- confirm_match is about to start the court's next queued game itself
      if v_plan is not null and v_busy = 0 then
        select count(*) into v_busy from matches
         where court_id = v_court
           and ((status in ('scheduled','on_deck') and sequence < new.sequence
                 and not (new.round = 'Third place' and bracket_key like 'KO-2-0%'))
                or (status = 'finished' and finished_at = now()));
      end if;
      if v_busy = 0 and new.bracket_key like 'KO-2-0%' and exists (
           select 1 from matches t
            where t.event_id = new.event_id and t.round = 'Third place' and t.status <> 'finished'
              and (t.court_id = v_court
                   or (v_plan is not null and t.bracket_key is not null
                       and v_plan ->> t.bracket_key = v_plan ->> new.bracket_key))) then
        v_busy := 1;
      end if;
      update matches
         set court_id = v_court,
             status = case when v_busy = 0 then 'live' else 'scheduled' end
       where id = new.id;
    end if;
  end if;

  return null;
end $$;
