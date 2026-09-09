-- =====================================================================
-- PicklePoint migration 0015: owner console (see + delete competitions)
--
-- One master PIN, separate from every competition's own admin PIN, lets
-- you list every competition ever created and hard-delete the ones you
-- don't want (cascades to its events/teams/matches/scores). Same
-- 5-attempts/60-second lockout as the per-competition PINs.
--
-- CHANGE THE DEFAULT PIN BELOW before you rely on this — anyone who
-- guesses it can see and delete every competition in the database.
-- =====================================================================

create table app_settings (
  id             boolean primary key default true check (id),
  owner_pin      text not null,
  fail_count     int not null default 0,
  locked_until   timestamptz
);
alter table app_settings enable row level security;

-- starting PIN — change it right after this migration runs:
--   update app_settings set owner_pin = 'your-new-pin';
insert into app_settings (id, owner_pin) values (true, '778899')
  on conflict (id) do nothing;

create table owner_sessions (
  token      text primary key default encode(gen_random_bytes(24), 'hex'),
  created_at timestamptz not null default now(),
  expires_at timestamptz not null default now() + interval '2 hours'
);
alter table owner_sessions enable row level security;

create or replace function _require_owner(p_token text)
returns void language plpgsql stable security definer set search_path = public as $$
begin
  if not exists (select 1 from owner_sessions where token = p_token and expires_at > now()) then
    raise exception 'NOT_OWNER';
  end if;
end $$;

create or replace function owner_login(p_pin text)
returns text language plpgsql security definer set search_path = public as $$
declare v_locked timestamptz; v_pin text; t text; begin
  select owner_pin, locked_until into v_pin, v_locked from app_settings where id = true;
  if v_locked is not null and v_locked > now() then raise exception 'LOCKED'; end if;

  if v_pin is distinct from trim(p_pin) then
    update app_settings set
      fail_count = fail_count + 1,
      locked_until = case when fail_count + 1 >= 5 then now() + interval '60 seconds' else locked_until end,
      fail_count = case when fail_count + 1 >= 5 then 0 else fail_count + 1 end
    where id = true;
    raise exception 'BAD_PIN';
  end if;

  update app_settings set fail_count = 0, locked_until = null where id = true;
  insert into owner_sessions default values returning token into t;
  return t;
end $$;

create or replace function owner_list_competitions(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'venue', c.venue,
      'event_date', c.event_date, 'status', c.status, 'created_at', c.created_at,
      'team_count', (select count(*) from teams t where t.competition_id = c.id),
      'match_count', (select count(*) from matches m
                        join events e on e.id = m.event_id
                       where e.competition_id = c.id)
    ) order by c.created_at desc)
    from competitions c
  ), '[]'::jsonb);
end $$;

create or replace function owner_delete_competition(p_token text, p_competition_id uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  delete from competitions where id = p_competition_id;
end $$;

grant execute on function owner_login(text)                      to anon, authenticated;
grant execute on function owner_list_competitions(text)          to anon, authenticated;
grant execute on function owner_delete_competition(text, uuid)   to anon, authenticated;
