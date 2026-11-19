-- Phase 3, BIR documents: computer-printed Sales Invoices (for VSA's own services) and Collection
-- Receipts (for payments received), numbered by the database without gaps or reuse. A wrong document
-- is voided with a reason, never deleted or edited, and the charges or payment it covers are locked
-- while it stands. The office's BIR registration details are kept once, by the owner.

-- 1. The office's BIR details (one row). Only the owner changes them.
create table if not exists public.bir_settings (
  id boolean primary key default true check (id),
  registered_name text, trade_name text, tin text, branch_code text not null default '00000', address text,
  vat_registered boolean not null default true,
  permit_no text,           -- BIR Acknowledgement Certificate / Permit to Use for computer-printed invoices
  permit_date date,
  invoice_prefix text not null default '', invoice_from int check (invoice_from > 0), invoice_to int,
  receipt_prefix text not null default '', receipt_from int check (receipt_from > 0), receipt_to int,
  check (invoice_to is null or invoice_from is null or invoice_to >= invoice_from),
  check (receipt_to is null or receipt_from is null or receipt_to >= receipt_from),
  updated_at timestamptz not null default now(),
  updated_by uuid default auth.uid() references auth.users(id) on delete set null
);
insert into public.bir_settings (id) values (true) on conflict (id) do nothing;
create index if not exists bir_settings_by_idx on public.bir_settings (updated_by);
alter table public.bir_settings enable row level security;
create policy bir_settings_select on public.bir_settings for select to authenticated using (private.is_staff());
create policy bir_settings_update on public.bir_settings for update to authenticated
  using (private.current_app_role() = 'owner'::public.app_role) with check (private.current_app_role() = 'owner'::public.app_role);
create trigger touch_bir_settings before update on public.bir_settings for each row execute function public.touch_rate_row();
create trigger audit_bir_settings after insert or update or delete on public.bir_settings for each row execute function public.audit_row();

-- 2. Withholding tax the client deducted (BIR Form 2307) counts toward what they paid.
alter table public.payments add column if not exists ewt_amount numeric(14,2) not null default 0 check (ewt_amount >= 0);

-- 3. Issued documents. Nobody writes them directly: only the issue and void functions below.
create table if not exists public.bir_documents (
  id bigint generated always as identity primary key,
  doc_type text not null check (doc_type in ('invoice', 'receipt')),
  serial_no int not null,
  doc_no text not null,                         -- prefix + zero-padded serial, as printed
  job_id uuid not null references public.jobs(id) on delete restrict,
  payment_id bigint references public.payments(id) on delete set null,   -- kept until voided (see lock trigger)
  issued_on date not null default (now() at time zone 'Asia/Manila')::date,
  issued_at timestamptz not null default now(),
  issued_by uuid references auth.users(id) on delete set null,
  issued_by_name text,
  buyer_name text not null, buyer_tin text, buyer_address text,
  lines jsonb not null,                         -- [{description, amount, vatable}]
  vatable_sales numeric(14,2) not null default 0, vat_amount numeric(14,2) not null default 0,
  exempt_sales numeric(14,2) not null default 0, zero_rated numeric(14,2) not null default 0,
  total numeric(14,2) not null default 0,       -- invoice: amount due; receipt: cash + withholding settled
  amount_received numeric(14,2), ewt_amount numeric(14,2) not null default 0,
  seller jsonb not null,                        -- the BIR details as they were when issued
  voided boolean not null default false, void_reason text, voided_at timestamptz,
  voided_by uuid references auth.users(id) on delete set null,
  unique (doc_type, serial_no),
  check (doc_type = 'receipt' or payment_id is null)
);
create index if not exists bir_documents_job_idx on public.bir_documents (job_id);
create index if not exists bir_documents_payment_idx on public.bir_documents (payment_id);
create index if not exists bir_documents_issued_idx on public.bir_documents (issued_on);
create index if not exists bir_documents_issued_by_idx on public.bir_documents (issued_by);
create index if not exists bir_documents_voided_by_idx on public.bir_documents (voided_by);
alter table public.bir_documents enable row level security;
create policy bir_documents_select on public.bir_documents for select to authenticated using (private.is_staff());
create trigger audit_bir_documents after insert or update or delete on public.bir_documents for each row execute function public.audit_row();

alter table public.charges add column if not exists invoice_id bigint references public.bir_documents(id) on delete restrict;
alter table public.payments add column if not exists receipt_id bigint references public.bir_documents(id) on delete restrict;
create index if not exists charges_invoice_idx on public.charges (invoice_id);
create index if not exists payments_receipt_idx on public.payments (receipt_id);

-- 4. A charge on an invoice, or a payment with a receipt, cannot be changed or removed.
--    Only the void function (which sets the private flag) may release it.
create or replace function private.lock_billed_rows()
returns trigger language plpgsql set search_path = '' as $$
declare col text := case when tg_table_name = 'charges' then 'invoice_id' else 'receipt_id' end;
  doc bigint := (to_jsonb(old) ->> col)::bigint;
begin
  if coalesce(current_setting('vsa.bir_internal', true), '') = 'on' then return coalesce(new, old); end if;
  if tg_op = 'UPDATE' and (to_jsonb(new) ->> col) is distinct from (to_jsonb(old) ->> col) then
    raise exception 'BIR documents are issued with the Issue buttons on the Billing section, not by editing.';
  end if;
  if doc is not null then
    raise exception 'This is on BIR document %. Void that document first if it is wrong.',
      (select doc_no from public.bir_documents where id = doc);
  end if;
  return coalesce(new, old);
end $$;
revoke all on function private.lock_billed_rows() from public, anon, authenticated;
create trigger lock_invoiced_charges before update or delete on public.charges for each row execute function private.lock_billed_rows();
create trigger lock_receipted_payments before update or delete on public.payments for each row execute function private.lock_billed_rows();
-- New charges and payments start without a document.
create or replace function private.no_doc_on_insert()
returns trigger language plpgsql set search_path = '' as $$
begin
  if current_setting('vsa.bir_internal', true) = 'on' then return new; end if;
  if tg_table_name = 'charges' then new.invoice_id := null; else new.receipt_id := null; end if;
  return new;
end $$;
revoke all on function private.no_doc_on_insert() from public, anon, authenticated;
create trigger no_invoice_on_insert before insert on public.charges for each row execute function private.no_doc_on_insert();
create trigger no_receipt_on_insert before insert on public.payments for each row execute function private.no_doc_on_insert();

-- 5. The next number in a series, under a lock so two people never get the same one.
create or replace function private.next_bir_no(p_type text, s public.bir_settings)
returns int language plpgsql set search_path = '' as $$
declare n int; lo int; hi int;
begin
  lo := case p_type when 'invoice' then s.invoice_from else s.receipt_from end;
  hi := case p_type when 'invoice' then s.invoice_to else s.receipt_to end;
  if lo is null or hi is null then
    raise exception 'Set the % number series in BIR books → BIR details first.', case p_type when 'invoice' then 'sales invoice' else 'collection receipt' end;
  end if;
  select coalesce(max(serial_no) + 1, lo) into n from public.bir_documents where doc_type = p_type;
  n := greatest(n, lo);
  if n > hi then
    raise exception 'The % series is used up (last no. %). Register a new series with BIR and enter it in BIR details.',
      case p_type when 'invoice' then 'sales invoice' else 'collection receipt' end, hi;
  end if;
  return n;
end $$;
revoke all on function private.next_bir_no(text, public.bir_settings) from public, anon, authenticated;

create or replace function private.check_bir_ready(s public.bir_settings)
returns void language plpgsql set search_path = '' as $$
begin
  if private.current_app_role() not in ('owner'::public.app_role, 'billing'::public.app_role) then
    raise exception 'Only the owner and billing staff issue BIR documents.';
  end if;
  if coalesce(trim(s.registered_name), '') = '' or coalesce(trim(s.tin), '') = '' or coalesce(trim(s.address), '') = '' then
    raise exception 'Fill in the registered name, TIN and address in BIR books → BIR details first.';
  end if;
  if coalesce(trim(s.permit_no), '') = '' then
    raise exception 'Enter the BIR permit / acknowledgement certificate no. in BIR details first. Until then, use Preview (specimen).';
  end if;
end $$;
revoke all on function private.check_bir_ready(public.bir_settings) from public, anon, authenticated;

-- 6. Issue a Sales Invoice for the shipment's services that are not on an invoice yet.
--    Advances paid for the client (duties, arrastre…) are not sales and stay off the invoice.
create or replace function public.issue_sales_invoice(p_job uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.bir_settings; n int; doc bigint; c record;
  v_lines jsonb; v_vatable numeric; v_vat numeric; v_exempt numeric;
begin
  select * into s from public.bir_settings where id for update;
  perform private.check_bir_ready(s);
  select coalesce(jsonb_agg(jsonb_build_object('description', coalesce(nullif(trim(ch.description), ''), initcap(replace(ch.kind, '_', ' '))),
           'kind', ch.kind, 'amount', ch.amount, 'vatable', ch.vatable and s.vat_registered) order by ch.id), '[]'::jsonb),
         coalesce(sum(ch.amount) filter (where ch.vatable and s.vat_registered), 0),
         coalesce(sum(round(ch.amount * 0.12, 2)) filter (where ch.vatable and s.vat_registered), 0),
         coalesce(sum(ch.amount) filter (where not (ch.vatable and s.vat_registered)), 0)
    into v_lines, v_vatable, v_vat, v_exempt
    from public.charges ch where ch.job_id = p_job and ch.invoice_id is null and not ch.advance;
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'There are no service charges on this shipment that are not on an invoice yet.';
  end if;
  select j.job_no, cl.name, cl.tin, cl.address into c
    from public.jobs j join public.clients cl on cl.id = j.client_id where j.id = p_job;
  n := private.next_bir_no('invoice', s);
  insert into public.bir_documents (doc_type, serial_no, doc_no, job_id, issued_by, issued_by_name, buyer_name, buyer_tin, buyer_address,
      lines, vatable_sales, vat_amount, exempt_sales, total, seller)
    values ('invoice', n, s.invoice_prefix || lpad(n::text, 6, '0'), p_job, auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()),
      c.name, c.tin, c.address, v_lines, v_vatable, v_vat, v_exempt, v_vatable + v_vat + v_exempt,
      to_jsonb(s) - 'updated_by' - 'updated_at')
    returning id into doc;
  perform set_config('vsa.bir_internal', 'on', true);
  update public.charges set invoice_id = doc where job_id = p_job and invoice_id is null and not advance;
  perform set_config('vsa.bir_internal', 'off', true);
  return doc;
end $$;
revoke all on function public.issue_sales_invoice(uuid) from public, anon;
grant execute on function public.issue_sales_invoice(uuid) to authenticated;

-- 7. Issue a Collection Receipt for one recorded payment.
create or replace function public.issue_collection_receipt(p_payment bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.bir_settings; n int; doc bigint; p public.payments; c record; invs text;
begin
  select * into s from public.bir_settings where id for update;
  perform private.check_bir_ready(s);
  select * into p from public.payments where id = p_payment for update;
  if p.id is null then raise exception 'Payment not found.'; end if;
  if p.receipt_id is not null then
    raise exception 'This payment already has receipt %.', (select doc_no from public.bir_documents where id = p.receipt_id);
  end if;
  select j.job_no, j.soa_no, cl.name, cl.tin, cl.address into c
    from public.jobs j join public.clients cl on cl.id = j.client_id where j.id = p.job_id;
  select string_agg(doc_no, ', ' order by serial_no) into invs
    from public.bir_documents where job_id = p.job_id and doc_type = 'invoice' and not voided;
  n := private.next_bir_no('receipt', s);
  insert into public.bir_documents (doc_type, serial_no, doc_no, job_id, payment_id, issued_on, issued_by, issued_by_name,
      buyer_name, buyer_tin, buyer_address, lines, total, amount_received, ewt_amount, seller)
    values ('receipt', n, s.receipt_prefix || lpad(n::text, 6, '0'), p.job_id, p.id, (now() at time zone 'Asia/Manila')::date, auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()),
      c.name, c.tin, c.address,
      jsonb_build_array(jsonb_build_object('description',
        'Payment for PN ' || c.job_no || coalesce(', SOA ' || c.soa_no, '') || coalesce(', Sales Invoice ' || invs, '')
        || ', received ' || to_char(p.paid_on, 'Mon DD, YYYY')
        || coalesce(' by ' || replace(p.method, '_', ' ') || coalesce(' ' || p.reference, ''), ''), 'amount', p.amount + p.ewt_amount)),
      p.amount + p.ewt_amount, p.amount, p.ewt_amount, to_jsonb(s) - 'updated_by' - 'updated_at')
    returning id into doc;
  perform set_config('vsa.bir_internal', 'on', true);
  update public.payments set receipt_id = doc where id = p.id;
  perform set_config('vsa.bir_internal', 'off', true);
  return doc;
end $$;
revoke all on function public.issue_collection_receipt(bigint) from public, anon;
grant execute on function public.issue_collection_receipt(bigint) to authenticated;

-- 8. Void a document: it keeps its number (shown as VOID in the books) and frees what it covered.
create or replace function public.void_bir_document(p_doc bigint, p_reason text)
returns void language plpgsql security definer set search_path = '' as $$
declare d public.bir_documents;
begin
  if private.current_app_role() not in ('owner'::public.app_role, 'billing'::public.app_role) then
    raise exception 'Only the owner and billing staff void BIR documents.';
  end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Give the reason for voiding (at least 5 letters).'; end if;
  select * into d from public.bir_documents where id = p_doc for update;
  if d.id is null then raise exception 'Document not found.'; end if;
  if d.voided then raise exception 'Document % is already void.', d.doc_no; end if;
  perform set_config('vsa.bir_internal', 'on', true);
  update public.bir_documents set voided = true, void_reason = trim(p_reason), voided_at = now(), voided_by = auth.uid() where id = p_doc;
  update public.charges set invoice_id = null where invoice_id = p_doc;
  update public.payments set receipt_id = null where receipt_id = p_doc;
  perform set_config('vsa.bir_internal', 'off', true);
end $$;
revoke all on function public.void_bir_document(bigint, text) from public, anon;
grant execute on function public.void_bir_document(bigint, text) to authenticated;

-- Even the owner cannot rewrite an issued document outside the void function.
create or replace function private.guard_bir_documents()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' then raise exception 'BIR documents are never deleted; void them instead.'; end if;
  -- A payment removed after its receipt was voided: the void receipt keeps its number, without the link.
  if old.voided and new.payment_id is null and old.payment_id is not null
     and (to_jsonb(new) - 'payment_id') = (to_jsonb(old) - 'payment_id') then return new; end if;
  if coalesce(current_setting('vsa.bir_internal', true), '') <> 'on' then raise exception 'BIR documents cannot be edited; void and issue a new one.'; end if;
  if (to_jsonb(new) - 'voided' - 'void_reason' - 'voided_at' - 'voided_by') <> (to_jsonb(old) - 'voided' - 'void_reason' - 'voided_at' - 'voided_by') then
    raise exception 'Only the void details of a BIR document can change.';
  end if;
  return new;
end $$;
revoke all on function private.guard_bir_documents() from public, anon, authenticated;
create trigger guard_bir_documents before update or delete on public.bir_documents for each row execute function private.guard_bir_documents();

-- 9. Backups keep the BIR details and documents too.
do $$
declare src text;
begin
  select pg_get_functiondef('private.make_backup()'::regprocedure) into src;
  if position('bir_documents' in src) = 0 then
    src := replace(src, '''app_settings'', (select',
      '''bir_settings'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.bir_settings t),
    ''bir_documents'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.bir_documents t),
    ''app_settings'', (select');
    execute src;
  end if;
end $$;
