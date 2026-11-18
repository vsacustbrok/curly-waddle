-- Pre-SAD draft per shipment: the header details of the E2M Single Administrative Document typed by
-- staff (office code, declaration, procedure, bank, per-item weights and codes), kept with the shipment.
alter table public.jobs add column if not exists sad_draft jsonb;
