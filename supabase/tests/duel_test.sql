\set ON_ERROR_STOP on
-- Team Battle format: two sides face off, teams split into per-court pods of
-- 2v2, each pod plays its 4 cross-games, side with the most games won overall wins.

-- ===================================================================
-- Part 1: small case (4 teams per side, 2 pods, 2 courts) — wiring checks
-- ===================================================================
select create_competition('{
  "name":"Cambodia Vs Malaysia 2026","venue":"Phnom Penh","admin_pin":"1234",
  "event":{"name":"Open Doubles","format":"duel","side_a_name":"Cambodia","side_b_name":"Malaysia",
           "target_score":15,"win_by":2,"cap":17,"switch_at":8},
  "courts":[{"number":1,"scorer_pin":"1111"},{"number":2,"scorer_pin":"2222"}],
  "teams":[{"name":"Team A","side":"A"},{"name":"Team B","side":"A"},
           {"name":"Team E","side":"A"},{"name":"Team F","side":"A"},
           {"name":"Team C","side":"B"},{"name":"Team D","side":"B"},
           {"name":"Team G","side":"B"},{"name":"Team H","side":"B"}],
  "matches":[
    {"a":0,"b":4,"court":0,"sequence":1,"round":"Pod 1"},
    {"a":1,"b":5,"court":0,"sequence":2,"round":"Pod 1"},
    {"a":0,"b":5,"court":0,"sequence":3,"round":"Pod 1"},
    {"a":1,"b":4,"court":0,"sequence":4,"round":"Pod 1"},
    {"a":2,"b":6,"court":1,"sequence":5,"round":"Pod 2"},
    {"a":3,"b":7,"court":1,"sequence":6,"round":"Pod 2"},
    {"a":2,"b":7,"court":1,"sequence":7,"round":"Pod 2"},
    {"a":3,"b":6,"court":1,"sequence":8,"round":"Pod 2"}
  ]
}'::jsonb) as created;

select 'event' as chk, name, format, side_a_name, side_b_name, target_score from events;
select 'teams' as chk, name, side from teams order by name;
select 'matches' as chk, count(*), count(*) filter (where status='live') as live from matches;

-- a plain round_robin event must still work (format not broken by the new column)
select create_competition('{
  "name":"Plain RR","admin_pin":"5555",
  "event":{"name":"Mixed","target_score":11,"win_by":2,"cap":15,"switch_at":6},
  "courts":[{"number":1,"scorer_pin":"3333"}],
  "teams":[{"name":"Solo A","pool":"A"},{"name":"Solo B","pool":"A"}],
  "matches":[{"a":0,"b":1,"court":0,"sequence":1,"round":"Group"}]
}'::jsonb) as rr_created;
select 'rr event' as chk, format, side_a_name from events where name = 'Mixed';

-- rename the sides via admin_update_event
select admin_login((select code from competitions where name='Cambodia Vs Malaysia 2026'), '1234') as tok \gset
select admin_update_event(:'tok', (select id from events where name='Open Doubles'),
       'Open Doubles', 15, 2, 17, 8, 'Kingdom of Cambodia', 'Malaysia Boleh');
select 'renamed sides' as chk, side_a_name, side_b_name from events where name='Open Doubles';

-- reassign a team's side via admin_upsert_team
select admin_upsert_team(:'tok', (select id from events where name='Open Doubles'),
       (select id from teams where name='Team H'), 'Team H', null, 'A', null, null);
select 'reassigned' as chk, name, side from teams where name='Team H';
-- put it back so the tally test below is clean
select admin_upsert_team(:'tok', (select id from events where name='Open Doubles'),
       (select id from teams where name='Team H'), 'Team H', null, 'B', null, null);

-- an invalid side is rejected
do $$ begin
  perform admin_upsert_team((select token from admin_sessions limit 1),
    (select id from events where name='Open Doubles'), null, 'Bad Team', null, 'Q', null, null);
  raise exception 'BAD SIDE ACCEPTED';
exception when others then
  if sqlerrm = 'BAD_SIDE' then raise notice 'invalid side value rejected'; else raise; end if;
end $$;

-- play out Pod 1 fully: Cambodia (side A) wins 3 of its 4 games, Malaysia 1
do $$
declare
  ev_id uuid; ct1 uuid; ct2 uuid; tok1 text; tok2 text;
  mid uuid; i int;
begin
  select id into ev_id from events where name = 'Open Doubles';
  select id into ct1 from courts where number = 1 and competition_id =
    (select id from competitions where name='Cambodia Vs Malaysia 2026');
  select id into ct2 from courts where number = 2 and competition_id =
    (select id from competitions where name='Cambodia Vs Malaysia 2026');
  tok1 := unlock_court(ct1, '1111');
  tok2 := unlock_court(ct2, '2222');

  -- Pod 1, game 1 (Team A vs Team C): Cambodia wins 15-10
  select id into mid from matches where event_id = ev_id and court_id = ct1 and sequence = 1;
  for i in 1..15 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'left' else 'right' end, tok1, 'g1-a-'||i);
  end loop;
  for i in 1..10 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'right' else 'left' end, tok1, 'g1-b-'||i);
  end loop;
  perform confirm_match(mid, tok1);

  -- next fixture on court 1 (Pod 1, game 2 — sequence 2) is now live; Malaysia wins this one
  select id into mid from matches where event_id = ev_id and court_id = ct1 and status = 'live';
  for i in 1..8 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'left' else 'right' end, tok1, 'g2-a-'||i);
  end loop;
  for i in 1..15 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'right' else 'left' end, tok1, 'g2-b-'||i);
  end loop;
  perform confirm_match(mid, tok1);

  -- Pod 1 game 3: Cambodia wins
  select id into mid from matches where event_id = ev_id and court_id = ct1 and status = 'live';
  for i in 1..15 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'left' else 'right' end, tok1, 'g3-a-'||i);
  end loop;
  for i in 1..5 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'right' else 'left' end, tok1, 'g3-b-'||i);
  end loop;
  perform confirm_match(mid, tok1);

  -- Pod 1 game 4: Cambodia wins
  select id into mid from matches where event_id = ev_id and court_id = ct1 and status = 'live';
  for i in 1..15 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'left' else 'right' end, tok1, 'g4-a-'||i);
  end loop;
  for i in 1..3 loop
    perform score_point(mid, case when (select a_on_left from matches where id=mid) then 'right' else 'left' end, tok1, 'g4-b-'||i);
  end loop;
  perform confirm_match(mid, tok1);
end $$;

select 'court1 after pod1' as chk, m.sequence, m.status, m.score_a, m.score_b,
       ta.name as team_a, ta.side as side_a, tb.name as team_b, tb.side as side_b, w.name as winner
  from matches m
  join teams ta on ta.id = m.team_a_id
  join teams tb on tb.id = m.team_b_id
  left join teams w on w.id = m.winner_id
 where m.event_id = (select id from events where name='Open Doubles')
   and m.court_id = (select id from courts where number=1 and competition_id =
      (select id from competitions where name='Cambodia Vs Malaysia 2026'))
 order by m.sequence;

-- ===================================================================
-- Part 2: the real tournament shape — 3 courts, 6 teams per side,
-- 4 cross-games per court (12 games total), verifying the OVERALL
-- country tally (not just one pod) picks the right winner.
-- ===================================================================
select create_competition('{
  "name":"Cambodia Vs Malaysia 2026 Full","venue":"Phnom Penh","admin_pin":"1234",
  "event":{"name":"Open Doubles","format":"duel","side_a_name":"Cambodia","side_b_name":"Malaysia",
           "target_score":15,"win_by":2,"cap":17,"switch_at":8},
  "courts":[{"number":1,"scorer_pin":"1111"},{"number":2,"scorer_pin":"2222"},{"number":3,"scorer_pin":"3333"}],
  "teams":[{"name":"Cambodia 1","side":"A"},{"name":"Cambodia 2","side":"A"},
           {"name":"Cambodia 3","side":"A"},{"name":"Cambodia 4","side":"A"},
           {"name":"Cambodia 5","side":"A"},{"name":"Cambodia 6","side":"A"},
           {"name":"Malaysia 1","side":"B"},{"name":"Malaysia 2","side":"B"},
           {"name":"Malaysia 3","side":"B"},{"name":"Malaysia 4","side":"B"},
           {"name":"Malaysia 5","side":"B"},{"name":"Malaysia 6","side":"B"}],
  "matches":[
    {"a":0,"b":6,"court":0,"sequence":1,"round":"Pod 1"},
    {"a":1,"b":7,"court":0,"sequence":2,"round":"Pod 1"},
    {"a":0,"b":7,"court":0,"sequence":3,"round":"Pod 1"},
    {"a":1,"b":6,"court":0,"sequence":4,"round":"Pod 1"},
    {"a":2,"b":8,"court":1,"sequence":5,"round":"Pod 2"},
    {"a":3,"b":9,"court":1,"sequence":6,"round":"Pod 2"},
    {"a":2,"b":9,"court":1,"sequence":7,"round":"Pod 2"},
    {"a":3,"b":8,"court":1,"sequence":8,"round":"Pod 2"},
    {"a":4,"b":10,"court":2,"sequence":9,"round":"Pod 3"},
    {"a":5,"b":11,"court":2,"sequence":10,"round":"Pod 3"},
    {"a":4,"b":11,"court":2,"sequence":11,"round":"Pod 3"},
    {"a":5,"b":10,"court":2,"sequence":12,"round":"Pod 3"}
  ]
}'::jsonb) as created_full;

select 'setup: teams per side' as chk, side, count(*)
  from teams where event_id = (select id from events where name='Open Doubles'
        and competition_id = (select id from competitions where name='Cambodia Vs Malaysia 2026 Full'))
 group by side order by side;
select 'setup: matches total, live now' as chk, count(*),
       count(*) filter (where status='live') as live
  from matches where event_id = (select id from events where name='Open Doubles'
        and competition_id = (select id from competitions where name='Cambodia Vs Malaysia 2026 Full'));

-- play every court to completion; scripted results (by design):
--   Pod 1 (court 1): Cambodia sweeps 4-0
--   Pod 2 (court 2): Malaysia sweeps 0-4
--   Pod 3 (court 3): Cambodia wins 3-1
-- expected final: Cambodia 7 games, Malaysia 5 games -> Cambodia wins overall
do $$
declare
  ev_id uuid;
  ct1 uuid; ct2 uuid; ct3 uuid;
  tok1 text; tok2 text; tok3 text;
  mid uuid; i int;
  comp_id uuid;
  winners text[] := array['A','A','A','A',  'B','B','B','B',  'A','A','A','B'];
  loser_scores int[] := array[8,9,7,6,  6,7,8,9,  10,9,8,13];
  ct uuid;
  tok text;
  win_side text;
  lose_pts int;
begin
  select id into comp_id from competitions where name='Cambodia Vs Malaysia 2026 Full';
  select id into ev_id from events where name='Open Doubles' and competition_id = comp_id;
  select id into ct1 from courts where number=1 and competition_id=comp_id;
  select id into ct2 from courts where number=2 and competition_id=comp_id;
  select id into ct3 from courts where number=3 and competition_id=comp_id;
  tok1 := unlock_court(ct1, '1111');
  tok2 := unlock_court(ct2, '2222');
  tok3 := unlock_court(ct3, '3333');

  for seq in 1..12 loop
    ct := case when seq <= 4 then ct1 when seq <= 8 then ct2 else ct3 end;
    tok := case when seq <= 4 then tok1 when seq <= 8 then tok2 else tok3 end;
    win_side := winners[seq];
    lose_pts := loser_scores[seq];

    select id into mid from matches where event_id = ev_id and court_id = ct and status = 'live';

    for i in 1..15 loop
      perform score_point(mid,
        case
          when win_side = 'A' then (case when (select a_on_left from matches where id=mid) then 'left' else 'right' end)
          else (case when (select a_on_left from matches where id=mid) then 'right' else 'left' end)
        end,
        tok, 'w-'||seq||'-'||i);
    end loop;
    for i in 1..lose_pts loop
      perform score_point(mid,
        case
          when win_side = 'A' then (case when (select a_on_left from matches where id=mid) then 'right' else 'left' end)
          else (case when (select a_on_left from matches where id=mid) then 'left' else 'right' end)
        end,
        tok, 'l-'||seq||'-'||i);
    end loop;
    perform confirm_match(mid, tok);
  end loop;
end $$;

-- raw per-game result, in schedule order
select m.sequence, c.number as court, ta.name as team_a, ta.side as side_a,
       tb.name as team_b, tb.side as side_b, m.score_a, m.score_b, w.side as winner_side
  from matches m
  join teams ta on ta.id = m.team_a_id
  join teams tb on tb.id = m.team_b_id
  join courts c on c.id = m.court_id
  left join teams w on w.id = m.winner_id
 where m.event_id = (select id from events where name='Open Doubles'
        and competition_id = (select id from competitions where name='Cambodia Vs Malaysia 2026 Full'))
 order by m.sequence;

-- tally: games won per side (mirrors src/lib/store.ts duelTally — count wins, not points)
-- and assert the exact expected outcome, so a regression here fails the test run loudly.
do $$
declare
  cambodia_wins int; malaysia_wins int; games_played int;
begin
  select count(*) filter (where w.side = 'A'), count(*) filter (where w.side = 'B'), count(*)
    into cambodia_wins, malaysia_wins, games_played
    from matches m
    left join teams w on w.id = m.winner_id
   where m.event_id = (select id from events where name='Open Doubles'
          and competition_id = (select id from competitions where name='Cambodia Vs Malaysia 2026 Full'))
     and m.status = 'finished';

  if games_played <> 12 then raise exception 'expected 12 finished games, got %', games_played; end if;
  if cambodia_wins <> 7 then raise exception 'expected Cambodia to win 7 games, got %', cambodia_wins; end if;
  if malaysia_wins <> 5 then raise exception 'expected Malaysia to win 5 games, got %', malaysia_wins; end if;
  if cambodia_wins <= malaysia_wins then raise exception 'expected Cambodia to lead overall'; end if;
  raise notice 'tally verified: Cambodia % - % Malaysia, Cambodia wins the tournament', cambodia_wins, malaysia_wins;
end $$;
