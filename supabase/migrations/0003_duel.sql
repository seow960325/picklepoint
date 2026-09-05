-- =====================================================================
-- PicklePoint migration 0003: duel format (two-side team battle,
-- e.g. Cambodia vs Malaysia) — each court hosts a 2v2 pod, every game's
-- winner scores one point for their SIDE rather than their team.
-- =====================================================================

alter table events add column if not exists side_a_name text;
alter table events add column if not exists side_b_name text;
alter table teams  add column if not exists side text check (side in ('A','B'));

alter table events drop constraint if exists events_format_check;
alter table events add constraint events_format_check
  check (format in ('round_robin','knockout','rr_then_ko','duel'));

-- ------------------------------------------------------- create_competition
-- Same signature as 0002 (single jsonb payload) — just teaches it the new
-- optional event.side_a_name / event.side_b_name / team.side fields.
create or replace function create_competition(p_payload jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  c competitions; e events; v_ev jsonb := p_payload->'event';
  court_ids uuid[]; team_ids uuid[];
  r jsonb; v_id uuid; v_tok text;
begin
  if coalesce(jsonb_array_length(p_payload->'teams'), 0) < 2 then
    raise exception 'NEED_TWO_TEAMS';
  end if;
  if coalesce(jsonb_array_length(p_payload->'courts'), 0) < 1 then
    raise exception 'NEED_ONE_COURT';
  end if;

  insert into competitions (name, venue, event_date, admin_pin, status)
  values (coalesce(nullif(p_payload->>'name',''), 'Untitled competition'),
          nullif(p_payload->>'venue',''),
          coalesce((p_payload->>'event_date')::date, current_date),
          coalesce(nullif(p_payload->>'admin_pin',''),
                   lpad((floor(random()*10000))::text, 4, '0')),
          'live')
  returning * into c;

  insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                      side_a_name, side_b_name)
  values (c.id,
          coalesce(nullif(v_ev->>'name',''), 'Main event'),
          coalesce(nullif(v_ev->>'format',''), 'round_robin'),
          coalesce((v_ev->>'target_score')::int, 15),
          coalesce((v_ev->>'win_by')::int, 2),
          coalesce((v_ev->>'cap')::int, 17),
          coalesce((v_ev->>'switch_at')::int, 8),
          nullif(v_ev->>'side_a_name',''),
          nullif(v_ev->>'side_b_name',''))
  returning * into e;

  for r in select * from jsonb_array_elements(p_payload->'courts') loop
    insert into courts (competition_id, number, label, scorer_pin)
    values (c.id, (r->>'number')::int, nullif(r->>'label',''),
            coalesce(nullif(r->>'scorer_pin',''),
                     lpad((floor(random()*10000))::text, 4, '0')))
    returning id into v_id;
    court_ids := court_ids || v_id;
  end loop;

  for r in select * from jsonb_array_elements(p_payload->'teams') loop
    insert into teams (event_id, name, pool, side, player1, player2)
    values (e.id, r->>'name', nullif(r->>'pool',''), nullif(r->>'side',''),
            nullif(r->>'player1',''), nullif(r->>'player2',''))
    returning id into v_id;
    team_ids := team_ids || v_id;
  end loop;

  for r in select * from jsonb_array_elements(coalesce(p_payload->'matches','[]'::jsonb)) loop
    insert into matches (event_id, court_id, round, sequence,
                         team_a_id, team_b_id, status)
    values (e.id,
            court_ids[(r->>'court')::int + 1],
            coalesce(nullif(r->>'round',''), 'Group'),
            (r->>'sequence')::int,
            team_ids[(r->>'a')::int + 1],
            team_ids[(r->>'b')::int + 1],
            'scheduled');
  end loop;

  update matches m set status = 'live'
   where m.event_id = e.id
     and m.id in (
       select distinct on (court_id) id from matches
        where event_id = e.id order by court_id, sequence);

  insert into admin_sessions (competition_id) values (c.id) returning token into v_tok;

  return jsonb_build_object(
    'code', c.code,
    'admin_pin', c.admin_pin,
    'admin_token', v_tok,
    'competition_id', c.id,
    'courts', (select jsonb_agg(jsonb_build_object('number', number, 'scorer_pin', scorer_pin)
                                order by number) from courts where competition_id = c.id)
  );
end $$;

-- ------------------------------------------------------------ admin_update_event
-- Adds optional side_a_name / side_b_name so Settings can rename the two sides.
drop function if exists admin_update_event(text, uuid, text, int, int, int, int);

create or replace function admin_update_event(
  p_token text, p_event_id uuid, p_name text,
  p_target int, p_win_by int, p_cap int, p_switch_at int,
  p_side_a_name text default null, p_side_b_name text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_cap < p_target + p_win_by - 1 then raise exception 'CAP_TOO_LOW'; end if;
  if p_switch_at < 1 or p_switch_at > p_target then raise exception 'BAD_SWITCH_AT'; end if;

  update events set
    name = coalesce(nullif(p_name,''), name),
    target_score = p_target, win_by = p_win_by, cap = p_cap, switch_at = p_switch_at,
    side_a_name = coalesce(nullif(p_side_a_name,''), side_a_name),
    side_b_name = coalesce(nullif(p_side_b_name,''), side_b_name)
  where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $$;

-- ------------------------------------------------------------- admin_upsert_team
-- Adds optional side ('A'/'B') so a duel event's teams can be reassigned.
drop function if exists admin_upsert_team(text, uuid, uuid, text, text, text, text);

create or replace function admin_upsert_team(
  p_token text, p_event_id uuid, p_team_id uuid,
  p_name text, p_pool text, p_side text, p_p1 text, p_p2 text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_id uuid; begin
  c := _require_admin(p_token);
  if not exists (select 1 from events where id = p_event_id and competition_id = c) then
    raise exception 'NO_EVENT';
  end if;
  if p_side is not null and p_side not in ('A','B') then raise exception 'BAD_SIDE'; end if;

  if p_team_id is null then
    insert into teams (event_id, name, pool, side, player1, player2)
    values (p_event_id, p_name, nullif(p_pool,''), p_side, nullif(p_p1,''), nullif(p_p2,''))
    returning id into v_id;
  else
    update teams set name = p_name, pool = nullif(p_pool,''), side = coalesce(p_side, side),
                     player1 = nullif(p_p1,''), player2 = nullif(p_p2,'')
     where id = p_team_id and event_id = p_event_id
    returning id into v_id;
    if v_id is null then raise exception 'NO_TEAM'; end if;
  end if;
  return jsonb_build_object('id', v_id);
end $$;

grant execute on function admin_update_event(text, uuid, text, int, int, int, int, text, text) to anon, authenticated;
grant execute on function admin_upsert_team(text, uuid, uuid, text, text, text, text, text)     to anon, authenticated;
