-- Registry no. of the shipment, entered once in the Documents section.
alter table public.jobs add column if not exists registry_no text;
