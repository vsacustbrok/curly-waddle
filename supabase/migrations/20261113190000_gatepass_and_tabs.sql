-- Two steps between Paid and Released: Gatepass (with its reference no. and date)
-- and TABS (terminal appointment booking: reference no. and the booked date and time).
alter type public.job_status add value if not exists 'gatepass' after 'paid';
alter type public.job_status add value if not exists 'tabs' after 'gatepass';

alter table public.jobs
  add column if not exists gatepass_ref text,
  add column if not exists gatepass_date date,
  add column if not exists tabs_ref text,
  add column if not exists tabs_at timestamptz;
