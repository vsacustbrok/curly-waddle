-- Phase 2, client status updates: an email to the client when their shipment reaches the steps they
-- chose, and a private client page (a secret link, no login) that shows their open shipments.
--
-- Email: a status change puts a row in client_notifications. Every 5 minutes, pg_cron calls the
-- send-client-updates edge function (only when something is waiting). That function sends through
-- Resend with the RESEND_API_KEY the owner adds in Supabase Edge Function secrets. Until the key
-- exists, rows wait; rows older than 3 days are skipped so clients never get a flood of old news.

create extension if not exists pg_net with schema extensions;

-- 1. What each client wants.
alter table public.clients add column if not exists notify_email text
  check (notify_email is null or notify_email ~* '^[^@\s]+@[^@\s]+\.[^@\s]+$');
alter table public.clients add column if not exists notify_steps text[] not null default '{lodged,assessed,delivered}'
  check (notify_steps <@ '{pre_arrival,lodged,assessed,paid,gatepass,tabs,delivered,billed}'::text[]);
alter table public.clients add column if not exists portal_token uuid unique;
alter table public.clients add column if not exists portal_enabled boolean not null default false;

-- 2. The email queue and log. Staff read it; only the database and the sender write it.
create table if not exists public.client_notifications (
  id bigint generated always as identity primary key,
  job_id uuid not null references public.jobs(id) on delete cascade,
  client_id uuid references public.clients(id) on delete set null,
  step text not null,
  to_email text not null,
  status text not null default 'queued' check (status in ('queued', 'sent', 'failed', 'skipped')),
  error text,
  attempts int not null default 0,
  created_at timestamptz not null default now(),
  sent_at timestamptz,
  unique (job_id, step)   -- one email per step per shipment, even if the step is set twice
);
create index if not exists client_notifications_client_idx on public.client_notifications (client_id);
create index if not exists client_notifications_queued_idx on public.client_notifications (id) where status = 'queued';
alter table public.client_notifications enable row level security;
create policy client_notifications_select on public.client_notifications for select to authenticated using (private.is_staff());

-- 3. A step reached → queue the email if the client chose that step and has an address.
create or replace function private.queue_client_update()
returns trigger language plpgsql security definer set search_path = '' as $$
declare s text := case when new.to_status::text = 'released' then 'delivered' else new.to_status::text end;
begin
  insert into public.client_notifications (job_id, client_id, step, to_email)
  select j.id, c.id, s, c.notify_email
  from public.jobs j join public.clients c on c.id = j.client_id
  where j.id = new.job_id and c.notify_email is not null and s = any (c.notify_steps)
  on conflict (job_id, step) do nothing;
  return new;
end $$;
revoke all on function private.queue_client_update() from public, anon, authenticated;
drop trigger if exists queue_client_update on public.job_status_history;
create trigger queue_client_update after insert on public.job_status_history for each row execute function private.queue_client_update();

-- 4. The sender's pass: a random token kept in Vault. Only the server (service role) can check it.
do $$ begin
  if not exists (select 1 from vault.secrets where name = 'client_updates_token') then
    perform vault.create_secret(encode(extensions.gen_random_bytes(32), 'hex'), 'client_updates_token', 'Lets pg_cron call send-client-updates');
  end if;
end $$;

create or replace function public.check_client_updates_token(t text)
returns boolean language sql stable security definer set search_path = '' as $$
  select coalesce(length(t) = 64 and t = (select decrypted_secret from vault.decrypted_secrets where name = 'client_updates_token'), false)
$$;
revoke all on function public.check_client_updates_token(text) from public, anon, authenticated;
grant execute on function public.check_client_updates_token(text) to service_role;

create or replace function private.kick_client_updates()
returns void language plpgsql security definer set search_path = '' as $$
begin
  if exists (select 1 from public.client_notifications where status = 'queued') then
    perform net.http_post(
      url := 'https://xskvjxbvkgysvwlotjpf.supabase.co/functions/v1/send-client-updates',
      headers := jsonb_build_object('Content-Type', 'application/json',
        'x-cron-token', (select decrypted_secret from vault.decrypted_secrets where name = 'client_updates_token')),
      body := '{}'::jsonb, timeout_milliseconds := 30000);
  end if;
end $$;
revoke all on function private.kick_client_updates() from public, anon, authenticated;

select cron.unschedule('send-client-updates') where exists (select 1 from cron.job where jobname = 'send-client-updates');
select cron.schedule('send-client-updates', '*/5 * * * *', 'select private.kick_client_updates()');

-- 5. The client page: given the secret link, the client's open shipments with tracking fields only.
--    No money, no documents, no staff names, no other clients. Wrong or switched-off link → null.
create or replace function public.client_portal(token uuid)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'client', c.name,
    'shipments', coalesce((
      select jsonb_agg(x.row order by x.sort_eta nulls last, x.job_no)
      from (
        select j.job_no, j.eta as sort_eta, jsonb_build_object(
          'pn', j.job_no, 'ref', j.client_ref_no, 'bl', j.bl_awb_no, 'containers', j.containers,
          'vessel', j.vessel, 'voyage', j.voyage, 'eta', j.eta, 'item', j.item_description,
          'step', case when j.status::text = 'released' then 'delivered' else j.status::text end,
          'vessel_note', j.vessel_note, 'vessel_checked_at', j.vessel_checked_at,
          'steps', (select coalesce(jsonb_agg(jsonb_build_object('step', h.to_status, 'at', h.changed_at) order by h.changed_at), '[]'::jsonb)
                    from public.job_status_history h where h.job_id = j.id)
        ) as row
        from public.jobs j
        where j.client_id = c.id
          and (j.status::text <> 'billed'
               or exists (select 1 from public.job_status_history h where h.job_id = j.id and h.changed_at > now() - interval '30 days'))
        order by j.eta desc nulls first
        limit 100
      ) x), '[]'::jsonb))
  from public.clients c
  where c.portal_token = token and c.portal_enabled
$$;
revoke all on function public.client_portal(uuid) from public;
grant execute on function public.client_portal(uuid) to anon, authenticated;

-- 6. Backups also keep the rate table, fee settings and the email log.
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
    'tariff_rates', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.tariff_rates t),
    'duty_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.duty_settings t),
    'client_notifications', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.client_notifications t),
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.app_settings t),
    'audit_log_last_30_days', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'at', t.at, 'user_email', t.user_email,
                                'table_name', t.table_name, 'record_id', t.record_id, 'action', t.action)), '[]'::jsonb)
                                from public.audit_log t where t.at > now() - interval '30 days')
  );
  insert into public.backups(size_bytes, data) values (octet_length(d::text), d) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 14);
  return new_id;
end $$;
