-- Gatepass summary columns: container size, reefer or dry, and the reefer's electric (plug-in) cut-off.
alter table public.jobs
  add column if not exists container_size text,          -- e.g. 20, 40, 40HC, 45
  add column if not exists reefer boolean,               -- true = reefer (needs electric), false = dry
  add column if not exists electric_until timestamptz;   -- reefer power paid / plugged in until this date and time
