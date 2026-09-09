-- =====================================================================
-- PicklePoint migration 0017: freeze new-competition creation
--
-- A single switch in app_settings that, when on, blocks
-- create_competition / create_competition_v3 from inserting a new row
-- into competitions -- enforced with a BEFORE INSERT trigger on the
-- table itself, so it guards both creation functions (and any future
-- one) without touching their bodies. Existing competitions are
-- unaffected: joining, scoring and admin editing keep working.
-- =====================================================================

alter table app_settings add column if not exists frozen boolean not null default false;

create or replace function _block_if_frozen()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  if (select frozen from app_settings where id = true) then
    raise exception 'FROZEN';
  end if;
  return new;
end $$;

drop trigger if exists trg_block_if_frozen on competitions;
create trigger trg_block_if_frozen
  before insert on competitions
  for each row execute function _block_if_frozen();

create or replace function owner_get_settings(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  return jsonb_build_object('frozen', (select frozen from app_settings where id = true));
end $$;

create or replace function owner_set_frozen(p_token text, p_frozen boolean)
returns void language plpgsql security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  update app_settings set frozen = p_frozen where id = true;
end $$;

grant execute on function owner_get_settings(text)         to anon, authenticated;
grant execute on function owner_set_frozen(text, boolean)  to anon, authenticated;
