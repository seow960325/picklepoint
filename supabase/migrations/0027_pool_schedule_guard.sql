-- 0027: a shared-queue event (court_dispatch = 'pool', MCMD / MCXD) keeps its
-- 96-game home-court schedule and its bracket skeleton. admin_replace_schedule
-- rebuilds a plain round robin and deletes every match, so it is refused for
-- those events only; every other competition behaves exactly as before.
create or replace function admin_replace_schedule(
  p_token text, p_event_id uuid, p_matches jsonb, p_team_ids uuid[], p_court_ids uuid[])
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; r jsonb; n int := 0; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events where id = p_event_id and competition_id = c) then
    raise exception 'NO_EVENT';
  end if;
  if exists (select 1 from events where id = p_event_id and court_dispatch = 'pool') then
    raise exception 'POOL_SCHEDULE_LOCKED';
  end if;
  if exists (select 1 from matches
              where event_id = p_event_id and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'SCHEDULE_IN_PROGRESS';
  end if;

  delete from matches where event_id = p_event_id;

  for r in select * from jsonb_array_elements(p_matches) loop
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status)
    values (p_event_id,
            p_court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            p_team_ids[(r->>'a')::int + 1],
            p_team_ids[(r->>'b')::int + 1],
            'scheduled');
    n := n + 1;
  end loop;

  update matches m set status = 'live'
   where m.event_id = p_event_id
     and m.id in (select distinct on (court_id) id from matches
                   where event_id = p_event_id order by court_id, sequence);

  return jsonb_build_object('created', n);
end $$;
grant execute on function admin_replace_schedule(text, uuid, jsonb, uuid[], uuid[]) to anon, authenticated;
