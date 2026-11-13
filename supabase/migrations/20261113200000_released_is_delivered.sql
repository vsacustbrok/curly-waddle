-- Released and Delivered are one step ("Released / Delivered"). Shipments still marked
-- Released move to Delivered, and anything later set to Released is saved as Delivered.
update public.jobs set status = 'delivered' where status = 'released';

create or replace function private.released_means_delivered()
returns trigger language plpgsql set search_path = '' as $$
begin
  if new.status = 'released'::public.job_status then new.status := 'delivered'::public.job_status; end if;
  return new;
end $$;

-- Named to sort before jobs_enforce_rules, so the rules see Delivered (triggers run in name order).
drop trigger if exists jobs_a_released_is_delivered on public.jobs;
create trigger jobs_a_released_is_delivered before insert or update of status on public.jobs
  for each row execute function private.released_means_delivered();
