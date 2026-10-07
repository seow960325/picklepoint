-- 0029: self-registration follow-ups (MCMD / MCXD). Additive; self-contained
-- (works whether or not 0028 was run).
--  * same-phone edit: each registration keeps a secret token in team_reg
--    (separate table, no read policy, so the token never leaks via teams)
--  * AI picture usage log + hard daily cap (100 pictures per day, all codes)
--  * admin_ai_usage: today / total pictures for the admin's competition

create table if not exists team_reg (
  team_id    uuid primary key references teams(id) on delete cascade,
  token      text not null,
  reg_name   text,
  created_at timestamptz not null default now()
);
alter table team_reg enable row level security;

alter table team_reg add column if not exists reg_name text;

create table if not exists ai_gen_log (
  id         bigint generated always as identity primary key,
  code       text not null,
  created_at timestamptz not null default now()
);
alter table ai_gen_log enable row level security;

-- called by the server (api/cartoonize) BEFORE every Gemini request
create or replace function ai_gen_take(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_n int; v_code text := upper(btrim(coalesce(p_code, ''))); begin
  if not exists (select 1 from competitions c join events e on e.competition_id = c.id
                  where c.code = v_code and e.court_dispatch = 'pool') then
    raise exception 'REG_CLOSED';
  end if;
  perform pg_advisory_xact_lock(4242);
  select count(*) into v_n from ai_gen_log
   where (created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date;
  if v_n >= 100 then raise exception 'DAILY_LIMIT'; end if;
  insert into ai_gen_log (code) values (v_code);
  return jsonb_build_object('today', v_n + 1);
end $$;
grant execute on function ai_gen_take(text) to anon, authenticated;

create or replace function admin_ai_usage(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_code text; begin
  c := _require_admin(p_token);
  select code into v_code from competitions where id = c;
  return jsonb_build_object(
    'today', (select count(*) from ai_gen_log
               where (created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date),
    'today_code', (select count(*) from ai_gen_log where code = v_code
               and (created_at at time zone 'Asia/Kuala_Lumpur')::date = (now() at time zone 'Asia/Kuala_Lumpur')::date),
    'total_code', (select count(*) from ai_gen_log where code = v_code),
    'cap', 100);
end $$;
grant execute on function admin_ai_usage(text) to anon, authenticated;

drop function if exists register_team(text, text, text, text);

create or replace function register_team(p_code text, p_p1 text, p_p2 text, p_logo text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_ev uuid; v_t uuid; v_p1 text; v_p2 text; v_name text; v_edit boolean := false;
        v_reg text; v_cur text; begin
  v_p1 := left(btrim(regexp_replace(coalesce(p_p1, ''), '[[:cntrl:]]', '', 'g')), 14);
  v_p2 := left(btrim(regexp_replace(coalesce(p_p2, ''), '[[:cntrl:]]', '', 'g')), 14);
  -- one word each (the court shows "SIANG & DEREK" and must not overflow)
  if v_p1 !~ '^[^[:space:]]+$' or v_p2 !~ '^[^[:space:]]+$' then raise exception 'BAD_NAME'; end if;
  if p_logo is null or p_logo !~ '^data:image/png;base64,' or length(p_logo) > 400000 then
    raise exception 'BAD_LOGO';
  end if;
  if p_token is null or length(p_token) < 20 then raise exception 'BAD_TOKEN'; end if;

  select c.id, e.id into v_comp, v_ev
    from competitions c join events e on e.competition_id = c.id
   where c.code = upper(btrim(p_code)) and e.court_dispatch = 'pool'
   order by e.sort_order limit 1;
  if v_ev is null then raise exception 'REG_CLOSED'; end if;
  if exists (select 1 from matches
              where event_id = v_ev and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'REG_CLOSED';
  end if;

  -- same phone registering again -> edit its own slot
  select r.team_id, r.reg_name, t.name into v_t, v_reg, v_cur from team_reg r join teams t on t.id = r.team_id
   where r.token = p_token and t.event_id = v_ev limit 1;
  v_edit := v_t is not null;
  -- groups drawn (teams moved between slots) or organiser renamed it: hands off
  if v_edit and v_cur is distinct from v_reg then raise exception 'ASK_ORGANISER'; end if;

  v_name := v_p1 || ' & ' || v_p2;
  if exists (select 1 from teams where event_id = v_ev and lower(name) = lower(v_name)
              and id is distinct from v_t) then
    raise exception 'NAME_TAKEN';
  end if;

  if not v_edit then
    select t.id into v_t from teams t
     where t.event_id = v_ev and (t.logo is null or t.logo like 'data:image/svg%')
     order by t.id limit 1
     for update skip locked;
    if v_t is null then raise exception 'FULL'; end if;
    delete from team_reg where team_id = v_t;
    insert into team_reg (team_id, token, reg_name) values (v_t, p_token, v_name);
  else
    update team_reg set reg_name = v_name where team_id = v_t;
  end if;

  update teams set name = v_name, player1 = v_p1, player2 = v_p2, logo = p_logo where id = v_t;
  insert into audit_log (competition_id, actor, action, detail)
  values (v_comp, 'self-register', case when v_edit then 'register_edit' else 'register_team' end,
          jsonb_build_object('team_id', v_t, 'name', v_name));
  return jsonb_build_object('ok', true, 'team_id', v_t, 'name', v_name, 'edited', v_edit);
end $$;
grant execute on function register_team(text, text, text, text, text) to anon, authenticated;
