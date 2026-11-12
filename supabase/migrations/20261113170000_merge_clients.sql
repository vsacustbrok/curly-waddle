-- Owner tool: fold one client into another (for example a misspelt name from an imported sheet).
-- Every shipment of the first client moves to the second, then the first is deleted, in one step.
create or replace function public.merge_clients(from_id uuid, into_id uuid)
returns integer
language plpgsql
security invoker
set search_path = ''
as $$
declare moved integer;
begin
  if private.current_app_role() is distinct from 'owner'::public.app_role then
    raise exception 'Only the owner can merge clients';
  end if;
  if from_id = into_id then
    raise exception 'Choose two different clients';
  end if;
  if not exists (select 1 from public.clients where id = into_id) then
    raise exception 'The client to keep was not found';
  end if;
  update public.jobs set client_id = into_id where client_id = from_id;
  get diagnostics moved = row_count;
  delete from public.clients where id = from_id;
  return moved;
end $$;

revoke all on function public.merge_clients(uuid, uuid) from public, anon;
grant execute on function public.merge_clients(uuid, uuid) to authenticated;
