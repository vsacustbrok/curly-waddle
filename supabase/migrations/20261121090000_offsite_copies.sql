-- Off-site copies: each time the owner saves the full copy (backup + uploaded files) to their own
-- computer or drive, a row is kept so the app can remind them when the last one is getting old,
-- and so a later copy can hold only the files added since.
create table if not exists public.offsite_copies (
  id bigint generated always as identity primary key,
  made_at timestamptz not null default now(),
  made_by uuid default auth.uid() references auth.users(id) on delete set null,
  backup_id bigint,
  files_included int not null default 0 check (files_included >= 0),
  bytes bigint not null default 0 check (bytes >= 0),
  only_new_since timestamptz
);

alter table public.offsite_copies enable row level security;

drop policy if exists offsite_copies_owner_read on public.offsite_copies;
create policy offsite_copies_owner_read on public.offsite_copies for select to authenticated
  using (private.current_app_role() = 'owner'::public.app_role);

drop policy if exists offsite_copies_owner_add on public.offsite_copies;
create policy offsite_copies_owner_add on public.offsite_copies for insert to authenticated
  with check (private.current_app_role() = 'owner'::public.app_role and made_by = auth.uid());

revoke all on public.offsite_copies from anon, authenticated;
grant select, insert on public.offsite_copies to authenticated;
