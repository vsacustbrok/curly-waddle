-- BL release dates, sent dates for the final SAD and SSDT, entry status Filed / Assessed / Paid,
-- and a dated day-to-day status log for each shipment.
alter table public.jobs drop constraint if exists jobs_entry_status_check;
update public.jobs set entry_status = null where entry_status not in ('filed', 'assessed', 'paid');
alter table public.jobs add constraint jobs_entry_status_check check (entry_status in ('filed', 'assessed', 'paid'));

alter table public.jobs drop constraint if exists jobs_bl_release_type_check;
alter table public.jobs add constraint jobs_bl_release_type_check check (bl_release_type in ('cro', 'original', 'telex', 'seaway'));

alter table public.jobs
  add column cro_valid_until date,
  add column obl_pickup_date date,
  add column obl_shipping_date date,
  add column telex_release_date date,
  add column final_sad_sent_date date,
  add column ssdt_sent_date date;

create table public.job_notes (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  note_date date not null default (now() at time zone 'Asia/Manila')::date,
  body text not null check (length(trim(body)) > 0),
  author_id uuid references auth.users(id) on delete set null default auth.uid(),
  author_name text,
  created_at timestamptz not null default now()
);
create index job_notes_job_idx on public.job_notes(job_id, note_date desc, id desc);
alter table public.job_notes enable row level security;
create policy notes_select on public.job_notes for select to authenticated using (private.is_staff());
create policy notes_insert on public.job_notes for insert to authenticated
  with check (private.is_staff() and author_id = (select auth.uid()));
create policy notes_delete on public.job_notes for delete to authenticated
  using (author_id = (select auth.uid()) or private.current_app_role() = 'owner'::public.app_role);
grant select, insert, delete on public.job_notes to authenticated;

create or replace function private.set_note_author() returns trigger
  language plpgsql security definer set search_path to '' as $$
begin
  new.author_id := auth.uid();
  select coalesce(nullif(full_name, ''), email) into new.author_name from public.profiles where id = auth.uid();
  return new;
end $$;
revoke execute on function private.set_note_author() from public, anon, authenticated;
create trigger job_notes_author before insert on public.job_notes for each row execute function private.set_note_author();
create trigger audit_job_notes after insert or update or delete on public.job_notes for each row execute function public.audit_row();

-- Nightly backups include the status log.
create or replace function private.make_backup() returns bigint
  language plpgsql security definer set search_path to '' as $function$
declare d jsonb; new_id bigint;
begin
  d := jsonb_build_object(
    'made_at', now(),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.clients t),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.jobs t),
    'job_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_notes t),
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
