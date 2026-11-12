-- Announcements for a whole hub (YC26 set / MC26 set): one message shows on every category.
-- Stored on every event of every category competition of the hub; deleting removes it everywhere.
create or replace function admin_hub_announce(p_token text, p_codes text[], p_text text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; v_code text; t text := nullif(trim(coalesce(p_text, '')), ''); v_n int; v_item jsonb;
begin
  c := _require_admin(p_token);
  if t is null then raise exception 'EMPTY'; end if;
  if length(t) > 400 then raise exception 'TOO_LONG'; end if;
  select upper(code) into v_code from competitions where id = c;
  if not (v_code = any (select upper(x) from unnest(p_codes) x)) then raise exception 'NOT_IN_HUB'; end if;
  if exists (select 1 from unnest(p_codes) x where upper(x) not in ('YC26','BMMD','BMXD','PBMD','PBXD','MCMD','MCXD')) then
    raise exception 'BAD_CODES';
  end if;
  select count(distinct a->>'text') into v_n
    from events e, jsonb_array_elements(e.announcements) a where e.competition_id = c;
  if v_n >= 3 then raise exception 'MAX_3'; end if;
  v_item := jsonb_build_object('id', gen_random_uuid()::text, 'text', t, 'at', now());
  update events set announcements = announcements || jsonb_build_array(v_item)
   where competition_id in (select id from competitions where upper(code) in (select upper(x) from unnest(p_codes) x));
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_hub_announce(text, text[], text) to anon, authenticated;

create or replace function admin_hub_unannounce(p_token text, p_codes text[], p_text text)
returns jsonb language plpgsql security definer set search_path = public as $fn$
declare c uuid; v_code text;
begin
  c := _require_admin(p_token);
  select upper(code) into v_code from competitions where id = c;
  if not (v_code = any (select upper(x) from unnest(p_codes) x)) then raise exception 'NOT_IN_HUB'; end if;
  update events set announcements = coalesce((
      select jsonb_agg(a) from jsonb_array_elements(announcements) a where a->>'text' <> p_text), '[]'::jsonb),
      announcement = case when announcement = p_text then null else announcement end
   where competition_id in (select id from competitions where upper(code) in (select upper(x) from unnest(p_codes) x));
  return jsonb_build_object('ok', true);
end $fn$;
grant execute on function admin_hub_unannounce(text, text[], text) to anon, authenticated;

notify pgrst, 'reload schema';
