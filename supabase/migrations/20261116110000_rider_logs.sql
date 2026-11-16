-- Rider daily itinerary: each rider's trips for the day (document pick-ups and deliveries, from and
-- to which company or shipping line), odometer and expenses. Riders log on their phone, the office
-- can enter or correct any log, and a trip can point at a shipment by its PN.

-- A rider is not office staff: every "staff can see ..." rule on shipments, clients, billing and
-- files is written with is_staff(), so this one change keeps riders out of all of them.
create or replace function private.is_staff()
returns boolean language sql stable security definer set search_path = '' as $$
  select auth.uid() is not null
     and private.current_app_role() not in ('pending'::public.app_role, 'rider'::public.app_role)
$$;

create table if not exists public.riders (
  id bigint generated always as identity primary key,
  name text not null check (length(trim(name)) > 0),
  vehicle text,
  plate_no text,
  profile_id uuid unique references public.profiles(id) on delete set null,  -- the rider's own login, if any
  active boolean not null default true,
  created_at timestamptz not null default now()
);

create table if not exists public.rider_logs (
  id bigint generated always as identity primary key,
  log_date date not null default ((now() at time zone 'Asia/Manila')::date),
  rider_id bigint not null references public.riders(id) on delete restrict,
  vehicle text,
  odo_start numeric(9,1) check (odo_start >= 0),
  odo_end numeric(9,1) check (odo_end >= 0),
  gas numeric(10,2) not null default 0 check (gas >= 0),
  food numeric(10,2) not null default 0 check (food >= 0),
  other_amount numeric(10,2) not null default 0 check (other_amount >= 0),
  misc_details text,
  remarks text,
  created_by uuid default auth.uid() references auth.users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (rider_id, log_date),
  check (odo_end is null or odo_start is null or odo_end >= odo_start)
);
create index if not exists rider_logs_date_idx on public.rider_logs (log_date);
create index if not exists rider_logs_by_idx on public.rider_logs (created_by);

create table if not exists public.rider_trips (
  id bigint generated always as identity primary key,
  log_id bigint not null references public.rider_logs(id) on delete cascade,
  seq integer not null default 1,
  purpose text not null default 'pickup' check (purpose in ('pickup','deliver','submit','payment','other')),
  from_place text,
  to_place text,
  shipping_line text,
  contact text,
  details text,
  job_no text,
  job_id uuid references public.jobs(id) on delete set null,
  time_out time,
  time_in time,
  status text not null default 'pending' check (status in ('pending','picked_up','delivered','failed','rescheduled'))
);
create index if not exists rider_trips_log_idx on public.rider_trips (log_id);
create index if not exists rider_trips_job_idx on public.rider_trips (job_id);

-- The rider record of the signed-in user, if they are an active rider.
create or replace function private.my_rider_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.riders where profile_id = auth.uid() and active
$$;
revoke all on function private.my_rider_id() from public, anon;
grant execute on function private.my_rider_id() to authenticated;

-- A rider may write a log for today or yesterday (Manila time); older ones are for the office.
create or replace function private.rider_day_open(d date)
returns boolean language sql stable set search_path = '' as $$
  select d between (now() at time zone 'Asia/Manila')::date - 1 and (now() at time zone 'Asia/Manila')::date
$$;
revoke all on function private.rider_day_open(date) from public, anon;
grant execute on function private.rider_day_open(date) to authenticated;

-- Riders cannot read shipments, so they type the PN and this links the trip when exactly one
-- shipment has it.
create or replace function public.link_rider_trip()
returns trigger language plpgsql security definer set search_path = '' as $$
declare pn text := upper(trim(coalesce(new.job_no, ''))); found uuid; n integer;
begin
  new.job_no := nullif(pn, '');
  new.job_id := null;
  if pn <> '' then
    select count(*), (array_agg(id))[1] into n, found from public.jobs where upper(trim(job_no)) = pn;
    if n = 1 then new.job_id := found; end if;
  end if;
  return new;
end $$;
revoke all on function public.link_rider_trip() from public, anon, authenticated;
create trigger link_rider_trip before insert or update of job_no, job_id on public.rider_trips
  for each row execute function public.link_rider_trip();

create or replace function public.touch_rider_log()
returns trigger language plpgsql set search_path = '' as $$
begin new.updated_at := now(); return new; end $$;
revoke all on function public.touch_rider_log() from public, anon, authenticated;
create trigger touch_rider_log before update on public.rider_logs
  for each row execute function public.touch_rider_log();

alter table public.riders enable row level security;
alter table public.rider_logs enable row level security;
alter table public.rider_trips enable row level security;

-- Office staff: everything.
create policy riders_staff on public.riders for all to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy rider_logs_staff on public.rider_logs for all to authenticated
  using (private.is_staff()) with check (private.is_staff());
create policy rider_trips_staff on public.rider_trips for all to authenticated
  using (private.is_staff()) with check (private.is_staff());

-- A rider: their own record and logs only.
create policy riders_own on public.riders for select to authenticated
  using (profile_id = (select auth.uid()));
create policy rider_logs_own_select on public.rider_logs for select to authenticated
  using (rider_id = (select private.my_rider_id()));
create policy rider_logs_own_insert on public.rider_logs for insert to authenticated
  with check (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date));
create policy rider_logs_own_update on public.rider_logs for update to authenticated
  using (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date))
  with check (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date));
create policy rider_trips_own_select on public.rider_trips for select to authenticated
  using (exists (select 1 from public.rider_logs l where l.id = log_id and l.rider_id = (select private.my_rider_id())));
create policy rider_trips_own_insert on public.rider_trips for insert to authenticated
  with check (exists (select 1 from public.rider_logs l where l.id = log_id
              and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));
create policy rider_trips_own_update on public.rider_trips for update to authenticated
  using (exists (select 1 from public.rider_logs l where l.id = log_id
         and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)))
  with check (exists (select 1 from public.rider_logs l where l.id = log_id
              and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));
create policy rider_trips_own_delete on public.rider_trips for delete to authenticated
  using (exists (select 1 from public.rider_logs l where l.id = log_id
         and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));

create trigger audit_riders after insert or update or delete on public.riders for each row execute function public.audit_row();
create trigger audit_rider_logs after insert or update or delete on public.rider_logs for each row execute function public.audit_row();
create trigger audit_rider_trips after insert or update or delete on public.rider_trips for each row execute function public.audit_row();

-- Nightly backup now also saves charges, payments and the rider logs.
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
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.app_settings t),
    -- Who changed what in the last 30 days, without the before/after copies that make the log large.
    'audit_log_last_30_days', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'at', t.at, 'user_email', t.user_email,
                                'table_name', t.table_name, 'record_id', t.record_id, 'action', t.action)), '[]'::jsonb)
                                from public.audit_log t where t.at > now() - interval '30 days')
  );
  insert into public.backups(size_bytes, data) values (octet_length(d::text), d) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 14);
  return new_id;
end $$;
