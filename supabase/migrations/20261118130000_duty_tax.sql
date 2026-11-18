-- Phase 2, duties and taxes: the office's AHTN rate table, the fee settings of the office calculator
-- (brokerage table, port charges, CDS, IPF, IRS, quota rates, trigger price) and each shipment's saved
-- computation. Everyone in the office reads; only the owner changes rates and settings.

create table if not exists public.tariff_rates (
  ahtn_code text primary key check (ahtn_code ~ '^[0-9]{8}$'),
  description text,
  mfn_rate numeric(6,2) not null default 0 check (mfn_rate >= 0 and mfn_rate <= 100),
  fta_rates jsonb not null default '{}'::jsonb,   -- {"Form E": 0, "ATIGA Form D": 0, ...}
  note text,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
create index if not exists tariff_rates_by_idx on public.tariff_rates (updated_by);

-- One row. settings = the DutySettings shape in src/lib/duties.ts; empty means the built-in office figures.
create table if not exists public.duty_settings (
  id boolean primary key default true check (id),
  settings jsonb not null default '{}'::jsonb,
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
insert into public.duty_settings (id) values (true) on conflict (id) do nothing;
create index if not exists duty_settings_by_idx on public.duty_settings (updated_by);

-- The shipment's computation: inputs and results, who saved it and when.
alter table public.jobs add column if not exists duty_computation jsonb;

create or replace function public.touch_rate_row()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
revoke all on function public.touch_rate_row() from public, anon, authenticated;
create trigger touch_tariff_rates before insert or update on public.tariff_rates for each row execute function public.touch_rate_row();
create trigger touch_duty_settings before update on public.duty_settings for each row execute function public.touch_rate_row();

alter table public.tariff_rates enable row level security;
alter table public.duty_settings enable row level security;
create policy tariff_rates_select on public.tariff_rates for select to authenticated using (private.is_staff());
create policy tariff_rates_insert on public.tariff_rates for insert to authenticated with check (private.current_app_role() = 'owner'::public.app_role);
create policy tariff_rates_update on public.tariff_rates for update to authenticated
  using (private.current_app_role() = 'owner'::public.app_role) with check (private.current_app_role() = 'owner'::public.app_role);
create policy tariff_rates_delete on public.tariff_rates for delete to authenticated using (private.current_app_role() = 'owner'::public.app_role);
create policy duty_settings_select on public.duty_settings for select to authenticated using (private.is_staff());
create policy duty_settings_update on public.duty_settings for update to authenticated
  using (private.current_app_role() = 'owner'::public.app_role) with check (private.current_app_role() = 'owner'::public.app_role);

create trigger audit_tariff_rates after insert or update or delete on public.tariff_rates for each row execute function public.audit_row();
create trigger audit_duty_settings after insert or update or delete on public.duty_settings for each row execute function public.audit_row();
