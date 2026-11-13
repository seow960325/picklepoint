-- PicklePoint 0064: matches.updated_at so the front page polls only the games that changed.
-- Additive: one column, one index, one trigger. No data changes. All competitions.
alter table matches add column if not exists updated_at timestamptz not null default now();
create index if not exists matches_event_updated_idx on matches (event_id, updated_at);
create or replace function _matches_touch() returns trigger language plpgsql as $$
begin new.updated_at := clock_timestamp(); return new; end $$;
drop trigger if exists matches_touch on matches;
create trigger matches_touch before update on matches for each row execute function _matches_touch();
select count(*) as games, max(updated_at) as newest from matches;
