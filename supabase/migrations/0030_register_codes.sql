-- 0030: per-team 4-digit registration codes for MCMD / MCXD self-registration.
-- The organiser generates one random 4-digit code per team slot, hands one to
-- each team, and the team must type it on /register/<CODE> before uploading.
-- Admin sees which team used which code. Additive except register_team, which
-- gains a p_pin argument (the old 5-argument version is dropped so nobody can
-- bypass the codes).

create table if not exists reg_code (
  event_id   uuid not null references events(id) on delete cascade,
  pin        text not null,
  token      text,
  team_id    uuid references teams(id) on delete set null,
  team_name  text,
  claimed_at timestamptz,
  primary key (event_id, pin)
);
alter table reg_code enable row level security;

-- admin: top up to one code per team slot (idempotent, never changes existing codes)
create or replace function admin_gen_reg_codes(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_ev uuid; v_want int; v_have int; v_pin text; begin
  c := _require_admin(p_token);
  select e.id into v_ev from events e
   where e.competition_id = c and e.court_dispatch = 'pool' order by e.sort_order limit 1;
  if v_ev is null then raise exception 'NO_POOL_EVENT'; end if;
  select count(*) into v_want from teams where event_id = v_ev;
  select count(*) into v_have from reg_code where event_id = v_ev;
  if v_want > 9000 then v_want := 9000; end if;
  while v_have < v_want loop
    v_pin := (1000 + floor(random() * 9000))::int::text;
    insert into reg_code (event_id, pin) values (v_ev, v_pin) on conflict do nothing;
    if found then v_have := v_have + 1; end if;
  end loop;
  return jsonb_build_object('ok', true, 'count', v_have);
end $$;
grant execute on function admin_gen_reg_codes(text) to anon, authenticated;

-- admin: every code and who used it
create or replace function admin_reg_codes(p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_ev uuid; begin
  c := _require_admin(p_token);
  select e.id into v_ev from events e
   where e.competition_id = c and e.court_dispatch = 'pool' order by e.sort_order limit 1;
  if v_ev is null then return '[]'::jsonb; end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object('pin', pin, 'team', team_name, 'claimed', token is not null)
                     order by (token is null), claimed_at, pin)
      from reg_code where event_id = v_ev), '[]'::jsonb);
end $$;
grant execute on function admin_reg_codes(text) to anon, authenticated;

-- public: is this code valid and still free (or already mine)?
create or replace function register_check(p_code text, p_pin text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_ev uuid; v_tok text; begin
  select e.id into v_ev from competitions c join events e on e.competition_id = c.id
   where c.code = upper(btrim(p_code)) and e.court_dispatch = 'pool' order by e.sort_order limit 1;
  if v_ev is null then raise exception 'REG_CLOSED'; end if;
  select token into v_tok from reg_code where event_id = v_ev and pin = btrim(coalesce(p_pin, ''));
  if not found then raise exception 'BAD_PIN'; end if;
  if v_tok is not null and v_tok is distinct from p_token then raise exception 'PIN_USED'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function register_check(text, text, text) to anon, authenticated;

drop function if exists register_team(text, text, text, text, text);

create or replace function register_team(p_code text, p_p1 text, p_p2 text, p_logo text, p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_ev uuid; v_t uuid; v_p1 text; v_p2 text; v_name text; v_edit boolean := false;
        v_reg text; v_cur text; v_ptok text; v_pin text := btrim(coalesce(p_pin, '')); begin
  v_p1 := left(btrim(regexp_replace(coalesce(p_p1, ''), '[[:cntrl:]]', '', 'g')), 14);
  v_p2 := left(btrim(regexp_replace(coalesce(p_p2, ''), '[[:cntrl:]]', '', 'g')), 14);
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

  -- the team's own 4-digit code
  select token into v_ptok from reg_code where event_id = v_ev and pin = v_pin;
  if not found then raise exception 'BAD_PIN'; end if;
  if v_ptok is not null and v_ptok is distinct from p_token then raise exception 'PIN_USED'; end if;
  if exists (select 1 from reg_code where event_id = v_ev and token = p_token and pin <> v_pin) then
    raise exception 'PIN_USED';
  end if;

  select r.team_id, r.reg_name, t.name into v_t, v_reg, v_cur from team_reg r join teams t on t.id = r.team_id
   where r.token = p_token and t.event_id = v_ev limit 1;
  v_edit := v_t is not null;
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
  update reg_code set token = p_token, team_id = v_t, team_name = v_name, claimed_at = coalesce(claimed_at, now())
   where event_id = v_ev and pin = v_pin;
  insert into audit_log (competition_id, actor, action, detail)
  values (v_comp, 'self-register', case when v_edit then 'register_edit' else 'register_team' end,
          jsonb_build_object('team_id', v_t, 'name', v_name, 'pin', v_pin));
  return jsonb_build_object('ok', true, 'team_id', v_t, 'name', v_name, 'edited', v_edit);
end $$;
grant execute on function register_team(text, text, text, text, text, text) to anon, authenticated;
