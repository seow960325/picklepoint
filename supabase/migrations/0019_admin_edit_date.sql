-- =====================================================================
-- PicklePoint migration 0019: let admins edit the event date
--
-- admin_update_competition only ever accepted name + venue -- the date
-- picked at creation was permanent. This replaces it with a 4-arg
-- version that also takes the date (kept nullable so a missed value
-- doesn't wipe it). The old 3-arg overload is dropped explicitly so
-- there isn't a stale signature left behind.
-- =====================================================================

drop function if exists admin_update_competition(text, text, text);

create or replace function admin_update_competition(
  p_token text, p_name text, p_venue text, p_event_date date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  update competitions set
    name = coalesce(nullif(p_name,''), name),
    venue = p_venue,
    event_date = coalesce(p_event_date, event_date)
   where id = c;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_update_competition(text, text, text, date) to anon, authenticated;
