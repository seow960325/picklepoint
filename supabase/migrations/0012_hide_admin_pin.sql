-- =====================================================================
-- PicklePoint migration 0012: stop the public anon key from reading
-- secret PINs over the REST API.
--
-- competitions.admin_pin and courts.scorer_pin were reachable via
-- GET /rest/v1/competitions?select=admin_pin with the public anon key
-- (both tables have `for select using (true)` policies and Supabase's
-- platform default grants table SELECT to anon/authenticated).
--
-- The browser never reads these tables directly — only through
-- security-definer RPCs (join_competition, admin_login, admin_bundle,
-- unlock_court, score_point, ...) and the scorer_pin-free courts_public
-- view, none of which depend on the caller's table grants. So revoking
-- table SELECT from the public roles closes the leak with no client-
-- visible change. A column-level revoke does NOT work here: a table-wide
-- SELECT grant covers every column and cannot be narrowed by revoking a
-- single column, so the whole-table grant must go.
-- =====================================================================

revoke select on public.competitions from anon, authenticated;
revoke select on public.courts       from anon, authenticated;
