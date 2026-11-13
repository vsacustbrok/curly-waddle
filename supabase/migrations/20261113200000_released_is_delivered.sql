-- Released and Delivered are one step ("Released / Delivered"). Shipments still marked
-- Released move to Delivered. The app no longer offers Released, and imports save it as Delivered.
update public.jobs set status = 'delivered' where status = 'released';
