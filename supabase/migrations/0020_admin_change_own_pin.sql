-- =====================================================================
-- PicklePoint migration 0020: let admins change their own admin PIN
--
-- Mirrors admin_set_court_pin: 4-digit check, then update. Other admin
-- sessions on the same competition are logged out (their token deleted)
-- so a lost/shared PIN can be rotated away from; the session making
-- this call keeps working so the admin isn't kicked out mid-edit.
-- =====================================================================

create or replace function admin_set_admin_pin(p_token text, p_pin text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_pin !~ '^[0-9]{4}$' then raise exception 'PIN_MUST_BE_4_DIGITS'; end if;
  update competitions set admin_pin = p_pin where id = c;
  delete from admin_sessions where competition_id = c and token <> p_token;
  return jsonb_build_object('ok', true);
end $$;

grant execute on function admin_set_admin_pin(text, text) to anon, authenticated;
