-- =====================================================================
-- PicklePoint migration 0024: per-game court allocation (multi-sport only)
--
-- Additive + opt-in like 0023. courts.game_group says which game type a
-- court hosts (MD1 / MD2 / XD); NULL = any (every existing court).
-- admin_set_sport_courts lets the organiser choose how many courts each
-- game type gets, per sport. It refuses to run unless multi_sport is on
-- and no game of that sport has been played yet.
-- =====================================================================

alter table courts add column if not exists game_group text;

create or replace function join_competition(p_code text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c competitions; begin
  select * into c from competitions where upper(code) = upper(trim(p_code));
  if not found then raise exception 'INVALID_CODE'; end if;
  return jsonb_build_object(
    'competition', jsonb_build_object('id', c.id, 'code', c.code, 'name', c.name,
                                      'venue', c.venue, 'event_date', c.event_date,
                                      'status', c.status, 'multi_sport', c.multi_sport),
    'events', coalesce((select jsonb_agg(to_jsonb(e) order by e.sort_order, e.name)
                          from events e where e.competition_id = c.id), '[]'::jsonb),
    'courts', coalesce((select jsonb_agg(jsonb_build_object('id', ct.id, 'number', ct.number,
                                                            'label', ct.label, 'sport', ct.sport,
                                                            'game_group', ct.game_group)
                                         order by ct.number)
                          from courts ct where ct.competition_id = c.id), '[]'::jsonb)
  );
end $$;
grant execute on function join_competition(text) to anon, authenticated;

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

  foreach g in array array['MD1','MD2','XD'] loop
    n := coalesce((p_plan->>g)::int, 0);
    if n < 0 or n > 12 then raise exception 'BAD_COURT_PLAN'; end if;
    for i in 1..n loop want := want || g; end loop;
  end loop;
  if coalesce(array_length(want, 1), 0) < 1 then raise exception 'NEED_ONE_COURT'; end if;

  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = p_sport
                and (m.status = 'finished' or m.score_a > 0 or m.score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;

  -- unplayed fixtures of this sport are rebuilt by "Regenerate schedule"
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
