-- admin_set_sport_courts: optional p_plan->'order' = exact game group per court, in
-- court order (e.g. ["MD1","XD","MD2","MD1","XD","MD2"]). Without it: unchanged
-- (MD1 courts first, then MD2, then XD).
create or replace function admin_set_sport_courts(p_token text, p_sport text, p_plan jsonb)
returns void language plpgsql security definer set search_path = public as $$
declare
  c uuid; ids uuid[]; want text[] := '{}'; g text; n int; i int; v_next int; v_have int;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  if p_sport not in ('pickleball','badminton') then raise exception 'BAD_SPORT'; end if;

  if jsonb_typeof(p_plan->'order') = 'array' then
    for g in select jsonb_array_elements_text(p_plan->'order') loop
      if g not in ('MD1','MD2','XD') then raise exception 'BAD_COURT_PLAN'; end if;
      want := want || g;
    end loop;
    if array_length(want, 1) > 36 then raise exception 'BAD_COURT_PLAN'; end if;
  else
    foreach g in array array['MD1','MD2','XD'] loop
      n := coalesce((p_plan->>g)::int, 0);
      if n < 0 or n > 12 then raise exception 'BAD_COURT_PLAN'; end if;
      for i in 1..n loop want := want || g; end loop;
    end loop;
  end if;
  if coalesce(array_length(want, 1), 0) < 1 then raise exception 'NEED_ONE_COURT'; end if;

  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = p_sport
                and (m.status = 'finished' or m.score_a > 0 or m.score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;

  delete from matches m using events e
   where m.event_id = e.id and e.competition_id = c and e.sport = p_sport;

  select coalesce(array_agg(id order by number), '{}') into ids
    from courts where competition_id = c and sport = p_sport;
  v_have := coalesce(array_length(ids, 1), 0);

  if v_have > array_length(want, 1) then
    delete from courts where id = any(ids[array_length(want, 1) + 1 : v_have]);
    ids := ids[1 : array_length(want, 1)];
    v_have := array_length(want, 1);
  end if;

  for i in 1..v_have loop
    update courts set game_group = want[i], label = initcap(p_sport) || ' ' || i
     where id = ids[i];
  end loop;

  select coalesce(max(number), 0) into v_next from courts where competition_id = c;
  for i in v_have + 1..array_length(want, 1) loop
    v_next := v_next + 1;
    insert into courts (competition_id, number, label, scorer_pin, sport, game_group)
    values (c, v_next, initcap(p_sport) || ' ' || i,
            lpad((floor(random() * 10000))::text, 4, '0'), p_sport, want[i]);
  end loop;
end $$;
grant execute on function admin_set_sport_courts(text, text, jsonb) to anon, authenticated;
