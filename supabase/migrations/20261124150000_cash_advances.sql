-- Cash advances and liquidation: money handed to a processor or rider for duties, arrastre, shipping
-- line fees and so on; the receipts that liquidate it (each on a shipment, ready to bill to the client
-- as an advance); cash returned; and the balance still held. Office staff see them; the owner and
-- billing give and close advances; the person holding an advance adds their own receipts.

create table if not exists public.cash_advances (
  id bigint generated always as identity primary key,
  given_on date not null default ((now() at time zone 'Asia/Manila')::date),
  person_name text not null check (length(trim(person_name)) between 1 and 120),
  profile_id uuid references public.profiles(id) on delete set null,   -- the holder's login, when they have one
  amount numeric(14,2) not null check (amount > 0),
  purpose text check (length(purpose) <= 300),
  job_id uuid references public.jobs(id) on delete set null,          -- the main shipment, if for one
  status text not null default 'open' check (status in ('open', 'closed')),
  closed_at timestamptz,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now()
);
create index if not exists cash_advances_open_idx on public.cash_advances (status, given_on desc);

create table if not exists public.advance_lines (
  id bigint generated always as identity primary key,
  advance_id bigint not null references public.cash_advances(id) on delete cascade,
  kind text not null check (kind in ('spent', 'returned')),           -- spent on a cost, or cash given back
  job_id uuid references public.jobs(id) on delete set null,
  cost_kind text check (cost_kind in ('duties_taxes', 'arrastre', 'wharfage', 'storage', 'demurrage', 'trucking', 'documentation', 'other')),
  description text check (length(description) <= 200),
  receipt_no text check (length(receipt_no) <= 60),
  spent_on date not null default ((now() at time zone 'Asia/Manila')::date),
  amount numeric(14,2) not null check (amount > 0),
  billable boolean not null default true,                            -- false: office cost, not billed to the client
  photo_path text unique,
  charge_id bigint unique references public.charges(id) on delete set null,  -- the client charge made from it
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  check (kind = 'returned' or cost_kind is not null)
);
create index if not exists advance_lines_advance_idx on public.advance_lines (advance_id);
create index if not exists advance_lines_job_idx on public.advance_lines (job_id);

-- Who may handle money: owner and billing.
create or replace function private.is_money_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role)
$$;
revoke all on function private.is_money_staff() from public, anon;
grant execute on function private.is_money_staff() to authenticated;

-- The signed-in person holds this advance and it is still open.
create or replace function private.holds_open_advance(p_advance bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.cash_advances a where a.id = p_advance and a.status = 'open' and a.profile_id = auth.uid())
$$;
revoke all on function private.holds_open_advance(bigint) from public, anon;
grant execute on function private.holds_open_advance(bigint) to authenticated;

alter table public.cash_advances enable row level security;
create policy cash_advances_select on public.cash_advances for select to authenticated using (private.is_staff());
create policy cash_advances_insert on public.cash_advances for insert to authenticated with check (private.is_money_staff());
create policy cash_advances_update on public.cash_advances for update to authenticated using (private.is_money_staff()) with check (private.is_money_staff());
create policy cash_advances_delete on public.cash_advances for delete to authenticated using (private.current_app_role() = 'owner'::public.app_role);
revoke all on public.cash_advances from anon;
grant select, insert, update, delete on public.cash_advances to authenticated;

alter table public.advance_lines enable row level security;
create policy advance_lines_select on public.advance_lines for select to authenticated using (private.is_staff());
create policy advance_lines_insert on public.advance_lines for insert to authenticated
  with check (private.is_staff() and (private.is_money_staff() or private.holds_open_advance(advance_id)));
create policy advance_lines_update on public.advance_lines for update to authenticated
  using (private.is_money_staff() or (private.holds_open_advance(advance_id) and created_by = auth.uid()))
  with check (private.is_money_staff() or (private.holds_open_advance(advance_id) and created_by = auth.uid()));
create policy advance_lines_delete on public.advance_lines for delete to authenticated
  using (private.is_money_staff() or (private.holds_open_advance(advance_id) and created_by = auth.uid()));
revoke all on public.advance_lines from anon;
grant select, insert, update, delete on public.advance_lines to authenticated;

-- A closed advance is locked; a billed line cannot change (remove its charge from the shipment first);
-- the client charge link is set only by bill_advance_line.
create or replace function private.guard_advance_lines()
returns trigger language plpgsql set search_path = '' as $$
declare st text;
begin
  -- The client charge was removed from the shipment: the receipt simply becomes unbilled again.
  if tg_op = 'UPDATE' and old.charge_id is not null and new.charge_id is null
     and (to_jsonb(new) - 'charge_id') = (to_jsonb(old) - 'charge_id') then return new; end if;
  select status into st from public.cash_advances where id = coalesce(new.advance_id, old.advance_id);
  if st = 'closed' then raise exception 'This cash advance is closed. Reopen it to change its lines.'; end if;
  if tg_op = 'INSERT' then
    new.charge_id := null;
    return new;
  end if;
  if tg_op = 'DELETE' then
    if old.charge_id is not null then raise exception 'This receipt is already billed to the client. Remove that charge from the shipment first.'; end if;
    return old;
  end if;
  if coalesce(current_setting('vsa.advance_internal', true), '') <> 'on' then
    if new.charge_id is distinct from old.charge_id and new.charge_id is not null then
      raise exception 'Use Add to billing to bill a receipt.';
    end if;
    if old.charge_id is not null and new.charge_id is not distinct from old.charge_id
       and (to_jsonb(new) - 'photo_path') <> (to_jsonb(old) - 'photo_path') then
      raise exception 'This receipt is already billed to the client. Remove that charge from the shipment first.';
    end if;
  end if;
  return new;
end $$;
revoke all on function private.guard_advance_lines() from public, anon, authenticated;
create trigger guard_advance_lines before insert or update or delete on public.advance_lines
  for each row execute function private.guard_advance_lines();

create or replace function private.stamp_advance_status()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'closed' and old.status = 'open' then new.closed_at := now(); end if;
  if new.status = 'open' then new.closed_at := null; end if;
  return new;
end $$;
revoke all on function private.stamp_advance_status() from public, anon, authenticated;
create trigger stamp_advance_status before update on public.cash_advances for each row execute function private.stamp_advance_status();

-- Bill one spent receipt to its shipment's client, once, as an advance for the client (no VAT).
create or replace function public.bill_advance_line(p_line bigint)
returns bigint language plpgsql security definer set search_path = '' as $$
declare l public.advance_lines; cid bigint;
begin
  if not private.is_money_staff() then raise exception 'Only the owner and billing staff add charges.'; end if;
  select * into l from public.advance_lines where id = p_line for update;
  if l.id is null then raise exception 'Receipt not found.'; end if;
  if l.kind <> 'spent' or not l.billable then raise exception 'Only spent, billable receipts go to billing.'; end if;
  if l.job_id is null then raise exception 'Choose the shipment this receipt is for first.'; end if;
  if l.charge_id is not null then raise exception 'This receipt is already on the billing.'; end if;
  insert into public.charges (job_id, kind, description, amount, vatable, advance, created_by)
    values (l.job_id, l.cost_kind,
      left(coalesce(nullif(trim(l.description), ''), initcap(replace(l.cost_kind, '_', ' ')))
           || coalesce(' (OR ' || nullif(trim(l.receipt_no), '') || ')', ''), 200),
      l.amount, false, true, auth.uid())
    returning id into cid;
  perform set_config('vsa.advance_internal', 'on', true);
  update public.advance_lines set charge_id = cid where id = l.id;
  perform set_config('vsa.advance_internal', 'off', true);
  return cid;
end $$;
revoke all on function public.bill_advance_line(bigint) from public, anon;
grant execute on function public.bill_advance_line(bigint) to authenticated;

-- Receipt photos: private, office staff only; path <advance id>/<file>.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('advance-files', 'advance-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp', 'application/pdf'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;
drop policy if exists advance_files_read on storage.objects;
create policy advance_files_read on storage.objects for select to authenticated using (bucket_id = 'advance-files' and private.is_staff());
drop policy if exists advance_files_add on storage.objects;
create policy advance_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'advance-files' and private.is_staff()
    and (private.is_money_staff() or private.holds_open_advance(nullif(split_part(name, '/', 1), '')::bigint)));
drop policy if exists advance_files_remove on storage.objects;
create policy advance_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'advance-files' and (private.is_money_staff()
    or private.holds_open_advance(nullif(split_part(name, '/', 1), '')::bigint)));

create trigger audit_cash_advances after insert or update or delete on public.cash_advances for each row execute function public.audit_row();
create trigger audit_advance_lines after insert or update or delete on public.advance_lines for each row execute function public.audit_row();

-- Backups keep them too.
do $$
declare src text;
begin
  select pg_get_functiondef('private.make_backup()'::regprocedure) into src;
  if position('cash_advances' in src) = 0 then
    src := replace(src, '''app_settings'', (select',
      '''cash_advances'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.cash_advances t),
    ''advance_lines'', (select coalesce(jsonb_agg(to_jsonb(t)), ''[]''::jsonb) from public.advance_lines t),
    ''app_settings'', (select');
    execute src;
  end if;
end $$;

-- Applied as its own step (advance_lines_reimbursed): the office paying back a staff member who spent
-- more than they were given; only the owner and billing record it.
alter table public.advance_lines drop constraint if exists advance_lines_kind_check;
alter table public.advance_lines add constraint advance_lines_kind_check check (kind in ('spent', 'returned', 'reimbursed'));
alter table public.advance_lines drop constraint if exists advance_lines_check;
alter table public.advance_lines add constraint advance_lines_check check (kind <> 'spent' or cost_kind is not null);
drop policy if exists advance_lines_insert on public.advance_lines;
create policy advance_lines_insert on public.advance_lines for insert to authenticated
  with check (private.is_staff() and (private.is_money_staff() or (private.holds_open_advance(advance_id) and kind <> 'reimbursed')));
