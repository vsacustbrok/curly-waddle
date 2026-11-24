-- Permits and accreditations with expiry dates: each client's (BOC importer accreditation, SPS import
-- clearances, FDA licenses...) and the office's own (broker's license, business permit...). The app
-- warns 30 days before expiry and on a shipment whose client has one lapsed. Office staff see them;
-- owner and processors keep them up to date; only the owner deletes.
create table if not exists public.permits (
  id bigint generated always as identity primary key,
  client_id uuid references public.clients(id) on delete cascade,     -- null = the office's own
  kind text not null check (kind in ('boc_accreditation', 'sps_clearance', 'fda_lto', 'fda_cpr', 'nmis', 'broker_license',
                                     'business_permit', 'bir_registration', 'other')),
  title text check (length(title) <= 120),                            -- e.g. which product or agency, for "other"
  reference_no text check (length(reference_no) <= 80),
  issued_on date,
  expires_on date not null,
  note text check (length(note) <= 300),
  renewed boolean not null default false,                             -- ticked once a newer one is recorded
  updated_by uuid default auth.uid() references auth.users(id) on delete set null,
  updated_at timestamptz not null default now(),
  check (issued_on is null or issued_on <= expires_on)
);
create index if not exists permits_expiry_idx on public.permits (expires_on) where not renewed;
create index if not exists permits_client_idx on public.permits (client_id);

alter table public.permits enable row level security;
create policy permits_select on public.permits for select to authenticated using (private.is_staff());
create policy permits_insert on public.permits for insert to authenticated
  with check (private.current_app_role() in ('owner'::public.app_role, 'processor'::public.app_role));
create policy permits_update on public.permits for update to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'processor'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'processor'::public.app_role));
create policy permits_delete on public.permits for delete to authenticated using (private.current_app_role() = 'owner'::public.app_role);
revoke all on public.permits from anon;
grant select, insert, update, delete on public.permits to authenticated;

create or replace function public.touch_permit()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); new.updated_by := auth.uid(); return new; end $$;
revoke all on function public.touch_permit() from public, anon, authenticated;
create trigger touch_permit before update on public.permits for each row execute function public.touch_permit();
create trigger audit_permits after insert or update or delete on public.permits for each row execute function public.audit_row();

do $$
declare src text;
begin
  select pg_get_functiondef('private.make_backup()'::regprocedure) into src;
  if position('''permits''' in src) = 0 then
    src := replace(src, '''app_settings'', (select',
      '''permits'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.permits t),
    ''app_settings'', (select');
    execute src;
  end if;
end $$;
