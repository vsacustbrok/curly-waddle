-- 1. Role helpers move out of the public API schema, so they can no longer be called
--    through /rest/v1/rpc. Policies keep working: they refer to the functions themselves.
create schema if not exists private;
grant usage on schema private to anon, authenticated, service_role;
alter function public.current_app_role() set schema private;
alter function public.is_staff() set schema private;

create or replace function private.is_staff() returns boolean
  language sql stable security definer set search_path to '' as $$
  select auth.uid() is not null and private.current_app_role() <> 'pending'::public.app_role
$$;

create or replace function public.enforce_job_rules() returns trigger
  language plpgsql set search_path to '' as $function$
declare r public.app_role := private.current_app_role();
begin
  if new.service_type = 'brokerage'::public.service_type
     and new.status >= 'lodged'::public.job_status
     and coalesce(trim(new.entry_no), '') = '' then
    raise exception 'Enter the entry number before moving a brokerage job to Lodged or later';
  end if;
  if tg_op = 'INSERT' then return new; end if;

  if r in ('dispatcher'::public.app_role, 'billing'::public.app_role) then
    if (to_jsonb(new) - 'status' - 'updated_at') is distinct from (to_jsonb(old) - 'status' - 'updated_at') then
      raise exception 'Your role can only change the job status';
    end if;
    if new.status is distinct from old.status then
      if r = 'dispatcher'::public.app_role and new.status <> 'delivered'::public.job_status then
        raise exception 'Dispatchers can only mark a job as Delivered';
      end if;
      if r = 'billing'::public.app_role and new.status not in ('paid'::public.job_status, 'billed'::public.job_status) then
        raise exception 'Billing can only mark a job as Paid or Billed';
      end if;
    end if;
  end if;

  if new.status < old.status and r <> 'owner'::public.app_role then
    raise exception 'Only the owner can move a job back to an earlier status';
  end if;
  if new.status = 'billed'::public.job_status and old.status not in ('delivered'::public.job_status, 'billed'::public.job_status) then
    raise exception 'A job must be Delivered before it is Billed';
  end if;
  return new;
end $function$;

create or replace function public.guard_profile() returns trigger
  language plpgsql security definer set search_path to '' as $function$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and private.current_app_role() <> 'owner'::public.app_role then
      new.role := old.role;
      new.email := old.email;
    end if;
  end if;
  if old.role = 'owner'::public.app_role and (tg_op = 'DELETE' or new.role <> 'owner'::public.app_role) then
    if not exists (select 1 from public.profiles where role = 'owner'::public.app_role and id <> old.id) then
      raise exception 'There must always be at least one owner';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $function$;

-- 2. Sign-up by invitation only. The owner lists the emails that may create an account,
--    with the role each one starts with.
create table public.invites (
  email text primary key check (email = lower(trim(email)) and email like '%_@_%'),
  role public.app_role not null default 'pending',
  invited_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now()
);
alter table public.invites enable row level security;
create policy invites_owner on public.invites for all to authenticated
  using (private.current_app_role() = 'owner'::public.app_role)
  with check (private.current_app_role() = 'owner'::public.app_role);
grant select, insert, update, delete on public.invites to authenticated;
create trigger audit_invites after insert or update or delete on public.invites
  for each row execute function public.audit_row();

create or replace function private.require_invite() returns trigger
  language plpgsql security definer set search_path to '' as $function$
begin
  -- The very first account becomes the owner and needs no invitation.
  if not exists (select 1 from public.profiles) then return new; end if;
  if exists (select 1 from public.invites where email = lower(trim(new.email))) then return new; end if;
  raise exception 'This email has not been invited';
end $function$;
revoke execute on function private.require_invite() from public, anon, authenticated;
create trigger require_invite before insert on auth.users
  for each row execute function private.require_invite();

create or replace function public.handle_new_user() returns trigger
  language plpgsql security definer set search_path to '' as $function$
begin
  insert into public.profiles(id, email, full_name, role)
  values (
    new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name',''),
    case when not exists (select 1 from public.profiles) then 'owner'::public.app_role
         else coalesce((select role from public.invites where email = lower(trim(new.email))), 'pending'::public.app_role) end
  );
  return new;
end $function$;

-- 3. A snapshot of every table is taken each night and the last 14 are kept.
--    Only the owner can read them (to download from the Security page).
create table public.backups (
  id bigint generated always as identity primary key,
  created_at timestamptz not null default now(),
  size_bytes integer not null,
  data jsonb not null
);
alter table public.backups enable row level security;
create policy backups_owner_read on public.backups for select to authenticated
  using (private.current_app_role() = 'owner'::public.app_role);
grant select on public.backups to authenticated;

create or replace function private.make_backup() returns bigint
  language plpgsql security definer set search_path to '' as $function$
declare d jsonb; new_id bigint;
begin
  d := jsonb_build_object(
    'made_at', now(),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.clients t),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.jobs t),
    'job_documents', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_documents t),
    'scan_results', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.scan_results t),
    'job_status_history', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_status_history t),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.profiles t),
    'invites', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.invites t),
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.app_settings t),
    'audit_log', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.audit_log t)
  );
  insert into public.backups(size_bytes, data) values (octet_length(d::text), d) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 14);
  return new_id;
end $function$;
revoke execute on function private.make_backup() from public, anon, authenticated;

create extension if not exists pg_cron;
-- 17:00 UTC is 1:00 in the morning in Manila.
select cron.schedule('nightly-backup', '0 17 * * *', 'select private.make_backup()');
select private.make_backup();
