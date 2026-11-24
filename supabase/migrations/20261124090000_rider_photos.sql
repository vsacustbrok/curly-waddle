-- Rider photos: receipts (gas, toll, parking) and signed receiving copies, taken on the rider's phone
-- and attached to the day's log, optionally to one trip. Files live in the private "rider-files"
-- bucket under <rider id>/<log id>/<name>. Same access as the logs: office staff see and manage all;
-- a rider sees their own and adds or removes them only on today's or yesterday's log.
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('rider-files', 'rider-files', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = excluded.file_size_limit, allowed_mime_types = excluded.allowed_mime_types;

create table if not exists public.rider_photos (
  id bigint generated always as identity primary key,
  log_id bigint not null references public.rider_logs(id) on delete cascade,
  trip_id bigint references public.rider_trips(id) on delete set null,
  kind text not null default 'receipt' check (kind in ('receipt', 'proof', 'other')),
  amount numeric(10,2) check (amount >= 0),
  note text check (length(note) <= 200),
  file_path text not null unique,
  size_bytes integer,
  uploaded_by uuid default auth.uid() references auth.users(id) on delete set null,
  uploaded_at timestamptz not null default now()
);
create index if not exists rider_photos_log_idx on public.rider_photos (log_id);
create index if not exists rider_photos_trip_idx on public.rider_photos (trip_id);

-- The file must sit in the folder of the log's rider and log: <rider id>/<log id>/...
create or replace function private.rider_photo_path_ok(p_log bigint, p_path text)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rider_logs l where l.id = p_log
                 and split_part(p_path, '/', 1) = l.rider_id::text and split_part(p_path, '/', 2) = l.id::text)
$$;
revoke all on function private.rider_photo_path_ok(bigint, text) from public, anon;
grant execute on function private.rider_photo_path_ok(bigint, text) to authenticated;

-- True when the signed-in rider may change this log (their own, today or yesterday).
create or replace function private.rider_log_open(p_log bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.rider_logs l where l.id = p_log
                 and l.rider_id = private.my_rider_id() and private.rider_day_open(l.log_date))
$$;
revoke all on function private.rider_log_open(bigint) from public, anon;
grant execute on function private.rider_log_open(bigint) to authenticated;

alter table public.rider_photos enable row level security;
create policy rider_photos_select on public.rider_photos for select to authenticated
  using (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id and l.rider_id = (select private.my_rider_id())));
create policy rider_photos_insert on public.rider_photos for insert to authenticated
  with check ((private.is_staff() or private.rider_log_open(log_id)) and private.rider_photo_path_ok(log_id, file_path)
              and (trip_id is null or exists (select 1 from public.rider_trips t where t.id = trip_id and t.log_id = rider_photos.log_id)));
create policy rider_photos_update on public.rider_photos for update to authenticated
  using (private.is_staff() or private.rider_log_open(log_id))
  with check ((private.is_staff() or private.rider_log_open(log_id)) and private.rider_photo_path_ok(log_id, file_path)
              and (trip_id is null or exists (select 1 from public.rider_trips t where t.id = trip_id and t.log_id = rider_photos.log_id)));
create policy rider_photos_delete on public.rider_photos for delete to authenticated
  using (private.is_staff() or private.rider_log_open(log_id));
revoke all on public.rider_photos from anon;
grant select, insert, update, delete on public.rider_photos to authenticated;

-- Storage: the same rules on the files themselves, by folder.
drop policy if exists rider_files_read on storage.objects;
create policy rider_files_read on storage.objects for select to authenticated
  using (bucket_id = 'rider-files' and (private.is_staff() or split_part(name, '/', 1) = (select private.my_rider_id())::text));
drop policy if exists rider_files_add on storage.objects;
create policy rider_files_add on storage.objects for insert to authenticated
  with check (bucket_id = 'rider-files' and (
    (private.is_staff() and exists (select 1 from public.rider_logs l where split_part(name, '/', 1) = l.rider_id::text and split_part(name, '/', 2) = l.id::text))
    or (split_part(name, '/', 1) = (select private.my_rider_id())::text and private.rider_log_open(nullif(split_part(name, '/', 2), '')::bigint))));
drop policy if exists rider_files_remove on storage.objects;
create policy rider_files_remove on storage.objects for delete to authenticated
  using (bucket_id = 'rider-files' and (private.is_staff()
    or (split_part(name, '/', 1) = (select private.my_rider_id())::text and private.rider_log_open(nullif(split_part(name, '/', 2), '')::bigint))));

create trigger audit_rider_photos after insert or update or delete on public.rider_photos for each row execute function public.audit_row();
