-- Test copy of MC26 (Men's MCMD -> TESTMD, Mixed MCXD -> TESTXD), hidden page /c/TESTMC.
-- Copies teams, groups, timetable, bracket and settings as they are now. The real MC26 is not touched.
-- Run again any time to get a fresh copy.
begin;

delete from competitions where code in ('TESTMD', 'TESTXD');

create temp table idmap (old uuid primary key, new uuid not null default gen_random_uuid()) on commit drop;
insert into idmap (old)
select c.id from competitions c where c.code in ('MCMD', 'MCXD')
union all select e.id from events e join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD')
union all select k.id from courts k join competitions c on c.id = k.competition_id where c.code in ('MCMD', 'MCXD')
union all select t.id from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD')
union all select m.id from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD');

create function pg_temp.nm(x uuid) returns uuid language sql stable as
$$ select coalesce((select new from idmap where old = x), x) $$;

insert into competitions
select (jsonb_populate_record(null::competitions, to_jsonb(c) || jsonb_build_object(
  'id', pg_temp.nm(c.id), 'code', case c.code when 'MCMD' then 'TESTMD' else 'TESTXD' end, 'name', 'TEST ' || c.name))).*
from competitions c where c.code in ('MCMD', 'MCXD');

insert into events
select (jsonb_populate_record(null::events, to_jsonb(e) || jsonb_build_object(
  'id', pg_temp.nm(e.id), 'competition_id', pg_temp.nm(e.competition_id),
  'tv_partner', case e.tv_partner when 'MCMD' then 'TESTMD' when 'MCXD' then 'TESTXD' else e.tv_partner end))).*
from events e join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD');

insert into courts
select (jsonb_populate_record(null::courts, to_jsonb(k) || jsonb_build_object(
  'id', pg_temp.nm(k.id), 'competition_id', pg_temp.nm(k.competition_id)))).*
from courts k join competitions c on c.id = k.competition_id where c.code in ('MCMD', 'MCXD');

insert into teams
select (jsonb_populate_record(null::teams, to_jsonb(t) || jsonb_build_object(
  'id', pg_temp.nm(t.id), 'event_id', pg_temp.nm(t.event_id)))).*
from teams t join events e on e.id = t.event_id join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD');

insert into matches
select (jsonb_populate_record(null::matches, to_jsonb(m) || jsonb_build_object(
  'id', pg_temp.nm(m.id), 'event_id', pg_temp.nm(m.event_id),
  'court_id', pg_temp.nm(m.court_id), 'home_court', pg_temp.nm(m.home_court),
  'plan_court', pg_temp.nm((to_jsonb(m) ->> 'plan_court')::uuid),
  'team_a_id', pg_temp.nm(m.team_a_id), 'team_b_id', pg_temp.nm(m.team_b_id), 'winner_id', pg_temp.nm(m.winner_id),
  'next_match_id', pg_temp.nm(m.next_match_id), 'loser_match_id', pg_temp.nm(m.loser_match_id)))).*
from matches m join events e on e.id = m.event_id join competitions c on c.id = e.competition_id where c.code in ('MCMD', 'MCXD');

commit;

select c.code, c.name, (select count(*) from teams t join events e on e.id = t.event_id where e.competition_id = c.id) as teams,
       (select count(*) from matches m join events e on e.id = m.event_id where e.competition_id = c.id) as games,
       (select count(*) from courts k where k.competition_id = c.id) as courts
  from competitions c where c.code in ('MCMD', 'MCXD', 'TESTMD', 'TESTXD') order by c.code;
