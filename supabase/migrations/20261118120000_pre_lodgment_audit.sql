-- Pre-Lodgment Audit: broker sign-off before an entry is lodged with the BOC.
-- Builds on scan_results (one audit run), job_documents (uploaded files) and audit_log (who did what).

-- Who is a licensed customs broker. Only the owner can change it.
alter table public.profiles add column if not exists licensed_broker boolean not null default false;

create or replace function public.guard_profile()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' then
    if auth.uid() is not null and private.current_app_role() <> 'owner'::public.app_role then
      new.role := old.role;
      new.email := old.email;
      new.licensed_broker := old.licensed_broker;
    end if;
  end if;
  if old.role = 'owner'::public.app_role and (tg_op = 'DELETE' or new.role <> 'owner'::public.app_role) then
    if not exists (select 1 from public.profiles where role = 'owner'::public.app_role and id <> old.id) then
      raise exception 'There must always be at least one owner';
    end if;
  end if;
  if tg_op = 'DELETE' then return old; end if;
  return new;
end $$;

create or replace function private.is_licensed_broker()
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce((select licensed_broker and role <> 'pending'::public.app_role and role <> 'rider'::public.app_role
                   from public.profiles where id = auth.uid()), false)
$$;
revoke all on function private.is_licensed_broker() from public, anon;
grant execute on function private.is_licensed_broker() to authenticated;

-- Shipment details the audit and the VASP export need.
alter table public.jobs
  add column if not exists required_docs text[] not null default '{}',
  add column if not exists port_of_entry text,
  add column if not exists vasp text,
  add column if not exists freight_amount numeric(14,2) check (freight_amount >= 0),
  add column if not exists insurance_amount numeric(14,2) check (insurance_amount >= 0),
  add column if not exists other_charges numeric(14,2) check (other_charges >= 0),
  add column if not exists charges_currency text,
  add column if not exists exchange_rate numeric(12,4) check (exchange_rate > 0);

-- The traffic light of each audit run, and the top model's HS review kept for re-use.
alter table public.scan_results
  add column if not exists light text check (light in ('red', 'yellow', 'green')),
  add column if not exists model_notes jsonb;

-- A licensed broker's review of one warning, with the reason. Stays attached while the warning recurs.
create table if not exists public.audit_reviews (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  scan_id uuid references public.scan_results(id) on delete set null,
  issue_key text not null,
  reason text not null check (length(trim(reason)) >= 5),
  reviewed_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  reviewed_by_name text,
  reviewed_at timestamptz not null default now(),
  unique (job_id, issue_key)
);
create index if not exists audit_reviews_scan_idx on public.audit_reviews (scan_id);
create index if not exists audit_reviews_by_idx on public.audit_reviews (reviewed_by);

-- "Approve for BOC Lodgment": who approved which audit run, and when.
create table if not exists public.lodgment_approvals (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  scan_id uuid not null references public.scan_results(id) on delete cascade,
  approved_by uuid not null default auth.uid() references auth.users(id) on delete restrict,
  approved_by_name text,
  approved_at timestamptz not null default now(),
  light text not null default 'green',
  docs_fingerprint text
);
create index if not exists lodgment_approvals_job_idx on public.lodgment_approvals (job_id, approved_at desc);
create index if not exists lodgment_approvals_scan_idx on public.lodgment_approvals (scan_id);
create index if not exists lodgment_approvals_by_idx on public.lodgment_approvals (approved_by);

-- Reviews: the reviewer is always the signed-in broker, with their name.
create or replace function public.stamp_audit_review()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if not private.is_licensed_broker() then
    raise exception 'Only a licensed customs broker can review audit warnings';
  end if;
  new.reviewed_by := auth.uid();
  new.reviewed_at := now();
  select coalesce(nullif(full_name, ''), email) into new.reviewed_by_name from public.profiles where id = auth.uid();
  return new;
end $$;
revoke all on function public.stamp_audit_review() from public, anon, authenticated;
create trigger stamp_audit_review before insert or update on public.audit_reviews
  for each row execute function public.stamp_audit_review();

-- Approvals: only on the shipment's latest audit, with no red issue and every warning reviewed.
create or replace function public.check_lodgment_approval()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s record; latest uuid; open_count int;
begin
  if not private.is_licensed_broker() then
    raise exception 'Only a licensed customs broker can approve a shipment for lodgment';
  end if;
  select id, job_id, issues, model_notes into s from public.scan_results where id = new.scan_id;
  if s.id is null or s.job_id <> new.job_id then raise exception 'That audit is not for this shipment'; end if;
  select id into latest from public.scan_results where job_id = new.job_id order by run_at desc, id desc limit 1;
  if latest <> s.id then raise exception 'Run the audit again: the documents have changed since this audit'; end if;
  if exists (select 1 from jsonb_array_elements(coalesce(s.issues, '[]'::jsonb)) i where i->>'severity' = 'error') then
    raise exception 'This shipment still has a red issue. Fix it before approving for lodgment';
  end if;
  select count(*) into open_count from jsonb_array_elements(coalesce(s.issues, '[]'::jsonb)) i
   where i->>'severity' = 'warning'
     and not exists (select 1 from public.audit_reviews r where r.job_id = new.job_id and r.issue_key = i->>'key');
  if open_count > 0 then
    raise exception 'Review every yellow warning (with a reason) before approving for lodgment';
  end if;
  new.approved_by := auth.uid();
  new.approved_at := now();
  new.light := 'green';
  new.docs_fingerprint := s.model_notes->>'fingerprint';
  select coalesce(nullif(full_name, ''), email) into new.approved_by_name from public.profiles where id = auth.uid();
  return new;
end $$;
revoke all on function public.check_lodgment_approval() from public, anon, authenticated;
create trigger check_lodgment_approval before insert on public.lodgment_approvals
  for each row execute function public.check_lodgment_approval();

alter table public.audit_reviews enable row level security;
alter table public.lodgment_approvals enable row level security;
create policy audit_reviews_select on public.audit_reviews for select to authenticated using (private.is_staff());
create policy audit_reviews_insert on public.audit_reviews for insert to authenticated with check (private.is_licensed_broker());
create policy audit_reviews_delete on public.audit_reviews for delete to authenticated using (private.is_licensed_broker());
create policy lodgment_approvals_select on public.lodgment_approvals for select to authenticated using (private.is_staff());
create policy lodgment_approvals_insert on public.lodgment_approvals for insert to authenticated with check (private.is_licensed_broker());
-- Approvals are a record: never edited or deleted from the app.

create trigger audit_audit_reviews after insert or update or delete on public.audit_reviews for each row execute function public.audit_row();
create trigger audit_lodgment_approvals after insert or update or delete on public.lodgment_approvals for each row execute function public.audit_row();

-- Every goods line read from the invoices, flat, for exports and reports. Uses the reader's row-level security.
create or replace view public.audit_line_items with (security_invoker = true) as
select d.job_id, d.id as document_id, d.file_name, (p.ord - 1)::int as part_no, (li.ord)::int as line_no,
       li.item->>'description' as description, li.item->>'hs_code' as hs_code,
       nullif(li.item->>'quantity', '')::numeric as quantity, nullif(li.item->>'unit_price', '')::numeric as unit_price,
       nullif(li.item->>'amount', '')::numeric as amount, p.part->>'currency' as currency
  from public.job_documents d
  cross join lateral jsonb_array_elements(coalesce(d.extracted->'parts', '[]'::jsonb)) with ordinality as p(part, ord)
  cross join lateral jsonb_array_elements(coalesce(p.part->'line_items', '[]'::jsonb)) with ordinality as li(item, ord)
 where p.part->>'doc_type_detected' = 'commercial_invoice' or d.doc_type = 'commercial_invoice';
grant select on public.audit_line_items to authenticated;

-- Excel uploads arrive as CSV text.
update storage.buckets set allowed_mime_types = array['application/pdf', 'image/png', 'image/jpeg', 'text/csv']
 where id = 'job-docs';

-- Nightly backup now also saves the audit reviews and approvals.
create or replace function private.make_backup()
returns bigint language plpgsql security definer set search_path = '' as $$
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
    'charges', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.charges t),
    'payments', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.payments t),
    'riders', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.riders t),
    'rider_logs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.rider_logs t),
    'rider_trips', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.rider_trips t),
    'audit_reviews', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.audit_reviews t),
    'lodgment_approvals', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.lodgment_approvals t),
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.app_settings t),
    'audit_log_last_30_days', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'at', t.at, 'user_email', t.user_email,
                                'table_name', t.table_name, 'record_id', t.record_id, 'action', t.action)), '[]'::jsonb)
                                from public.audit_log t where t.at > now() - interval '30 days')
  );
  insert into public.backups(size_bytes, data) values (octet_length(d::text), d) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 14);
  return new_id;
end $$;
