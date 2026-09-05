\set ON_ERROR_STOP on
-- create a competition end to end
select create_competition('{
  "name":"Klang Valley Cup","venue":"Puchong","admin_pin":"4321",
  "event":{"name":"Mixed Doubles","target_score":21,"win_by":2,"cap":25,"switch_at":11},
  "courts":[{"number":1,"scorer_pin":"1111"},{"number":2,"scorer_pin":"2222"}],
  "teams":[{"name":"Alpha","pool":"A"},{"name":"Bravo","pool":"A"},
           {"name":"Charlie","pool":"A"},{"name":"Delta","pool":"A"}],
  "matches":[{"a":0,"b":1,"court":0,"sequence":1,"round":"Group"},
             {"a":2,"b":3,"court":1,"sequence":2,"round":"Group"},
             {"a":0,"b":2,"court":0,"sequence":3,"round":"Group"},
             {"a":1,"b":3,"court":1,"sequence":4,"round":"Group"},
             {"a":0,"b":3,"court":0,"sequence":5,"round":"Group"},
             {"a":1,"b":2,"court":1,"sequence":6,"round":"Group"}]
}'::jsonb) as created \gset

select 'competition' as check, name, venue, admin_pin, status from competitions;
select 'rules' as check, name, target_score, win_by, cap, switch_at from events;
select 'courts' as check, count(*) from courts;
select 'teams' as check, count(*) from teams;
select 'matches' as check, count(*) as total,
       count(*) filter (where status='live') as live_now from matches;

-- admin login with the right pin
select admin_login((select code from competitions), '4321') is not null as admin_login_ok;

-- wrong pin refused
do $$ begin
  perform admin_login((select code from competitions), '0000');
  raise exception 'WRONG PIN ACCEPTED';
exception when others then
  if sqlerrm = 'BAD_PIN' then raise notice 'wrong admin pin rejected'; else raise; end if;
end $$;

-- rename the competition and a team, change the winning score
select admin_update_competition((select token from admin_sessions limit 1),
       'Klang Valley Open', 'IOI Mall');
select admin_update_event((select token from admin_sessions limit 1),
       (select id from events), 'Mixed Doubles', 15, 2, 17, 8);
select admin_upsert_team((select token from admin_sessions limit 1),
       (select id from events), (select id from teams where name='Alpha'),
       'Alpha Renamed', 'A', null, 'David', 'Evonne');

select 'renamed' as check, name, venue from competitions;
select 'new rules' as check, target_score, cap, switch_at from events;
select 'team' as check, name, player1, player2 from teams where pool='A' order by name limit 1;

-- an impossible cap is refused
do $$ begin
  perform admin_update_event((select token from admin_sessions limit 1),
          (select id from events), 'X', 15, 2, 15, 8);
  raise exception 'BAD CAP ACCEPTED';
exception when others then
  if sqlerrm = 'CAP_TOO_LOW' then raise notice 'cap below target+winby-1 rejected'; else raise; end if;
end $$;

-- a switch score above the target is refused
do $$ begin
  perform admin_update_event((select token from admin_sessions limit 1),
          (select id from events), 'X', 15, 2, 17, 30);
  raise exception 'BAD SWITCH ACCEPTED';
exception when others then
  if sqlerrm = 'BAD_SWITCH_AT' then raise notice 'switch_at above target rejected'; else raise; end if;
end $$;

-- changing a court PIN kicks any device that was already unlocked
select unlock_court((select id from courts where number=1), '1111') is not null as unlocked;
select admin_set_court_pin((select token from admin_sessions limit 1),
       (select id from courts where number=1), '7777');
select 'sessions after pin change' as check, count(*) from court_sessions
 where court_id = (select id from courts where number=1);
select unlock_court((select id from courts where number=1), '7777') is not null as unlocks_with_new_pin;

-- a non-admin cannot edit anything
do $$ begin
  perform admin_update_competition('bogus-token', 'Hacked', null);
  raise exception 'NON ADMIN EDIT ACCEPTED';
exception when others then
  if sqlerrm = 'NOT_ADMIN' then raise notice 'non-admin edit rejected'; else raise; end if;
end $$;

-- schedule can be replaced while nothing has been played
select admin_replace_schedule((select token from admin_sessions limit 1),
       (select id from events),
       '[{"a":0,"b":1,"court":0,"sequence":1},{"a":2,"b":3,"court":1,"sequence":2}]'::jsonb,
       array(select id from teams order by name),
       array(select id from courts order by number));
select 'after reschedule' as check, count(*) from matches;

-- ...but not once a point has been scored
select unlock_court((select id from courts where number=1), '7777') as tk \gset
do $$
declare tk text; mid uuid; begin
  select token into tk from court_sessions
    where court_id = (select id from courts where number=1) order by created_at desc limit 1;
  select id into mid from matches where court_id = (select id from courts where number=1) limit 1;
  perform score_point(mid, 'left', tk, 'ev-guard-1');
end $$;

do $$ begin
  perform admin_replace_schedule((select token from admin_sessions limit 1),
          (select id from events), '[]'::jsonb, array[]::uuid[], array[]::uuid[]);
  raise exception 'RESCHEDULE DURING PLAY ACCEPTED';
exception when others then
  if sqlerrm = 'SCHEDULE_IN_PROGRESS' then raise notice 'reschedule blocked once play started';
  else raise; end if;
end $$;

-- a team with a finished match cannot be deleted
do $$
declare tk text; mid uuid; begin
  select token into tk from court_sessions
    where court_id = (select id from courts where number=1) order by created_at desc limit 1;
  select id into mid from matches where court_id = (select id from courts where number=1) limit 1;
  for i in 2..15 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'left' else 'right' end,
                        tk, 'ev-guard-'||i);
  end loop;
  perform confirm_match(mid, tk);
end $$;

do $$
declare t uuid; begin
  select team_a_id into t from matches where status='finished' limit 1;
  perform admin_delete_team((select token from admin_sessions limit 1), t);
  raise exception 'DELETED A TEAM WITH RESULTS';
exception when others then
  if sqlerrm = 'TEAM_HAS_RESULTS' then raise notice 'team with results protected'; else raise; end if;
end $$;

select 'final' as check, score_a, score_b, status from matches where status='finished';
