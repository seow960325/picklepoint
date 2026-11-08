-- =====================================================================
-- PicklePoint migration 0036: captain ball groups -> playoff -> knockout
-- Additive. Two extra knockout stage names (P1, P2 = playoff games between
-- the group places) so a captain-ball code can run: groups A/B of 3, playoff,
-- semi-finals, 3rd place, Final. Nothing else changes.
-- =====================================================================
alter table matches drop constraint if exists matches_tie_stage_check;
alter table matches add constraint matches_tie_stage_check
  check (tie_stage is null or tie_stage in ('P1','P2','SF1','SF2','3P','F'));

create or replace function admin_add_tie_stage(
  p_token text, p_event_id uuid, p_stage text, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; v_sport text; v_base int; v_tie uuid := gen_random_uuid(); r jsonb; n int := 0;
  v_court uuid;
begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if p_stage not in ('P1','P2','SF1','SF2','3P','F') then raise exception 'BAD_STAGE'; end if;
  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage) then
    raise exception 'STAGE_EXISTS';
  end if;

  select coalesce(max(m.sequence), 0) into v_base
    from matches m join events e on e.id = m.event_id where e.competition_id = c;

  for r in select * from jsonb_array_elements(p_games) loop
    if not exists (select 1 from teams t join events e on e.id = t.event_id
                    where t.id = (r->>'a')::uuid and e.competition_id = c and e.sport = v_sport)
       or not exists (select 1 from teams t join events e on e.id = t.event_id
                    where t.id = (r->>'b')::uuid and e.competition_id = c and e.sport = v_sport) then
      raise exception 'WRONG_TEAM';
    end if;
    if not exists (select 1 from courts where id = (r->>'court')::uuid
                    and competition_id = c and sport = v_sport) then
      raise exception 'WRONG_SPORT_COURT';
    end if;
    insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status,
                         tie_id, game_label, tie_stage, set_no)
    values (p_event_id, (r->>'court')::uuid, nullif(r->>'round',''),
            v_base + coalesce((r->>'seq')::int, n + 1),
            (r->>'a')::uuid, (r->>'b')::uuid, 'scheduled',
            v_tie, nullif(r->>'game',''), p_stage, nullif(r->>'set','')::int);
    n := n + 1;
  end loop;

  -- idle courts start their first queued game straight away
  for v_court in select distinct (x->>'court')::uuid from jsonb_array_elements(p_games) x loop
    if not exists (select 1 from matches where court_id = v_court
                    and status in ('live','awaiting_confirm')) then
      update matches set status = 'live'
       where id = (select id from matches where court_id = v_court and status = 'scheduled'
                    order by sequence limit 1);
    end if;
  end loop;

  return jsonb_build_object('tie_id', v_tie, 'created', n);
end $$;
grant execute on function admin_add_tie_stage(text, uuid, text, jsonb) to anon, authenticated;

create or replace function admin_clear_tie_stage(p_token text, p_event_id uuid, p_stage text)
returns void language plpgsql security definer set search_path = public as $$
declare c uuid; v_sport text; begin
  c := _require_admin(p_token);
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage
                and (m.status = 'finished' or m.score_a > 0 or m.score_b > 0)) then
    raise exception 'STAGE_STARTED';
  end if;
  delete from matches m using events e
   where m.event_id = e.id and e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage;
end $$;
grant execute on function admin_clear_tie_stage(text, uuid, text) to anon, authenticated;
