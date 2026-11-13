-- =====================================================================
-- PicklePoint migration 0062: Captain Ball knockout creates itself from the referee's screen.
-- Until now the next Captain Ball stage (playoff, semi-finals, 3rd place + Final) was only
-- created while the organiser had the Settings page open. With this, the Captain Ball
-- referee's court session writes it as soon as the previous stage is decided
-- (same idea as court_seed_bracket in 0050). Captain ball only; nothing else changes.
-- Additive. Run AFTER 0061.
-- =====================================================================
create or replace function court_add_tie_stage(
  p_token text, p_event_id uuid, p_stage text, p_games jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c uuid; v_from uuid; v_sport text; v_base int; v_tie uuid := gen_random_uuid(); r jsonb; n int := 0;
  v_court uuid;
begin
  v_from := _court_from_token(p_token);
  if v_from is null then raise exception 'NO_COURT_SESSION'; end if;
  select competition_id into c from courts where id = v_from and sport = 'captainball';
  if c is null then raise exception 'NOT_CAPTAIN_BALL'; end if;
  if not exists (select 1 from competitions where id = c and multi_sport) then
    raise exception 'NOT_MULTI_SPORT';
  end if;
  select sport into v_sport from events where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  if v_sport is distinct from 'captainball' then raise exception 'NOT_CAPTAIN_BALL'; end if;
  if p_stage not in ('P1','P2','SF1','SF2','3P','F') then raise exception 'BAD_STAGE'; end if;
  -- two screens writing the same stage at once: one at a time, the second sees STAGE_EXISTS
  perform pg_advisory_xact_lock(hashtext('cb_stage:' || c::text));
  if exists (select 1 from matches m join events e on e.id = m.event_id
              where e.competition_id = c and e.sport = v_sport and m.tie_stage = p_stage) then
    raise exception 'STAGE_EXISTS';
  end if;
  -- only once everything already on the list is finished or has its teams (no stage skipped by mistake)
  if exists (select 1 from matches m where m.event_id = p_event_id and m.tie_stage is null and m.status <> 'finished') then
    raise exception 'GROUP_STAGE_UNFINISHED';
  end if;

  select coalesce(max(m.sequence), 0) into v_base
    from matches m join events e on e.id = m.event_id where e.competition_id = c;

  for r in select * from jsonb_array_elements(p_games) loop
    if not exists (select 1 from teams t where t.id = (r->>'a')::uuid and t.event_id = p_event_id)
       or not exists (select 1 from teams t where t.id = (r->>'b')::uuid and t.event_id = p_event_id) then
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

  for v_court in select distinct (x->>'court')::uuid from jsonb_array_elements(p_games) x loop
    if not exists (select 1 from matches where court_id = v_court
                    and status in ('live','awaiting_confirm')) then
      update matches set status = 'live'
       where id = (select id from matches where court_id = v_court and status = 'scheduled'
                    order by sequence limit 1);
    end if;
  end loop;

  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'court', 'add_tie_stage', jsonb_build_object('event_id', p_event_id, 'stage', p_stage, 'games', n, 'auto', true));
  return jsonb_build_object('tie_id', v_tie, 'created', n);
end $$;
revoke all on function court_add_tie_stage(text, uuid, text, jsonb) from public;
grant execute on function court_add_tie_stage(text, uuid, text, jsonb) to anon, authenticated;
