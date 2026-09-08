-- 0013: optional team logo (base64 data URL). Additive + nullable; does not
-- touch any existing object except adding one column and one new function.
alter table public.teams add column if not exists logo text;

create or replace function admin_set_team_logo(p_token text, p_team_id uuid, p_logo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_logo is not null and length(p_logo) > 400000 then
    raise exception 'LOGO_TOO_LARGE';
  end if;
  update teams t set logo = p_logo
    from events e
   where t.id = p_team_id and e.id = t.event_id and e.competition_id = c;
  if not found then raise exception 'NO_TEAM'; end if;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_set_team_logo(text, uuid, text) to anon, authenticated;
