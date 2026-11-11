-- =====================================================================
-- PicklePoint 0047 (YC26 set-up, safe to re-run)
--   1. Mega Subang logo
--   2. Admin PIN 0000 for the YC26 categories only (MC26 untouched)
--   3. Pickleball courts: PBMD = 2 courts, PBXD = 1 court
--   4. Scorer PINs by sport (badminton 0001, captain ball 0002, pickleball 0003), unlock
-- After running: Admin > Schedule > regenerate for PBMD and PBXD.
-- =====================================================================
update teams set logo = '/logos/subang.png'
 where name ilike 'Mega Subang%'
   and event_id in (select e.id from events e join competitions c on c.id = e.competition_id
                     where c.code in ('YC26','BMMD','BMXD','PBMD','PBXD'));

update competitions set admin_pin = '0000'
 where code in ('YC26','BMMD','BMXD','PBMD','PBXD');

do $$
declare r record; want int; ids uuid[]; i int;
begin
  for r in select c.id, c.code from competitions c where c.code in ('PBMD','PBXD') loop
    want := case r.code when 'PBMD' then 2 else 1 end;
    -- games lose their court; the schedule is regenerated afterwards
    update matches set court_id = null
     where court_id in (select id from courts where competition_id = r.id and number > want);
    delete from courts where competition_id = r.id and number > want;
    for i in 1..want loop
      insert into courts (competition_id, number, label, sport)
      select r.id, i, 'Court ' || i, 'pickleball'
       where not exists (select 1 from courts where competition_id = r.id and number = i);
    end loop;
  end loop;
end $$;

update courts set scorer_pin = case sport when 'badminton' then '0001' when 'captainball' then '0002' else '0003' end,
                  scorer_fail_count = 0, scorer_locked_until = null
 where competition_id in (select id from competitions where code in ('YC26','BMMD','BMXD','PBMD','PBXD'));
