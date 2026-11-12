-- 0054: the YC26 admin can set the church of any player pair of the YC26 hub
-- (YC26, BMMD, BMXD, PBMD, PBXD); other codes still only their own teams.
create or replace function admin_set_team_church(p_token text, p_team_id uuid, p_church text, p_logo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; v_code text; codes text[]; begin
  c := _require_admin(p_token);
  select upper(code) into v_code from competitions where id = c;
  codes := case when v_code = 'YC26' then array['YC26','BMMD','BMXD','PBMD','PBXD'] else array[v_code] end;
  if p_logo is not null and p_logo not like '/logos/%' then raise exception 'BAD_LOGO'; end if;
  update teams t set church = nullif(trim(p_church), ''), logo = coalesce(p_logo, t.logo)
    from events e, competitions cc
   where t.id = p_team_id and e.id = t.event_id and cc.id = e.competition_id and upper(cc.code) = any(codes);
  if not found then raise exception 'NO_TEAM'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function admin_set_team_church(text, uuid, text, text) to anon, authenticated;
