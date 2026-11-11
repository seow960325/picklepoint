-- 0044: YC2626 -> YC26, captain ball rules, church team names + logos (YC26 + BMMD/BMXD/PBMD/PBXD only)
update competitions set code = 'YC26', name = replace(name, 'YC2626', 'YC26') where code = 'YC2626';

-- captain ball: ONE 60 s time-out per team for the whole game, extra time 3 min, then shoot-out (5 shots each)
update events
   set cb_rules = coalesce(cb_rules, '{}'::jsonb) || '{"to_h1":1,"to_h2":0,"to_sec":60,"extra_min":3,"so_shots":5}'::jsonb
 where sport = 'captainball';

-- short church name + A/B/C/D only when a church has several teams in the SAME category; logo = /logos/<file>.png
with t as (
  select tm.id, tm.event_id, tm.name,
         case
           when upper(tm.name) like '%SURIA%'  then 'Mega Suria'
           when upper(tm.name) like '%SUBANG%' then 'Mega Subang'
           when upper(tm.name) like '%PJ%'     then 'PJ State'
           when upper(tm.name) like '%PERMAI%' then 'Permai'
           when upper(tm.name) like '%GMSJ%'   then 'GMSJ'
           when upper(tm.name) like '%PUTRA%'  then 'Putra Prima'
           when upper(tm.name) like '%KINRARA%' or upper(tm.name) like '%BKCMC%' then 'Kinrara'
           when upper(tm.name) like '%MEGA%'   then 'Mega'
         end as church
    from teams tm
    join events e on e.id = tm.event_id
    join competitions c on c.id = e.competition_id
   where c.code in ('YC26', 'BMMD', 'BMXD', 'PBMD', 'PBXD')
), n as (
  select t.*,
         count(*)     over (partition by event_id, church) as cnt,
         row_number() over (partition by event_id, church order by name, id) as rn
    from t where church is not null
)
update teams x
   set name = n.church || case when n.cnt > 1 then ' ' || chr(64 + n.rn::int) else '' end,
       logo = case n.church
                when 'Mega' then '/logos/mega.png'
                when 'Mega Suria' then '/logos/suria.png'
                when 'PJ State' then '/logos/pjstate.png'
                when 'Permai' then '/logos/permai.png'
                when 'GMSJ' then '/logos/gmsj.png'
                when 'Putra Prima' then '/logos/putraprima.png'
                when 'Kinrara' then '/logos/kinrara.png'
                else x.logo end
  from n where x.id = n.id;

select c.code, e.name as category, tm.name, tm.logo is not null as has_logo
  from teams tm join events e on e.id = tm.event_id join competitions c on c.id = e.competition_id
 where c.code in ('YC26', 'BMMD', 'BMXD', 'PBMD', 'PBXD')
 order by c.code, e.name, tm.name;
