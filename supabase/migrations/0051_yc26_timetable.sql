-- =====================================================================
-- PicklePoint 0051: YC26 printed timetable (12 Nov 2026 plan).
--  * courts get the real venue numbers (badminton men's 2-5, mixed 6-7; pickleball men's 2-3, mixed 1)
--  * group games are played twice, with a printed slot, court and play order (scripts/yc26-plan.mjs)
--  * Captain Ball court is shown as Court 2
-- Run BEFORE any group game is played. It stops with an error (and changes nothing) if a
-- category does not have the group sizes below. After this, do NOT press "Regenerate schedule":
-- use the random group draw (fixtures and times stay).
-- =====================================================================
begin;

-- guard BMMD: group sizes must be A:4,B:4,C:3,D:3
select 1 / (case when (select string_agg(pool || ':' || n, ',' order by pool) from (select t.pool, count(*) n from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code = 'BMMD' group by t.pool) q) = 'A:4,B:4,C:3,D:3' then 1 else 0 end) as group_sizes_ok_BMMD;
-- guard BMXD: group sizes must be A:3,B:3
select 1 / (case when (select string_agg(pool || ':' || n, ',' order by pool) from (select t.pool, count(*) n from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code = 'BMXD' group by t.pool) q) = 'A:3,B:3' then 1 else 0 end) as group_sizes_ok_BMXD;
-- guard PBMD: group sizes must be A:4,B:4
select 1 / (case when (select string_agg(pool || ':' || n, ',' order by pool) from (select t.pool, count(*) n from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code = 'PBMD' group by t.pool) q) = 'A:4,B:4' then 1 else 0 end) as group_sizes_ok_PBMD;
-- guard PBXD: group sizes must be A:4
select 1 / (case when (select string_agg(pool || ':' || n, ',' order by pool) from (select t.pool, count(*) n from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code = 'PBXD' group by t.pool) q) = 'A:4' then 1 else 0 end) as group_sizes_ok_PBXD;

-- old group games first (courts are renumbered next), then courts: real numbers
delete from matches m using events e, competitions c
 where m.event_id = e.id and e.competition_id = c.id and c.code in ('BMMD','BMXD','PBMD','PBXD') and m.bracket_key is null and m.status = 'scheduled';
update courts set number = number + 100 where competition_id in (select id from competitions where code in ('BMMD','BMXD','PBMD','PBXD'));
update courts x set number = q.n, label = 'Court ' || q.n, sport = 'badminton'
  from (select id, (array[2,3,4,5])[row_number() over (order by number)] as n from courts
         where competition_id = (select id from competitions where code = 'BMMD')) q
 where x.id = q.id and q.n is not null;
delete from courts where competition_id = (select id from competitions where code = 'BMMD') and number >= 100;
insert into courts (competition_id, number, label, sport)
select (select id from competitions where code = 'BMMD'), n, 'Court ' || n, 'badminton' from unnest(array[2,3,4,5]) as n
 where not exists (select 1 from courts where competition_id = (select id from competitions where code = 'BMMD') and number = n);
update courts x set number = q.n, label = 'Court ' || q.n, sport = 'badminton'
  from (select id, (array[6,7])[row_number() over (order by number)] as n from courts
         where competition_id = (select id from competitions where code = 'BMXD')) q
 where x.id = q.id and q.n is not null;
delete from courts where competition_id = (select id from competitions where code = 'BMXD') and number >= 100;
insert into courts (competition_id, number, label, sport)
select (select id from competitions where code = 'BMXD'), n, 'Court ' || n, 'badminton' from unnest(array[6,7]) as n
 where not exists (select 1 from courts where competition_id = (select id from competitions where code = 'BMXD') and number = n);
update courts x set number = q.n, label = 'Court ' || q.n, sport = 'pickleball'
  from (select id, (array[2,3])[row_number() over (order by number)] as n from courts
         where competition_id = (select id from competitions where code = 'PBMD')) q
 where x.id = q.id and q.n is not null;
delete from courts where competition_id = (select id from competitions where code = 'PBMD') and number >= 100;
insert into courts (competition_id, number, label, sport)
select (select id from competitions where code = 'PBMD'), n, 'Court ' || n, 'pickleball' from unnest(array[2,3]) as n
 where not exists (select 1 from courts where competition_id = (select id from competitions where code = 'PBMD') and number = n);
update courts x set number = q.n, label = 'Court ' || q.n, sport = 'pickleball'
  from (select id, (array[1])[row_number() over (order by number)] as n from courts
         where competition_id = (select id from competitions where code = 'PBXD')) q
 where x.id = q.id and q.n is not null;
delete from courts where competition_id = (select id from competitions where code = 'PBXD') and number >= 100;
insert into courts (competition_id, number, label, sport)
select (select id from competitions where code = 'PBXD'), n, 'Court ' || n, 'pickleball' from unnest(array[1]) as n
 where not exists (select 1 from courts where competition_id = (select id from competitions where code = 'PBXD') and number = n);
update courts set scorer_pin = case sport when 'badminton' then '0001' else '0003' end, scorer_fail_count = 0, scorer_locked_until = null
 where competition_id in (select id from competitions where code in ('BMMD','BMXD','PBMD','PBXD'));
update courts set label = 'Court 2' where sport = 'captainball' and competition_id in (select id from competitions where code = 'YC26');

-- events: pairs meet twice, shared queue in printed order
update events set legs = 2, court_dispatch = 'pool', pool_strict = true
 where format = 'groups_ko' and competition_id in (select id from competitions where code in ('BMMD','BMXD','PBMD','PBXD'));


-- group games: printed slot / court / order
with sched(code, pool, i, j, slot, court, seq) as (values
  ('BMMD','A',1,2,1,2,1),
  ('BMMD','A',3,4,1,3,2),
  ('BMMD','B',1,2,1,4,3),
  ('BMMD','B',3,4,1,5,4),
  ('BMMD','A',2,3,2,2,5),
  ('BMMD','B',1,4,2,3,6),
  ('BMMD','C',2,3,2,4,7),
  ('BMMD','D',2,3,2,5,8),
  ('BMMD','A',1,4,3,2,9),
  ('BMMD','B',1,3,3,3,10),
  ('BMMD','B',2,4,3,4,11),
  ('BMMD','D',1,3,3,5,12),
  ('BMMD','A',1,3,4,2,13),
  ('BMMD','A',2,4,4,3,14),
  ('BMMD','C',2,3,4,4,15),
  ('BMMD','D',2,3,4,5,16),
  ('BMMD','B',1,4,5,2,17),
  ('BMMD','B',2,3,5,3,18),
  ('BMMD','C',1,3,5,4,19),
  ('BMMD','D',1,3,5,5,20),
  ('BMMD','A',1,2,6,2,21),
  ('BMMD','A',3,4,6,3,22),
  ('BMMD','C',1,2,6,4,23),
  ('BMMD','D',1,2,6,5,24),
  ('BMMD','A',2,3,7,2,25),
  ('BMMD','B',1,2,7,3,26),
  ('BMMD','B',3,4,7,4,27),
  ('BMMD','C',1,3,7,5,28),
  ('BMMD','A',1,4,8,2,29),
  ('BMMD','B',2,3,8,3,30),
  ('BMMD','C',1,2,8,4,31),
  ('BMMD','D',1,2,8,5,32),
  ('BMMD','A',2,4,9,2,33),
  ('BMMD','A',1,3,9,3,34),
  ('BMMD','B',2,4,9,4,35),
  ('BMMD','B',1,3,9,5,36),
  ('BMXD','A',1,2,1,6,1),
  ('BMXD','B',1,2,1,7,2),
  ('BMXD','A',1,3,2,6,3),
  ('BMXD','B',1,3,2,7,4),
  ('BMXD','A',2,3,4,6,5),
  ('BMXD','B',2,3,4,7,6),
  ('BMXD','A',1,3,5,6,7),
  ('BMXD','B',1,3,5,7,8),
  ('BMXD','A',1,2,7,6,9),
  ('BMXD','B',1,2,7,7,10),
  ('BMXD','A',2,3,8,6,11),
  ('BMXD','B',2,3,8,7,12),
  ('PBMD','A',1,2,1,2,1),
  ('PBMD','B',1,2,1,3,2),
  ('PBMD','A',3,4,2,2,3),
  ('PBMD','B',3,4,2,3,4),
  ('PBMD','A',1,3,3,2,5),
  ('PBMD','B',1,3,3,3,6),
  ('PBMD','A',2,4,4,2,7),
  ('PBMD','B',2,4,4,3,8),
  ('PBMD','A',1,4,5,2,9),
  ('PBMD','B',1,4,5,3,10),
  ('PBMD','A',2,3,6,2,11),
  ('PBMD','B',2,3,6,3,12),
  ('PBMD','A',1,4,7,2,13),
  ('PBMD','B',1,4,7,3,14),
  ('PBMD','A',2,3,8,2,15),
  ('PBMD','B',2,3,8,3,16),
  ('PBMD','A',1,2,9,2,17),
  ('PBMD','B',1,2,9,3,18),
  ('PBMD','A',3,4,10,2,19),
  ('PBMD','B',3,4,10,3,20),
  ('PBMD','A',2,4,11,2,21),
  ('PBMD','B',2,4,11,3,22),
  ('PBMD','A',1,3,12,2,23),
  ('PBMD','B',1,3,12,3,24),
  ('PBXD','A',1,2,1,1,1),
  ('PBXD','A',3,4,2,1,2),
  ('PBXD','A',1,3,3,1,3),
  ('PBXD','A',2,4,4,1,4),
  ('PBXD','A',1,4,5,1,5),
  ('PBXD','A',2,3,6,1,6),
  ('PBXD','A',1,4,7,1,7),
  ('PBXD','A',2,3,8,1,8),
  ('PBXD','A',1,2,9,1,9),
  ('PBXD','A',3,4,10,1,10),
  ('PBXD','A',2,4,11,1,11),
  ('PBXD','A',1,3,12,1,12)
), pos as (
  select t.id, t.event_id, c.code, t.pool, row_number() over (partition by t.event_id, t.pool order by t.id) as p
    from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code in ('BMMD','BMXD','PBMD','PBXD')
)
insert into matches (event_id, round, sequence, team_a_id, team_b_id, status, home_court, slot)
select a.event_id, 'Group ' || s.pool || ' · Round robin', s.seq, a.id, b.id, 'scheduled', ct.id, s.slot
  from sched s
  join pos a on a.code = s.code and a.pool = s.pool and a.p = s.i
  join pos b on b.code = s.code and b.pool = s.pool and b.p = s.j
  join courts ct on ct.competition_id = (select id from competitions where code = s.code) and ct.number = s.court;

-- knockout courts by round (bracket keys are looked up from the bracket itself)
with plan(code, rnd, idx, court) as (values
  ('BMMD','Quarter-final',0,2),
  ('BMMD','Quarter-final',1,3),
  ('BMMD','Quarter-final',2,4),
  ('BMMD','Quarter-final',3,5),
  ('BMMD','Playoff',0,2),
  ('BMMD','Playoff',1,3),
  ('BMMD','Semi-final',0,2),
  ('BMMD','Semi-final',1,3),
  ('BMMD','Third place',0,2),
  ('BMMD','Final',0,2),
  ('BMXD','Quarter-final',0,6),
  ('BMXD','Quarter-final',1,7),
  ('BMXD','Playoff',0,6),
  ('BMXD','Playoff',1,7),
  ('BMXD','Semi-final',0,6),
  ('BMXD','Semi-final',1,7),
  ('BMXD','Third place',0,6),
  ('BMXD','Final',0,6),
  ('PBMD','Semi-final',0,2),
  ('PBMD','Semi-final',1,3),
  ('PBMD','Third place',0,2),
  ('PBMD','Final',0,2),
  ('PBXD','Third place',0,1),
  ('PBXD','Final',0,1)
), rk as (
  select m.event_id, c.code, m.bracket_key, m.round,
         row_number() over (partition by m.event_id, m.round order by m.sequence) - 1 as idx
    from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
   where m.bracket_key is not null and c.code in ('BMMD','BMXD','PBMD','PBXD')
), j as (
  select rk.event_id, rk.bracket_key, p.court from rk join plan p on p.code = rk.code and p.rnd = rk.round and p.idx = rk.idx
)
update events e set ko_court_plan = (select jsonb_object_agg(j.bracket_key, j.court) from j where j.event_id = e.id)
 where e.id in (select event_id from j);

-- first games on court
select _pool_dispatch(e.id) from events e join competitions c on c.id = e.competition_id where c.code in ('BMMD','BMXD','PBMD','PBXD') and e.court_dispatch = 'pool';

commit;

-- check: expected games 24 / 12 / 36 / 12
select c.code, count(*) filter (where m.bracket_key is null) as group_games, count(distinct m.slot) as slots
  from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id
 where c.code in ('BMMD','BMXD','PBMD','PBXD') group by c.code order by c.code;
