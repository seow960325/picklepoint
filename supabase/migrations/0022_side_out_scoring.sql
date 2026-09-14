-- =====================================================================
-- PicklePoint migration 0022: real side-out scoring for "Serve" mode
--
-- 0021's 'alternate' mode ("swap serve every 2 total points, regardless
-- of winner") was not a real pickleball rule. This replaces it with the
-- actual USA Pickleball doubles side-out rule, at team granularity (this
-- app doesn't track individual players' serve rotation):
--
--   - Only the serving team can score. Winning a rally while serving adds
--     a point and you keep serving.
--   - Losing a rally while serving is a "fault" and scores nothing. The
--     first fault passes serve to your partner (server #2 of the SAME
--     team — no side change). The second fault is a side-out: the OTHER
--     team takes over serving, starting fresh at server #1.
--   - The very first service of the game is a documented exception:
--     that side only gets ONE server, not two (officially scored
--     "0-0-2"). A fresh match therefore starts at server_no = 2.
--
-- Also lets the referee pick who serves first at 0-0 (matches.initial_server),
-- which seeds this exception (and, in 'winner' mode, just seeds the serve
-- display before the first point is played — it doesn't gate scoring there).
-- 'winner' mode (pure rally scoring, every rally scores) is unaffected by
-- any of this.
-- =====================================================================

alter table matches
  add column initial_server text check (initial_server in ('a', 'b')),
  add column serving_team  text check (serving_team  in ('a', 'b')),
  add column server_no     int  check (server_no     in (1, 2));

alter table point_events
  add column serving_team_after text check (serving_team_after in ('a', 'b')),
  add column server_no_after    int  check (server_no_after    in (1, 2));

-- ------------------------------------------------------- score_point
create or replace function score_point(
  p_match_id uuid, p_side text, p_token text,
  p_client_event_id text, p_device_id text default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; e events; v_court uuid; v_team uuid; v_winner text;
  v_a int; v_b int; v_hi int; v_lo int;
  v_serving text; v_server_no int; v_new_serving text; v_new_server_no int;
  v_last_scorer text;
begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  if exists (select 1 from point_events where client_event_id = p_client_event_id) then
    select * into m from matches where id = p_match_id;
    return to_jsonb(m);
  end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into e from events where id = m.event_id;

  -- physical side -> which team WON this rally (the referee always taps
  -- the winning side, same gesture in both serve modes)
  if (p_side = 'left') = m.a_on_left then
    v_team := m.team_a_id; v_winner := 'a';
  else
    v_team := m.team_b_id; v_winner := 'b';
  end if;

  v_last_scorer := null;
  v_new_serving := null; v_new_server_no := null;

  if e.serve_mode = 'alternate' then
    v_serving := coalesce(m.serving_team, m.initial_server, 'a');
    -- official first-service-of-the-game exception: one server, not two
    v_server_no := coalesce(m.server_no, 2);

    if v_winner = v_serving then
      v_a := m.score_a + (case when v_winner = 'a' then 1 else 0 end);
      v_b := m.score_b + (case when v_winner = 'b' then 1 else 0 end);
      v_new_serving := v_serving; v_new_server_no := v_server_no;
    else
      -- serving side lost the rally — no point scored (side-out scoring)
      v_a := m.score_a; v_b := m.score_b;
      if v_server_no = 1 then
        v_new_serving := v_serving; v_new_server_no := 2;              -- 1st fault: partner's turn
      else
        v_new_serving := case when v_serving = 'a' then 'b' else 'a' end; -- 2nd fault: side-out
        v_new_server_no := 1;
      end if;
    end if;
  else
    v_a := m.score_a + (case when v_winner = 'a' then 1 else 0 end);
    v_b := m.score_b + (case when v_winner = 'b' then 1 else 0 end);
    v_last_scorer := v_winner;
  end if;

  insert into point_events (match_id, client_event_id, team_id, delta,
                            score_a_after, score_b_after, device_id,
                            serving_team_after, server_no_after)
  values (p_match_id, p_client_event_id, v_team,
          case when v_a + v_b > m.score_a + m.score_b then 1 else 0 end,
          v_a, v_b, p_device_id, v_new_serving, v_new_server_no);

  v_hi := greatest(v_a, v_b); v_lo := least(v_a, v_b);

  update matches set
    score_a = v_a,
    score_b = v_b,
    started_at = coalesce(started_at, now()),
    sides_switched = sides_switched or (e.switch_at > 0 and v_hi >= e.switch_at),
    a_on_left = case when not sides_switched and e.switch_at > 0 and v_hi >= e.switch_at
                     then not a_on_left else a_on_left end,
    last_scorer = coalesce(v_last_scorer, last_scorer),
    serving_team = case when e.serve_mode = 'alternate' then v_new_serving else serving_team end,
    server_no = case when e.serve_mode = 'alternate' then v_new_server_no else server_no end,
    status = case
      when (v_hi >= e.target_score and v_hi - v_lo >= e.win_by) or v_hi >= e.cap
      then 'awaiting_confirm' else 'live' end
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- -------------------------------------------------------- undo_point
create or replace function undo_point(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  m matches; last_ev point_events; prev_a int; prev_b int; prev_team uuid;
  prev_serving text; prev_server_no int;
  e events; v_hi int; v_scorer text;
begin
  if _court_from_token(p_token) is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if m.status = 'finished' then raise exception 'MATCH_FINISHED'; end if;

  select * into last_ev from point_events
   where match_id = p_match_id order by seq desc limit 1;
  if not found then return to_jsonb(m); end if;

  delete from point_events where id = last_ev.id;

  select score_a_after, score_b_after, team_id, serving_team_after, server_no_after
    into prev_a, prev_b, prev_team, prev_serving, prev_server_no
    from point_events where match_id = p_match_id
   order by seq desc limit 1;
  prev_a := coalesce(prev_a, 0); prev_b := coalesce(prev_b, 0);
  v_scorer := case when prev_team is null then null
                   when prev_team = m.team_a_id then 'a'
                   when prev_team = m.team_b_id then 'b'
                   else null end;

  select * into e from events where id = m.event_id;
  v_hi := greatest(prev_a, prev_b);

  update matches set
    score_a = prev_a,
    score_b = prev_b,
    a_on_left = case when e.switch_at > 0 and sides_switched and v_hi < e.switch_at
                     then not a_on_left else a_on_left end,
    sides_switched = sides_switched and (e.switch_at > 0 and v_hi >= e.switch_at),
    last_scorer = case when e.serve_mode = 'alternate' then last_scorer else v_scorer end,
    serving_team = case when e.serve_mode = 'alternate' then prev_serving else serving_team end,
    server_no = case when e.serve_mode = 'alternate' then prev_server_no else server_no end,
    status = 'live'
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- ------------------------------------------------------- reset_match
create or replace function reset_match(p_match_id uuid, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;

  delete from point_events where match_id = p_match_id;

  update matches set
    score_a = 0, score_b = 0, a_on_left = true, sides_switched = false,
    last_scorer = null, initial_server = null, serving_team = null, server_no = null,
    status = 'live', winner_id = null, started_at = null, finished_at = null,
    duration_seconds = null
  where id = p_match_id
  returning * into m;

  return to_jsonb(m);
end $$;

-- --------------------------------------------------- set_first_server
-- Referee picks who serves first — only takes effect before any point has
-- been played (score still 0-0); a no-op once the match has started.
create or replace function set_first_server(p_match_id uuid, p_side text, p_token text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare m matches; v_court uuid; v_team text; begin
  v_court := _court_from_token(p_token);
  if v_court is null then raise exception 'NO_COURT_SESSION'; end if;

  select * into m from matches where id = p_match_id for update;
  if not found then raise exception 'NO_MATCH'; end if;
  if m.court_id is distinct from v_court then raise exception 'WRONG_COURT'; end if;

  if m.score_a <> 0 or m.score_b <> 0 then
    return to_jsonb(m);   -- match already started — no-op
  end if;

  v_team := case when (p_side = 'left') = m.a_on_left then 'a' else 'b' end;

  update matches set initial_server = v_team where id = p_match_id returning * into m;
  return to_jsonb(m);
end $$;

grant execute on function set_first_server(uuid, text, text) to anon, authenticated;
