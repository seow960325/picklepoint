-- =====================================================================
-- PicklePoint 0053
--  1. YC26: each team plays for a church (Admin > Teams dropdown); medals count per church
--  2. clean-up after 0051: old group games that were already "live" were not removed
--     (they have no slot) - delete them and re-dispatch
-- =====================================================================
alter table public.teams add column if not exists church text;

update teams t set church = trim(regexp_replace(t.name, '\s+[A-Z]$', ''))
  from events e, competitions c
 where e.id = t.event_id and c.id = e.competition_id
   and c.code in ('YC26','BMMD','BMXD','PBMD','PBXD') and t.church is null
   and trim(regexp_replace(t.name, '\s+[A-Z]$', '')) in ('GMSJ','Kinrara','Mega','Mega Subang','Mega Suria','Permai','PJ State','Putra Prima');

create or replace function admin_set_team_church(p_token text, p_team_id uuid, p_church text, p_logo text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; begin
  c := _require_admin(p_token);
  if p_logo is not null and p_logo not like '/logos/%' then raise exception 'BAD_LOGO'; end if;
  update teams t set church = nullif(trim(p_church), ''), logo = coalesce(p_logo, t.logo)
    from events e
   where t.id = p_team_id and e.id = t.event_id and e.competition_id = c;
  if not found then raise exception 'NO_TEAM'; end if;
  return jsonb_build_object('ok', true);
end $$;
grant execute on function admin_set_team_church(text, uuid, text, text) to anon, authenticated;

-- clean-up of the old live group games left by 0051
delete from point_events where match_id in (
  select m.id from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
   where c.code in ('BMMD','BMXD','PBMD','PBXD') and m.bracket_key is null and m.slot is null and m.status <> 'finished');
delete from matches m using events e, competitions c
 where m.event_id = e.id and e.competition_id = c.id and c.code in ('BMMD','BMXD','PBMD','PBXD')
   and m.bracket_key is null and m.slot is null and m.status <> 'finished';
select _pool_dispatch(e.id) from events e join competitions c on c.id = e.competition_id
 where c.code in ('BMMD','BMXD','PBMD','PBXD') and e.court_dispatch = 'pool';

select c.code, count(*) filter (where m.bracket_key is null) as group_games, count(distinct m.slot) as slots
  from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
 where c.code in ('BMMD','BMXD','PBMD','PBXD') group by c.code order by c.code;
