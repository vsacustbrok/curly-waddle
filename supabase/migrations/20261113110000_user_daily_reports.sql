-- Each team member's own report for a day. People see and edit their own; the owner reads everyone's.
create table public.user_reports (
  id bigint generated always as identity primary key,
  user_id uuid not null references auth.users(id) on delete cascade default auth.uid(),
  report_date date not null default (now() at time zone 'Asia/Manila')::date,
  body text not null check (length(trim(body)) > 0),
  author_name text,
  updated_at timestamptz not null default now(),
  unique (user_id, report_date)
);
alter table public.user_reports enable row level security;
create policy reports_select on public.user_reports for select to authenticated
  using (user_id = (select auth.uid()) or private.current_app_role() = 'owner'::public.app_role);
create policy reports_insert on public.user_reports for insert to authenticated
  with check (private.is_staff() and user_id = (select auth.uid()));
create policy reports_update on public.user_reports for update to authenticated
  using (user_id = (select auth.uid())) with check (user_id = (select auth.uid()));
create policy reports_delete on public.user_reports for delete to authenticated using (user_id = (select auth.uid()));
grant select, insert, update, delete on public.user_reports to authenticated;

create or replace function private.stamp_user_report() returns trigger
  language plpgsql security definer set search_path to '' as $$
begin
  new.user_id := auth.uid();
  new.updated_at := now();
  select coalesce(nullif(full_name, ''), email) into new.author_name from public.profiles where id = auth.uid();
  return new;
end $$;
revoke execute on function private.stamp_user_report() from public, anon, authenticated;
create trigger user_reports_stamp before insert or update on public.user_reports for each row execute function private.stamp_user_report();

-- Nightly backups include the personal reports.
create or replace function private.make_backup() returns bigint
  language plpgsql security definer set search_path to '' as $function$
declare d jsonb; new_id bigint;
begin
  d := jsonb_build_object(
    'made_at', now(),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.clients t),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.jobs t),
    'job_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_notes t),
    'user_reports', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.user_reports t),
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
