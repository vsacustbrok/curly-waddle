-- Shipment progress details kept on each project.
alter table public.jobs
  add column client_ref_no text,
  add column entry_status text check (entry_status in ('final', 'assessed')),
  add column final_sad_sent boolean not null default false,
  add column ssdt_sent boolean not null default false,
  add column container_at_yard_at timestamptz,
  add column trucker_name text,
  add column trucker_plate_no text,
  add column delivery_address text,
  add column released_at timestamptz,
  add column port_of_destination text,
  add column bl_release_type text check (bl_release_type in ('cro', 'telex', 'original'));
