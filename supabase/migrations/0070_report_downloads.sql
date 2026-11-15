-- PicklePoint 0070: count results-PDF downloads (full report / team report), per category and team.
create table if not exists public.report_downloads (
  id bigserial primary key,
  hub_code text not null,
  kind text not null check (kind in ('full','team')),
  cat_code text,
  team_name text,
  created_at timestamptz not null default now()
);
alter table public.report_downloads enable row level security;
revoke all on public.report_downloads from anon, authenticated;

create or replace function public.log_report_download(p_hub text, p_kind text, p_cat text, p_team text)
returns void language sql security definer set search_path = public as $$
  insert into public.report_downloads (hub_code, kind, cat_code, team_name)
  select left(p_hub, 20), p_kind, left(p_cat, 20), left(p_team, 80)
  where p_kind in ('full','team');
$$;
revoke all on function public.log_report_download(text, text, text, text) from public;
grant execute on function public.log_report_download(text, text, text, text) to anon, authenticated;
