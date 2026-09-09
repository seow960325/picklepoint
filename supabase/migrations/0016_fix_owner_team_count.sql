-- =====================================================================
-- PicklePoint migration 0016: fix owner_list_competitions team_count
--
-- teams.competition_id doesn't exist -- teams belong to an event, and
-- events belong to a competition. 0015's team_count subquery referenced
-- a column that was never there, so every call to
-- owner_list_competitions failed.
-- =====================================================================

create or replace function owner_list_competitions(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'venue', c.venue,
      'event_date', c.event_date, 'status', c.status, 'created_at', c.created_at,
      'team_count', (select count(*) from teams t
                       join events e on e.id = t.event_id
                      where e.competition_id = c.id),
      'match_count', (select count(*) from matches m
                        join events e on e.id = m.event_id
                       where e.competition_id = c.id)
    ) order by c.created_at desc)
    from competitions c
  ), '[]'::jsonb);
end $$;
