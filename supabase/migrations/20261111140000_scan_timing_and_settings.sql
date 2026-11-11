-- How long each document check took, and settings the scan function reads at run time.
alter table public.scan_results add column duration_ms integer;

create table public.app_settings (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
alter table public.app_settings enable row level security;
revoke all on public.app_settings from anon, authenticated;
grant select on public.app_settings to authenticated;
create policy app_settings_select on public.app_settings for select to authenticated
  using (public.current_app_role() = 'owner'::public.app_role);

-- effort: "low" or "medium". fast: use the API's fast mode (quicker, costs more). concurrency: files read at once.
insert into public.app_settings (key, value) values ('scan', '{"effort": "medium", "fast": false, "concurrency": 4}');
