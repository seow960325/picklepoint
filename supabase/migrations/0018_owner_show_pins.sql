-- =====================================================================
-- PicklePoint migration 0018: owner console shows PINs (hidden by default)
--
-- Adds admin_pin and each court's scorer_pin to owner_list_competitions
-- so the app owner can look up a forgotten PIN for someone. Only
-- reachable behind the owner master PIN -- the frontend keeps these
-- collapsed until the owner taps to reveal a specific competition.
-- =====================================================================

create or replace function owner_list_competitions(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  perform _require_owner(p_token);
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'id', c.id, 'code', c.code, 'name', c.name, 'venue', c.venue,
      'event_date', c.event_date, 'status', c.status, 'created_at', c.created_at,
      'admin_pin', c.admin_pin,
      'team_count', (select count(*) from teams t
                       join events e on e.id = t.event_id
                      where e.competition_id = c.id),
      'match_count', (select count(*) from matches m
                        join events e on e.id = m.event_id
                       where e.competition_id = c.id),
      'courts', (select coalesce(jsonb_agg(jsonb_build_object(
                          'number', co.number, 'label', co.label, 'scorer_pin', co.scorer_pin
                        ) order by co.number), '[]'::jsonb)
                   from courts co where co.competition_id = c.id)
    ) order by c.created_at desc)
    from competitions c
  ), '[]'::jsonb);
end $$;
