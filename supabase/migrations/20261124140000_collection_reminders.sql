-- Overdue balance follow-ups: the payment instructions printed in every reminder (owner sets them,
-- with the office's other business details) and a record of each reminder sent, so a client is not
-- chased twice in the same week. The app never sends anything itself: staff copy or open the draft
-- in their own email and press "I sent it".
alter table public.bir_settings add column if not exists payment_instructions text
  check (length(payment_instructions) <= 800);

create table if not exists public.collection_reminders (
  id bigint generated always as identity primary key,
  client_id uuid not null references public.clients(id) on delete cascade,
  sent_at timestamptz not null default now(),
  sent_by uuid default auth.uid() references auth.users(id) on delete set null,
  tone text not null check (tone in ('gentle', 'neutral', 'firm')),
  total numeric(14,2) not null check (total >= 0),
  pns text[] not null default '{}',
  to_email text check (length(to_email) <= 320)
);
create index if not exists collection_reminders_client_idx on public.collection_reminders (client_id, sent_at desc);

alter table public.collection_reminders enable row level security;
create policy collection_reminders_select on public.collection_reminders for select to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy collection_reminders_insert on public.collection_reminders for insert to authenticated
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role) and sent_by = auth.uid());
create policy collection_reminders_delete on public.collection_reminders for delete to authenticated
  using (private.current_app_role() = 'owner'::public.app_role);
revoke all on public.collection_reminders from anon;
grant select, insert, delete on public.collection_reminders to authenticated;
create trigger audit_collection_reminders after insert or update or delete on public.collection_reminders
  for each row execute function public.audit_row();
