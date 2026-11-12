do $m$
begin
  if not exists (select 1 from pg_proc where proname = '_reset_competition_core') then
    alter function _reset_competition(uuid) rename to _reset_competition_core;
  end if;
end $m$;

create or replace function _ensure_final_series_rows(c uuid) returns void
language plpgsql security definer set search_path = public as $$
declare ev record; v_seq int; i int; begin
  for ev in select id, final_best_of from events
             where competition_id = c and coalesce(final_best_of, 1) >= 2 loop
    if not exists (select 1 from matches where event_id = ev.id and bracket_key = 'KO-2-0') then continue; end if;
    select coalesce(max(sequence), 0) into v_seq from matches where event_id = ev.id;
    for i in 2..ev.final_best_of loop
      if not exists (select 1 from matches where event_id = ev.id and bracket_key = 'KO-2-0-' || i) then
        insert into matches (event_id, court_id, round, sequence, bracket_key, status)
        values (ev.id, null, 'Final', v_seq + i - 1, 'KO-2-0-' || i, 'scheduled');
      end if;
    end loop;
  end loop;
end $$;
revoke all on function _ensure_final_series_rows(uuid) from public, anon, authenticated;

create or replace function _reset_competition(c uuid)
returns int language plpgsql security definer set search_path = public as $$
declare n int; begin
  n := _reset_competition_core(c);
  perform _ensure_final_series_rows(c);
  return n;
end $$;
revoke all on function _reset_competition(uuid) from public, anon, authenticated;
revoke all on function _reset_competition_core(uuid) from public, anon, authenticated;

select _ensure_final_series_rows(id) from competitions;
