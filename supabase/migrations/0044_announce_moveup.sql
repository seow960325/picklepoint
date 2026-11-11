-- =====================================================================
-- PicklePoint migration 0044: organiser announcements + "move a game up"
-- with a red alert for the affected teams. Run AFTER 0043.
--   events.announcement / announce_at   pinned message above "My team"
--   matches.alert_at / alert_note       game was changed by the organiser;
--                                       the app shows it red until the game starts
-- =====================================================================
alter table events  add column if not exists announcement text;
alter table events  add column if not exists announce_at  timestamptz;
alter table matches add column if not exists alert_at   timestamptz;
alter table matches add column if not exists alert_note text;

-- empty text = un-pin (the message disappears from the front page)
create or replace function admin_set_announcement(p_token text, p_event_id uuid, p_text text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; t text := nullif(trim(coalesce(p_text, '')), '');
begin
  c := _require_admin(p_token);
  if t is not null and length(t) > 400 then raise exception 'TOO_LONG'; end if;
  update events set announcement = t, announce_at = case when t is null then null else now() end
   where id = p_event_id and competition_id = c;
  if not found then raise exception 'NO_EVENT'; end if;
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_set_announcement(text, uuid, text) to anon, authenticated;

-- Play this waiting group game next on a court. It swaps places (slot, running
-- order, home court) with the game that was first in line there, flags both
-- games so their teams see a red notice, and lets an idle court take it now.
create or replace function admin_move_up(p_token text, p_match_id uuid, p_court_id uuid default null)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; pick matches; ref matches; v_court uuid;
begin
  c := _require_admin(p_token);
  select * into pick from matches where id = p_match_id for update;
  if not found or not exists (select 1 from events e where e.id = pick.event_id and e.competition_id = c) then
    raise exception 'NO_MATCH';
  end if;
  if pick.status <> 'scheduled' or pick.court_id is not null then raise exception 'NOT_WAITING'; end if;
  if pick.bracket_key is not null then raise exception 'GROUP_ONLY'; end if;
  v_court := coalesce(p_court_id, pick.home_court);
  if v_court is null or not exists (select 1 from courts where id = v_court and competition_id = c) then
    raise exception 'BAD_COURT';
  end if;

  select * into ref from matches m
   where m.event_id = pick.event_id and m.id <> pick.id and m.bracket_key is null
     and m.status = 'scheduled' and m.court_id is null and m.home_court = v_court
   order by m.sequence limit 1 for update;

  if found and ref.sequence < pick.sequence then
    update matches set slot = pick.slot, sequence = pick.sequence, home_court = pick.home_court,
           alert_at = now(), alert_note = 'later' where id = ref.id;
    update matches set slot = ref.slot, sequence = ref.sequence where id = pick.id;
  end if;
  update matches set home_court = v_court, alert_at = now(), alert_note = 'up' where id = pick.id;
  perform _pool_dispatch(pick.event_id);
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_move_up(text, uuid, uuid) to anon, authenticated;

create or replace function admin_clear_alert(p_token text, p_match_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid;
begin
  c := _require_admin(p_token);
  update matches set alert_at = null, alert_note = null
   where id = p_match_id and event_id in (select id from events where competition_id = c);
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_clear_alert(text, uuid) to anon, authenticated;
