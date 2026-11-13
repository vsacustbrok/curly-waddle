-- Phase 2, deadlines and alerts: the free-time dates the office must watch on each shipment.
alter table public.jobs
  add column if not exists storage_free_until date,      -- last free day of port/warehouse storage
  add column if not exists demurrage_free_until date,    -- last free day of the container (shipping line free time)
  add column if not exists empty_return_due date;        -- when the empty container must be back at the depot
