-- Phase 2, vessel tracking by hand: staff look the vessel up on MarineTraffic and type what they saw
-- ("Anchored at Manila Bay", "Berthed MICT pier 5"). The time of that check is stamped by the database.

alter table public.jobs add column if not exists vessel_note text check (vessel_note is null or length(vessel_note) <= 300);
alter table public.jobs add column if not exists vessel_checked_at timestamptz;

create or replace function public.stamp_vessel_check()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'INSERT' then
    new.vessel_checked_at := case when new.vessel_note is not null then now() end;
  elsif new.vessel_note is distinct from old.vessel_note then
    new.vessel_checked_at := case when new.vessel_note is not null then now() end;
  else
    new.vessel_checked_at := old.vessel_checked_at;  -- nobody sets the time by hand
  end if;
  return new;
end $$;
revoke all on function public.stamp_vessel_check() from public, anon, authenticated;
drop trigger if exists stamp_vessel_check on public.jobs;
create trigger stamp_vessel_check before insert or update on public.jobs for each row execute function public.stamp_vessel_check();
