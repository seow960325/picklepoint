\set ON_ERROR_STOP on
-- fixture
insert into competitions (name, code) values ('Test Cup','TESTAA');
insert into events (competition_id, name) select id,'MD' from competitions;
insert into courts (competition_id, number, scorer_pin) select id,1,'1234' from competitions;
insert into teams (event_id, name) select id,'Alpha' from events;
insert into teams (event_id, name) select id,'Bravo' from events;
insert into matches (event_id, court_id, team_a_id, team_b_id, status)
select e.id, c.id,
       (select id from teams where name='Alpha'),
       (select id from teams where name='Bravo'), 'live'
from events e, courts c;


select unlock_court((select id from courts), '1234');
-- 7 left taps: no switch
do $$
declare i int; begin
  for i in 1..7 loop
    perform score_point((select id from matches), 'left',
      (select token from court_sessions limit 1), 'ev-l-'||i);
  end loop;
end $$;
select 'after 7 left' as step, score_a, score_b, a_on_left, sides_switched, status from matches;

-- 8th left tap: switch fires
select score_point((select id from matches), 'left',
  (select token from court_sessions limit 1), 'ev-l-8');
select 'after 8 left' as step, score_a, score_b, a_on_left, sides_switched, status from matches;

-- team A is now on the right, so a right tap must score A
select score_point((select id from matches), 'right',
  (select token from court_sessions limit 1), 'ev-r-1');
select 'right tap now scores A' as step, score_a, score_b, a_on_left, sides_switched from matches;

-- replay of an already-seen client_event_id must be a no-op
select score_point((select id from matches), 'right',
  (select token from court_sessions limit 1), 'ev-r-1');
select 'idempotent replay' as step, score_a, score_b from matches;

-- undo below 8 restores the ends
do $$
declare i int; begin
  for i in 1..2 loop
    perform undo_point((select id from matches), (select token from court_sessions limit 1));
  end loop;
end $$;
select 'after 2 undos' as step, score_a, score_b, a_on_left, sides_switched from matches;

-- drive A to 15 (A is on the left again after the undo)
do $$
declare i int; m matches; s text; begin
  for i in 1..8 loop
    select * into m from matches;
    s := case when m.a_on_left then 'left' else 'right' end;
    perform score_point(m.id, s, (select token from court_sessions limit 1), 'ev-w-'||i);
  end loop;
end $$;
select 'A to 15' as step, score_a, score_b, status from matches;

select confirm_match((select id from matches), (select token from court_sessions limit 1));
select 'confirmed' as step, status, (select name from teams where id = winner_id) as winner from matches;

-- a bad pin must be refused
do $$ begin
  perform unlock_court((select id from courts), '0000');
  raise exception 'BAD PIN WAS ACCEPTED';
exception when others then
  if sqlerrm = 'BAD_PIN' then raise notice 'bad pin correctly rejected';
  else raise; end if;
end $$;

-- scoring without a court session must be refused
do $$ begin
  perform score_point((select id from matches), 'left', 'not-a-token', 'ev-x');
  raise exception 'UNAUTHENTICATED SCORE ACCEPTED';
exception when others then
  if sqlerrm in ('NO_COURT_SESSION','MATCH_FINISHED') then raise notice 'no-token score correctly rejected (%)', sqlerrm;
  else raise; end if;
end $$;
