-- =====================================================================
-- admin_move_match: reorder a court's upcoming queue when players aren't
-- ready, e.g. bump the next scheduled match ahead of the one in front.
-- Swaps the sequence of the target match with its neighbouring
-- 'scheduled' match on the same court in the given direction. Only
-- 'scheduled' matches move, so nothing can jump ahead of the match
-- that's currently live. Admin-authorized.
-- =====================================================================

create or replace function admin_move_match(p_token text, p_match_id uuid, p_dir text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare c uuid; m matches; other matches; tmp int; begin
  c := _require_admin(p_token);

  select mm.* into m from matches mm
    join events e on e.id = mm.event_id
   where mm.id = p_match_id and e.competition_id = c
   for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.status <> 'scheduled' then raise exception 'NOT_SCHEDULED'; end if;

  if p_dir = 'up' then
    select * into other from matches
      where court_id is not distinct from m.court_id
        and status = 'scheduled' and sequence < m.sequence
      order by sequence desc limit 1 for update;
  else
    select * into other from matches
      where court_id is not distinct from m.court_id
        and status = 'scheduled' and sequence > m.sequence
      order by sequence asc limit 1 for update;
  end if;
  if not found then return to_jsonb(m); end if;   -- already at the edge

  tmp := m.sequence;
  update matches set sequence = other.sequence where id = m.id;
  update matches set sequence = tmp where id = other.id;

  return to_jsonb((select mm from matches mm where mm.id = m.id));
end $$;

grant execute on function admin_move_match(text, uuid, text) to anon, authenticated;
