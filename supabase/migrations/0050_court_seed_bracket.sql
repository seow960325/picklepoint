-- PicklePoint 0050: the knockout seeds itself. A referee's court session (the one that
-- confirms the last group game) writes the first knockout round, so nobody presses
-- LOCK & DRAW. Same checks as admin_seed_bracket; the court must belong to the event's competition.
create or replace function court_seed_bracket(p_token text, p_event_id uuid, p_pairs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_court uuid; c uuid; e events; r jsonb; m matches;
  v_a uuid; v_b uuid; v_filled int := 0; v_byes int := 0;
begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;
  select competition_id into c from courts where id = v_court;
  select * into e from events where id = p_event_id and competition_id = c for update;
  if not found then raise exception 'NO_EVENT'; end if;
  if e.format <> 'groups_ko' then raise exception 'NOT_GROUPS_KO'; end if;
  if e.bracket_seeded_at is not null then raise exception 'ALREADY_SEEDED'; end if;
  if exists (select 1 from matches where event_id = p_event_id and bracket_key is null and status <> 'finished') then
    raise exception 'GROUP_STAGE_UNFINISHED';
  end if;

  for r in select * from jsonb_array_elements(p_pairs) loop
    v_a := nullif(r->>'a','')::uuid;
    v_b := nullif(r->>'b','')::uuid;
    if v_a is null and v_b is null then continue; end if;
    if v_a is not null and not exists (select 1 from teams where id = v_a and event_id = p_event_id) then raise exception 'BAD_TEAM'; end if;
    if v_b is not null and not exists (select 1 from teams where id = v_b and event_id = p_event_id) then raise exception 'BAD_TEAM'; end if;
    select * into m from matches where event_id = p_event_id and bracket_key = (r->>'key') for update;
    if not found then raise exception 'NO_BRACKET_SLOT'; end if;
    if m.status = 'finished' then raise exception 'SLOT_ALREADY_PLAYED'; end if;
    if v_a is null or v_b is null then
      update matches set team_a_id = coalesce(v_a, v_b), team_b_id = null,
             status = 'finished', winner_id = coalesce(v_a, v_b), finished_at = now() where id = m.id;
      v_byes := v_byes + 1;
    else
      update matches set team_a_id = v_a, team_b_id = v_b where id = m.id;
      v_filled := v_filled + 1;
    end if;
  end loop;

  update events set bracket_seeded_at = now() where id = p_event_id;
  insert into audit_log (competition_id, actor, action, detail)
  values (c, 'court', 'seed_bracket', jsonb_build_object('event_id', p_event_id, 'matches', v_filled, 'byes', v_byes, 'auto', true));
  return jsonb_build_object('ok', true, 'matches', v_filled, 'byes', v_byes);
end $$;
grant execute on function court_seed_bracket(text, uuid, jsonb) to anon, authenticated;
