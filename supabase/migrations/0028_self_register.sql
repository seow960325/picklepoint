-- 0028: public self-registration for shared-queue events (MCMD / MCXD).
-- A player pair submits two first names + the generated team picture and is
-- put into the next UNCLAIMED team slot (no logo yet, or still the placeholder
-- flag). Closed automatically when every slot is taken or the first point is
-- scored. Additive: one new function, nothing existing is changed.
create or replace function register_team(p_code text, p_p1 text, p_p2 text, p_logo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_comp uuid; v_ev uuid; v_t uuid; v_p1 text; v_p2 text; v_name text; begin
  v_p1 := left(btrim(regexp_replace(coalesce(p_p1, ''), '[[:cntrl:]]', '', 'g')), 14);
  v_p2 := left(btrim(regexp_replace(coalesce(p_p2, ''), '[[:cntrl:]]', '', 'g')), 14);
  -- one word each (the court shows "SIANG & DEREK" and must not overflow)
  if v_p1 !~ '^[^[:space:]]+$' or v_p2 !~ '^[^[:space:]]+$' then raise exception 'BAD_NAME'; end if;
  if p_logo is null or p_logo !~ '^data:image/png;base64,' or length(p_logo) > 400000 then
    raise exception 'BAD_LOGO';
  end if;

  select c.id, e.id into v_comp, v_ev
    from competitions c join events e on e.competition_id = c.id
   where c.code = upper(btrim(p_code)) and e.court_dispatch = 'pool'
   order by e.sort_order limit 1;
  if v_ev is null then raise exception 'REG_CLOSED'; end if;
  if exists (select 1 from matches
              where event_id = v_ev and (status = 'finished' or score_a > 0 or score_b > 0)) then
    raise exception 'REG_CLOSED';
  end if;

  v_name := v_p1 || ' & ' || v_p2;
  if exists (select 1 from teams where event_id = v_ev and lower(name) = lower(v_name)) then
    raise exception 'NAME_TAKEN';
  end if;

  select t.id into v_t from teams t
   where t.event_id = v_ev and (t.logo is null or t.logo like 'data:image/svg%')
   order by t.id limit 1
   for update skip locked;
  if v_t is null then raise exception 'FULL'; end if;

  update teams set name = v_name, player1 = v_p1, player2 = v_p2, logo = p_logo where id = v_t;
  insert into audit_log (competition_id, actor, action, detail)
  values (v_comp, 'self-register', 'register_team', jsonb_build_object('team_id', v_t, 'name', v_name));
  return jsonb_build_object('ok', true, 'team_id', v_t, 'name', v_name);
end $$;

grant execute on function register_team(text, text, text, text) to anon, authenticated;
