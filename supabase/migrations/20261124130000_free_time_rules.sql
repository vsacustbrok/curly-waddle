-- Demurrage and storage watch: the free days and daily charges per shipping line (demurrage) and at
-- the port (storage), so the app can estimate each container's last free day from its ETA and show
-- the pesos running when it is late. A line with no row uses the "Default" row of its kind.
-- Amounts are pesos per container per day; the owner keeps them up to date.
create table if not exists public.free_time_rules (
  id bigint generated always as identity primary key,
  kind text not null check (kind in ('demurrage', 'storage')),
  name text not null check (length(trim(name)) between 1 and 80),   -- shipping line, port, or "Default"
  free_days int not null check (free_days between 0 and 60),
  rate_20 numeric(12,2) check (rate_20 >= 0),                         -- ₱ per 20-ft container per day after free time
  rate_40 numeric(12,2) check (rate_40 >= 0),                         -- ₱ per 40-ft container per day after free time
  note text check (length(note) <= 300),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  unique (kind, name)
);

alter table public.free_time_rules enable row level security;
create policy free_time_rules_select on public.free_time_rules for select to authenticated using (private.is_staff());
create policy free_time_rules_insert on public.free_time_rules for insert to authenticated
  with check (private.current_app_role() = 'owner'::public.app_role);
create policy free_time_rules_update on public.free_time_rules for update to authenticated
  using (private.current_app_role() = 'owner'::public.app_role) with check (private.current_app_role() = 'owner'::public.app_role);
create policy free_time_rules_delete on public.free_time_rules for delete to authenticated
  using (private.current_app_role() = 'owner'::public.app_role);
revoke all on public.free_time_rules from anon;
grant select, insert, update, delete on public.free_time_rules to authenticated;

create or replace function public.touch_free_time_rule()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
revoke all on function public.touch_free_time_rule() from public, anon, authenticated;
create trigger touch_free_time_rule before update on public.free_time_rules for each row execute function public.touch_free_time_rule();
create trigger audit_free_time_rules after insert or update or delete on public.free_time_rules for each row execute function public.audit_row();

-- The two "Default" rows, with no amounts yet: the owner fills in the days and rates.
insert into public.free_time_rules (kind, name, free_days, note) values
  ('demurrage', 'Default', 7, 'Used for any shipping line without its own row. Check the days and enter the rates.'),
  ('storage', 'Default', 5, 'Port storage free days after discharge. Check the days and enter the rates.')
on conflict (kind, name) do nothing;

-- Backups keep these rules too.
do $$
declare src text;
begin
  select pg_get_functiondef('private.make_backup()'::regprocedure) into src;
  if position('free_time_rules' in src) = 0 then
    src := replace(src, '''app_settings'', (select',
      '''free_time_rules'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.free_time_rules t),
    ''app_settings'', (select');
    execute src;
  end if;
end $$;
