create or replace function _final_series() returns trigger
language plpgsql security definer set search_path = public as $$
declare ev events; v_a uuid; v_b uuid; wa int; wb int; v_next uuid; v_seq int; i int; begin
  select * into ev from events where id = new.event_id;
  if coalesce(ev.final_best_of, 1) < 2 then return null; end if;
  select team_a_id, team_b_id into v_a, v_b from matches
   where event_id = new.event_id and bracket_key = 'KO-2-0';
  if v_a is null or v_b is null then return null; end if;
  select count(*) filter (where winner_id = v_a), count(*) filter (where winner_id = v_b)
    into wa, wb
    from matches where event_id = new.event_id and bracket_key like 'KO-2-0%' and status = 'finished';
  if greatest(wa, wb) >= ev.final_best_of / 2 + 1 then
    delete from matches
     where event_id = new.event_id and bracket_key like 'KO-2-0-%'
       and status = 'scheduled' and court_id is null and score_a = 0 and score_b = 0;
    return null;
  end if;
  select coalesce(max(sequence), 0) into v_seq from matches where event_id = new.event_id;
  for i in 2..ev.final_best_of loop
    if not exists (select 1 from matches where event_id = new.event_id and bracket_key = 'KO-2-0-' || i) then
      insert into matches (event_id, court_id, round, sequence, bracket_key, status)
      values (new.event_id, null, 'Final', v_seq + i - 1, 'KO-2-0-' || i, 'scheduled');
    end if;
  end loop;
  select id into v_next from matches
   where event_id = new.event_id and bracket_key like 'KO-2-0-%' and team_a_id is null
   order by bracket_key limit 1;
  if v_next is not null then
    update matches set team_a_id = v_a, team_b_id = v_b where id = v_next;
  end if;
  return null;
end $$;

do $$
declare ev events; v_a uuid; v_b uuid; wa int; wb int; v_next uuid; v_seq int; i int; begin
  for ev in select * from events where coalesce(final_best_of, 1) >= 2 loop
    select team_a_id, team_b_id into v_a, v_b from matches where event_id = ev.id and bracket_key = 'KO-2-0';
    if v_a is null or v_b is null then continue; end if;
    select count(*) filter (where winner_id = v_a), count(*) filter (where winner_id = v_b)
      into wa, wb
      from matches where event_id = ev.id and bracket_key like 'KO-2-0%' and status = 'finished';
    if wa + wb = 0 or greatest(wa, wb) >= ev.final_best_of / 2 + 1 then continue; end if;
    select coalesce(max(sequence), 0) into v_seq from matches where event_id = ev.id;
    for i in 2..ev.final_best_of loop
      if not exists (select 1 from matches where event_id = ev.id and bracket_key = 'KO-2-0-' || i) then
        insert into matches (event_id, court_id, round, sequence, bracket_key, status)
        values (ev.id, null, 'Final', v_seq + i - 1, 'KO-2-0-' || i, 'scheduled');
      end if;
    end loop;
    select id into v_next from matches
     where event_id = ev.id and bracket_key like 'KO-2-0-%' and team_a_id is null
     order by bracket_key limit 1;
    if v_next is not null then
      update matches set team_a_id = v_a, team_b_id = v_b where id = v_next;
    end if;
  end loop;
end $$;
