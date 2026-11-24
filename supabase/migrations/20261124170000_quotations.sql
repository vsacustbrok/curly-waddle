-- Quotations: the office's standard fees, quotes to clients or prospects built from them, and turning
-- an accepted quote into a shipment (or adding it to one) with its charges filled in.
create table if not exists public.standard_fees (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) between 1 and 120),
  kind text not null check (kind in ('brokerage_fee', 'duties_taxes', 'arrastre', 'wharfage', 'storage', 'demurrage', 'trucking', 'documentation', 'other')),
  amount numeric(14,2) not null check (amount >= 0),
  vatable boolean not null default true,
  advance boolean not null default false,
  sort int not null default 0,
  check (not (advance and vatable))
);
alter table public.standard_fees enable row level security;
create policy standard_fees_select on public.standard_fees for select to authenticated using (private.is_staff());
create policy standard_fees_write on public.standard_fees for all to authenticated
  using (private.current_app_role() = 'owner'::public.app_role) with check (private.current_app_role() = 'owner'::public.app_role);
revoke all on public.standard_fees from anon;
grant select, insert, update, delete on public.standard_fees to authenticated;

create table if not exists public.quotations (
  id bigint generated always as identity primary key,
  quote_no text unique,
  client_id uuid references public.clients(id) on delete set null,
  prospect_name text check (length(prospect_name) <= 160),
  prospect_email text check (length(prospect_email) <= 320),
  service_type public.service_type not null default 'brokerage',
  cargo text check (length(cargo) <= 300),
  route text check (length(route) <= 200),
  lines jsonb not null default '[]'::jsonb check (jsonb_typeof(lines) = 'array'),
  valid_until date,
  terms text check (length(terms) <= 1500),
  status text not null default 'draft' check (status in ('draft', 'sent', 'accepted', 'declined')),
  job_id uuid references public.jobs(id) on delete set null,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check (client_id is not null or length(trim(coalesce(prospect_name, ''))) > 0)
);
create index if not exists quotations_status_idx on public.quotations (status, created_at desc);

create or replace function public.stamp_quotation()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then new.quote_no := 'Q-' || lpad(new.id::text, 5, '0'); end if;
  if tg_op = 'UPDATE' then
    new.quote_no := old.quote_no;
    if old.status = 'accepted' and coalesce(current_setting('vsa.quote_internal', true), '') <> 'on'
       and (to_jsonb(new) - 'updated_at' - 'job_id') <> (to_jsonb(old) - 'updated_at' - 'job_id') then
      raise exception 'This quotation is accepted and can no longer change.';
    end if;
    if new.status = 'accepted' and old.status <> 'accepted' and coalesce(current_setting('vsa.quote_internal', true), '') <> 'on' then
      raise exception 'Use Accept to accept a quotation.';
    end if;
  end if;
  new.updated_at := now();
  return new;
end $$;
revoke all on function public.stamp_quotation() from public, anon, authenticated;
create trigger stamp_quotation before insert or update on public.quotations for each row execute function public.stamp_quotation();

alter table public.quotations enable row level security;
create policy quotations_select on public.quotations for select to authenticated using (private.is_staff());
create policy quotations_insert on public.quotations for insert to authenticated
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role, 'processor'::public.app_role));
create policy quotations_update on public.quotations for update to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role, 'processor'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role, 'processor'::public.app_role));
create policy quotations_delete on public.quotations for delete to authenticated
  using (private.current_app_role() = 'owner'::public.app_role and status <> 'accepted');
revoke all on public.quotations from anon;
grant select, insert, update, delete on public.quotations to authenticated;

-- Accept: make the shipment (or use p_job), add the quote's lines as its charges, mark the quote accepted.
create or replace function public.accept_quotation(p_quote bigint, p_job uuid default null)
returns uuid language plpgsql security definer set search_path = '' as $$
declare q public.quotations; cid uuid; jid uuid; l jsonb; k text; amt numeric; adv boolean; vat boolean;
begin
  if private.current_app_role() not in ('owner'::public.app_role, 'billing'::public.app_role) then
    raise exception 'Only the owner and billing staff accept quotations (it adds charges).';
  end if;
  select * into q from public.quotations where id = p_quote for update;
  if q.id is null then raise exception 'Quotation not found.'; end if;
  if q.status = 'accepted' then raise exception 'Quotation % is already accepted.', q.quote_no; end if;
  if jsonb_array_length(q.lines) = 0 then raise exception 'The quotation has no lines.'; end if;
  if p_job is not null then
    select id, client_id into jid, cid from public.jobs where id = p_job;
    if jid is null then raise exception 'Shipment not found.'; end if;
    if q.client_id is not null and q.client_id <> cid then raise exception 'That shipment belongs to another client.'; end if;
  else
    cid := q.client_id;
    if cid is null then
      insert into public.clients (name, email) values (trim(q.prospect_name), nullif(trim(q.prospect_email), '')) returning id into cid;
    end if;
    insert into public.jobs (client_id, service_type, item_description) values (cid, q.service_type, q.cargo) returning id into jid;
  end if;
  for l in select * from jsonb_array_elements(q.lines) loop
    k := l->>'kind';
    amt := (l->>'amount')::numeric;
    adv := coalesce((l->>'advance')::boolean, false);
    vat := coalesce((l->>'vatable')::boolean, false) and not adv;
    if k is null or amt is null or amt < 0 then raise exception 'A quotation line is incomplete.'; end if;
    insert into public.charges (job_id, kind, description, amount, vatable, advance, created_by)
      values (jid, k, left(nullif(trim(l->>'description'), ''), 200), amt, vat, adv, auth.uid());
  end loop;
  perform set_config('vsa.quote_internal', 'on', true);
  update public.quotations set status = 'accepted', job_id = jid, client_id = cid where id = q.id;
  perform set_config('vsa.quote_internal', 'off', true);
  return jid;
end $$;
revoke all on function public.accept_quotation(bigint, uuid) from public, anon;
grant execute on function public.accept_quotation(bigint, uuid) to authenticated;

create trigger audit_quotations after insert or update or delete on public.quotations for each row execute function public.audit_row();
create trigger audit_standard_fees after insert or update or delete on public.standard_fees for each row execute function public.audit_row();

do $$
declare src text;
begin
  select pg_get_functiondef('private.make_backup()'::regprocedure) into src;
  if position('quotations' in src) = 0 then
    src := replace(src, '''app_settings'', (select',
      '''standard_fees'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.standard_fees t),
    ''quotations'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.quotations t),
    ''app_settings'', (select');
    execute src;
  end if;
end $$;
