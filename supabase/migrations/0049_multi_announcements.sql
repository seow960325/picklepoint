-- =====================================================================
-- PicklePoint migration 0049: up to 3 announcements at the same time.
-- Each stays on the front page until the organiser deletes it.
-- Run AFTER 0044.
-- =====================================================================
alter table events add column if not exists announcements jsonb not null default '[]'::jsonb;

-- carry over the single pinned message of 0044
update events set
  announcements = jsonb_build_array(jsonb_build_object('id', gen_random_uuid()::text, 'text', announcement, 'at', coalesce(announce_at, now()))),
  announcement = null, announce_at = null
 where announcement is not null and announcements = '[]'::jsonb;

create or replace function admin_add_announcement(p_token text, p_event_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; t text := nullif(trim(coalesce(p_text, '')), ''); cur jsonb;
begin
  c := _require_admin(p_token);
  if t is null then raise exception 'EMPTY'; end if;
  if length(t) > 400 then raise exception 'TOO_LONG'; end if;
  select announcements into cur from events where id = p_event_id and competition_id = c for update;
  if not found then raise exception 'NO_EVENT'; end if;
  if jsonb_array_length(cur) >= 3 then raise exception 'MAX_3'; end if;
  update events set announcements = cur || jsonb_build_array(
    jsonb_build_object('id', gen_random_uuid()::text, 'text', t, 'at', now()))
   where id = p_event_id;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_add_announcement(text, uuid, text) to anon, authenticated;

create or replace function admin_delete_announcement(p_token text, p_event_id uuid, p_id text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid;
begin
  c := _require_admin(p_token);
  update events set announcements = coalesce((
      select jsonb_agg(x) from jsonb_array_elements(announcements) x where x->>'id' <> p_id), '[]'::jsonb)
   where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_delete_announcement(text, uuid, text) to anon, authenticated;
