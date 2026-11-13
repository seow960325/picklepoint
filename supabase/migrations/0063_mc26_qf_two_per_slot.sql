-- PicklePoint 0063 (MC26 only, per Derek 13 Nov): quarter-finals two per slot.
-- QF1 + QF2 at 12:45, QF3 + QF4 at 1:00, on the same two courts.
-- Men's Doubles: courts 1, 2 · Mixed Doubles: courts 4, 5. Nothing else changes.
update events set ko_court_plan = ko_court_plan || '{"KO-8-0": 1, "KO-8-1": 2, "KO-8-2": 1, "KO-8-3": 2}'::jsonb
 where id = 'ce7962be-0ba7-42e1-9184-01a19e26c3e8';
update events set ko_court_plan = ko_court_plan || '{"KO-8-0": 4, "KO-8-1": 5, "KO-8-2": 4, "KO-8-3": 5}'::jsonb
 where id = '66f2fcf3-a369-42c8-839b-839b7ef862f5';
select name, ko_court_plan from events where id in ('ce7962be-0ba7-42e1-9184-01a19e26c3e8', '66f2fcf3-a369-42c8-839b-839b7ef862f5');
