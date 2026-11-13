-- Phase 2, billing and collections: charges and payments per shipment, SOA number and billed date,
-- and payment terms per client. Owner and billing staff record them; every staff member can view.

alter table public.clients add column if not exists payment_terms_days integer not null default 30 check (payment_terms_days between 0 and 365);
alter table public.jobs add column if not exists soa_no text, add column if not exists billed_on date;

create table if not exists public.charges (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  kind text not null check (kind in ('brokerage_fee','duties_taxes','arrastre','wharfage','storage','demurrage','trucking','documentation','other')),
  description text,
  amount numeric(12,2) not null check (amount >= 0),
  vatable boolean not null default false,        -- 12% VAT is added on top
  advance boolean not null default false,        -- paid by VSA on the client's behalf (reimbursable)
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists charges_job_idx on public.charges (job_id);
create index if not exists charges_by_idx on public.charges (created_by);

create table if not exists public.payments (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  amount numeric(12,2) not null check (amount > 0),
  paid_on date not null default ((now() at time zone 'Asia/Manila')::date),
  method text check (method in ('cash','check','bank_transfer','online','other')),
  reference text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists payments_job_idx on public.payments (job_id);
create index if not exists payments_by_idx on public.payments (created_by);

alter table public.charges enable row level security;
alter table public.payments enable row level security;
create policy charges_select on public.charges for select to authenticated using (private.is_staff());
create policy charges_write on public.charges for all to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy payments_select on public.payments for select to authenticated using (private.is_staff());
create policy payments_write on public.payments for all to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));

create trigger audit_charges after insert or update or delete on public.charges for each row execute function public.audit_row();
create trigger audit_payments after insert or update or delete on public.payments for each row execute function public.audit_row();

-- Billing staff may now also set a shipment's SOA no. and billed date (still nothing else but the status).
create or replace function public.enforce_job_rules()
returns trigger language plpgsql set search_path = '' as $$
declare r public.app_role := private.current_app_role();
        keep text[];
begin
  if new.service_type = 'brokerage'::public.service_type
     and new.status >= 'lodged'::public.job_status
     and coalesce(trim(new.entry_no), '') = '' then
    raise exception 'Enter the entry number before moving a brokerage job to Lodged or later';
  end if;
  if tg_op = 'INSERT' then return new; end if;

  if r in ('dispatcher'::public.app_role, 'billing'::public.app_role) then
    keep := case when r = 'billing'::public.app_role then array['status','updated_at','soa_no','billed_on'] else array['status','updated_at'] end;
    if (to_jsonb(new) - keep) is distinct from (to_jsonb(old) - keep) then
      raise exception 'Your role can only change the job status%', case when r = 'billing'::public.app_role then ', SOA no. and billed date' else '' end;
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
end $$;
