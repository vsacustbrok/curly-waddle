-- Full check-up fixes.
-- 1. An advance paid for the client never carries VAT (it is not VSA's sale and is left off the sales
--    invoice, so VAT on it would be billed to the client but never declared).
alter table public.charges drop constraint if exists charges_advance_no_vat;
alter table public.charges add constraint charges_advance_no_vat check (not (advance and vatable));

-- 2. A sales invoice marks exactly the charges it lists: they are locked and picked by id, so a charge
--    added while the invoice is being issued stays uninvoiced instead of being marked without being on it.
create or replace function public.issue_sales_invoice(p_job uuid)
returns bigint language plpgsql security definer set search_path = '' as $$
declare s public.bir_settings; n int; doc bigint; c record; v_ids bigint[];
  v_lines jsonb; v_vatable numeric; v_vat numeric; v_exempt numeric;
begin
  select * into s from public.bir_settings where id for update;
  perform private.check_bir_ready(s);
  -- Lock the charges going on this invoice, so the invoice and the charges it marks are exactly the same.
  select coalesce(array_agg(ch.id order by ch.id), '{}') into v_ids from (
    select id from public.charges where job_id = p_job and invoice_id is null and not advance order by id for update) ch;
  select coalesce(jsonb_agg(jsonb_build_object('description', coalesce(nullif(trim(ch.description), ''), initcap(replace(ch.kind, '_', ' '))),
           'kind', ch.kind, 'amount', ch.amount, 'vatable', ch.vatable and s.vat_registered) order by ch.id), '[]'::jsonb),
         coalesce(sum(ch.amount) filter (where ch.vatable and s.vat_registered), 0),
         coalesce(sum(round(ch.amount * 0.12, 2)) filter (where ch.vatable and s.vat_registered), 0),
         coalesce(sum(ch.amount) filter (where not (ch.vatable and s.vat_registered)), 0)
    into v_lines, v_vatable, v_vat, v_exempt
    from public.charges ch where ch.id = any(v_ids);
  if jsonb_array_length(v_lines) = 0 then
    raise exception 'There are no service charges on this shipment that are not on an invoice yet.';
  end if;
  select j.job_no, cl.name, cl.tin, cl.address into c
    from public.jobs j join public.clients cl on cl.id = j.client_id where j.id = p_job;
  n := private.next_bir_no('invoice', s);
  insert into public.bir_documents (doc_type, serial_no, doc_no, job_id, issued_by, issued_by_name, buyer_name, buyer_tin, buyer_address,
      lines, vatable_sales, vat_amount, exempt_sales, total, seller)
    values ('invoice', n, s.invoice_prefix || lpad(n::text, 6, '0'), p_job, auth.uid(),
      (select coalesce(nullif(full_name, ''), email) from public.profiles where id = auth.uid()),
      c.name, c.tin, c.address, v_lines, v_vatable, v_vat, v_exempt, v_vatable + v_vat + v_exempt,
      to_jsonb(s) - 'updated_by' - 'updated_at')
    returning id into doc;
  perform set_config('vsa.bir_internal', 'on', true);
  update public.charges set invoice_id = doc where id = any(v_ids);
  perform set_config('vsa.bir_internal', 'off', true);
  return doc;
end $$;
revoke all on function public.issue_sales_invoice(uuid) from public, anon;
grant execute on function public.issue_sales_invoice(uuid) to authenticated;
