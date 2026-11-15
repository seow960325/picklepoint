-- PicklePoint 0070: count results-PDF downloads (full / team) with an anonymous device id and IP, owner-only.
create table if not exists public.report_downloads (
  id bigserial primary key,
  hub_code text not null,
  kind text not null check (kind in ('full','team')),
  cat_code text,
  team_name text,
  created_at timestamptz not null default now()
);
alter table public.report_downloads add column if not exists device_id text;
alter table public.report_downloads add column if not exists ip text;
alter table public.report_downloads enable row level security;
revoke all on public.report_downloads from anon, authenticated;

drop function if exists public.log_report_download(text, text, text, text);
create or replace function public.log_report_download(p_hub text, p_kind text, p_cat text, p_team text, p_device text)
returns void language plpgsql security definer set search_path = public as $$
declare h json; v_ip text;
begin
  if p_kind not in ('full','team') then return; end if;
  begin h := current_setting('request.headers', true)::json; exception when others then h := null; end;
  v_ip := coalesce(h->>'cf-connecting-ip', split_part(coalesce(h->>'x-forwarded-for',''), ',', 1));
  insert into public.report_downloads (hub_code, kind, cat_code, team_name, device_id, ip)
  values (left(p_hub, 20), p_kind, left(p_cat, 20), left(p_team, 80), left(p_device, 40), left(v_ip, 45));
end $$;
revoke all on function public.log_report_download(text, text, text, text, text) from public;
grant execute on function public.log_report_download(text, text, text, text, text) to anon, authenticated;
