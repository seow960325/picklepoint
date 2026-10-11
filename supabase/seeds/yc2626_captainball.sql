-- =====================================================================
-- YC2626 only: add Captain Ball (1 court, 6 teams, round robin 15 games).
-- Run AFTER migration 0031. Safe to re-run: every step skips itself when
-- that part already exists. Touches no other sport and no other code.
-- =====================================================================

-- 1. the Captain Ball event (2 x 10 min, 2 min rest, 60 s time-outs)
insert into events (competition_id, name, format, target_score, win_by, cap, switch_at,
                    serve_mode, sport, sort_order, cb_rules)
select c.id, 'Captain Ball', 'round_robin', 99, 1, 99, 0, 'winner', 'captainball',
       (select coalesce(max(sort_order), 0) + 1 from events where competition_id = c.id),
       '{"half_min":10,"halves":2,"rest_min":2,"to_sec":60,"to_h1":2,"to_h2":2,"extra_min":3,"win":3,"draw":1,"loss":0}'::jsonb
  from competitions c
 where c.code = 'YC2626'
   and not exists (select 1 from events e where e.competition_id = c.id and e.sport = 'captainball');

-- 2. one Captain Ball court (random 4-digit scorer PIN, shown at the end)
insert into courts (competition_id, number, label, scorer_pin, sport)
select c.id, (select coalesce(max(number), 0) + 1 from courts where competition_id = c.id),
       'Captain Ball 1', lpad((floor(random() * 10000))::text, 4, '0'), 'captainball'
  from competitions c
 where c.code = 'YC2626'
   and not exists (select 1 from courts ct where ct.competition_id = c.id and ct.sport = 'captainball');

-- 3. the 6 teams
insert into teams (event_id, name, pool)
select e.id, t.name, 'A'
  from events e
  join competitions c on c.id = e.competition_id
 cross join (values ('MEGA CMC TEAM A'), ('MEGA CMC TEAM B'), ('GMSJ'),
                    ('MEGA SURIA'), ('PUTRA PRIMA'), ('MEGA SUBANG')) t(name)
 where c.code = 'YC2626' and e.sport = 'captainball'
   and not exists (select 1 from teams x where x.event_id = e.id);

-- 4. round robin: 15 games, nobody plays two games in a row
insert into matches (event_id, court_id, round, sequence, team_a_id, team_b_id, status, tie_id, game_label)
select e.id, ct.id, 'A · R' || f.r, f.seq, ta.id, tb.id, 'scheduled', gen_random_uuid(), 'CB'
  from events e
  join competitions c on c.id = e.competition_id
  join courts ct on ct.competition_id = c.id and ct.sport = 'captainball'
 cross join (values
  (1, 1, 'MEGA CMC TEAM A', 'MEGA SUBANG'),
  (2, 1, 'MEGA CMC TEAM B', 'PUTRA PRIMA'),
  (3, 1, 'GMSJ', 'MEGA SURIA'),
  (4, 2, 'PUTRA PRIMA', 'MEGA CMC TEAM A'),
  (5, 2, 'MEGA SURIA', 'MEGA SUBANG'),
  (6, 2, 'GMSJ', 'MEGA CMC TEAM B'),
  (7, 3, 'MEGA CMC TEAM A', 'MEGA SURIA'),
  (8, 3, 'PUTRA PRIMA', 'GMSJ'),
  (9, 3, 'MEGA SUBANG', 'MEGA CMC TEAM B'),
  (10, 4, 'GMSJ', 'MEGA CMC TEAM A'),
  (11, 4, 'MEGA CMC TEAM B', 'MEGA SURIA'),
  (12, 4, 'MEGA SUBANG', 'PUTRA PRIMA'),
  (13, 5, 'MEGA CMC TEAM A', 'MEGA CMC TEAM B'),
  (14, 5, 'GMSJ', 'MEGA SUBANG'),
  (15, 5, 'MEGA SURIA', 'PUTRA PRIMA')) f(seq, r, a, b)
  join teams ta on ta.event_id = e.id and ta.name = f.a
  join teams tb on tb.event_id = e.id and tb.name = f.b
 where c.code = 'YC2626' and e.sport = 'captainball'
   and not exists (select 1 from matches x where x.event_id = e.id);

-- 5. game 1 goes live on the court
update matches set status = 'live'
 where id = (select m.id from matches m
               join events e on e.id = m.event_id
               join competitions c on c.id = e.competition_id
              where c.code = 'YC2626' and e.sport = 'captainball' and m.status = 'scheduled'
              order by m.sequence limit 1)
   and not exists (select 1 from matches m
                     join events e on e.id = m.event_id
                     join competitions c on c.id = e.competition_id
                    where c.code = 'YC2626' and e.sport = 'captainball'
                      and m.status in ('live', 'awaiting_confirm', 'finished'));

-- 6. result: the Captain Ball court and its scorer PIN
select ct.number as court_no, ct.label, ct.scorer_pin
  from courts ct join competitions c on c.id = ct.competition_id
 where c.code = 'YC2626' and ct.sport = 'captainball';
