-- =====================================================================
-- PicklePoint migration 0014: PIN brute-force lockout
--
-- admin_pin and scorer_pin are 4-digit numeric PINs (10,000 combos) with
-- no throttling, so an anon caller could script through admin_login /
-- unlock_court / admin_override until one hit. This adds a simple
-- per-target lockout: 5 wrong PINs in a row locks that competition
-- (admin) or court (scorer) for 60 seconds before another guess is
-- accepted. A correct PIN resets the counter.
-- =====================================================================

alter table competitions add column if not exists admin_fail_count int not null default 0;
alter table competitions add column if not exists admin_locked_until timestamptz;
alter table courts       add column if not exists scorer_fail_count int not null default 0;
alter table courts       add column if not exists scorer_locked_until timestamptz;

-- ------------------------------------------------------------- admin_login
create or replace function admin_login(p_code text, p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_id uuid; v_locked timestamptz; t text; begin
  select id, admin_locked_until into v_id, v_locked from competitions
   where upper(code) = upper(trim(p_code));
  if v_id is null then raise exception 'BAD_PIN'; end if;
  if v_locked is not null and v_locked > now() then raise exception 'LOCKED'; end if;

  if not exists (select 1 from competitions where id = v_id and admin_pin = trim(p_pin)) then
    update competitions set
      admin_fail_count = admin_fail_count + 1,
      admin_locked_until = case when admin_fail_count + 1 >= 5 then now() + interval '60 seconds' else admin_locked_until end,
      admin_fail_count = case when admin_fail_count + 1 >= 5 then 0 else admin_fail_count + 1 end
    where id = v_id;
    raise exception 'BAD_PIN';
  end if;

  update competitions set admin_fail_count = 0, admin_locked_until = null where id = v_id;
  insert into admin_sessions (competition_id) values (v_id) returning token into t;
  return t;
end $$;

-- ------------------------------------------------------------- unlock_court
create or replace function unlock_court(p_court_id uuid, p_pin text, p_device_id text default null)
returns text language plpgsql security definer set search_path = public as $$
declare v_locked timestamptz; t text; begin
  select scorer_locked_until into v_locked from courts where id = p_court_id;
  if v_locked is not null and v_locked > now() then raise exception 'LOCKED'; end if;

  if not exists (select 1 from courts where id = p_court_id and scorer_pin = trim(p_pin)) then
    update courts set
      scorer_fail_count = scorer_fail_count + 1,
      scorer_locked_until = case when scorer_fail_count + 1 >= 5 then now() + interval '60 seconds' else scorer_locked_until end,
      scorer_fail_count = case when scorer_fail_count + 1 >= 5 then 0 else scorer_fail_count + 1 end
    where id = p_court_id;
    raise exception 'BAD_PIN';
  end if;

  update courts set scorer_fail_count = 0, scorer_locked_until = null where id = p_court_id;
  insert into court_sessions (court_id, device_id) values (p_court_id, p_device_id)
  returning token into t;
  return t;
end $$;

-- ------------------------------------------------------------- admin_override
-- (uses the same admin_fail_count/admin_locked_until as admin_login, keyed
-- off the competition the match belongs to)
create or replace function admin_override(
  p_match_id uuid, p_admin_pin text, p_score_a int, p_score_b int)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_comp uuid; v_locked timestamptz; begin
  select c.id, c.admin_locked_until into v_comp, v_locked
    from matches mm join events e on e.id = mm.event_id
    join competitions c on c.id = e.competition_id
   where mm.id = p_match_id;
  if v_comp is null then raise exception 'NO_MATCH'; end if;
  if v_locked is not null and v_locked > now() then raise exception 'LOCKED'; end if;

  if not exists (select 1 from competitions where id = v_comp and admin_pin = trim(p_admin_pin)) then
    update competitions set
      admin_fail_count = admin_fail_count + 1,
      admin_locked_until = case when admin_fail_count + 1 >= 5 then now() + interval '60 seconds' else admin_locked_until end,
      admin_fail_count = case when admin_fail_count + 1 >= 5 then 0 else admin_fail_count + 1 end
    where id = v_comp;
    raise exception 'BAD_PIN';
  end if;

  update competitions set admin_fail_count = 0, admin_locked_until = null where id = v_comp;

  update matches set score_a = p_score_a, score_b = p_score_b
   where id = p_match_id returning * into m;

  insert into audit_log (competition_id, actor, action, detail)
  values (v_comp, 'admin', 'override_score',
          jsonb_build_object('match_id', p_match_id, 'score_a', p_score_a, 'score_b', p_score_b));
  return to_jsonb(m);
end $$;
