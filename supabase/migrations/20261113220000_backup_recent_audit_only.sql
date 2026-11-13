-- Backups copy all business data, but only a summary of the last 30 days of the activity log: the full log
-- (65 MB after the lodge-sheet import) stays in the database, and 14 nightly copies of it would
-- not fit the database's space.
create or replace function private.make_backup()
returns bigint language plpgsql security definer set search_path = '' as $$
declare d jsonb; new_id bigint;
begin
  d := jsonb_build_object(
    'made_at', now(),
    'clients', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.clients t),
    'jobs', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.jobs t),
    'job_notes', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_notes t),
    'user_reports', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.user_reports t),
    'job_documents', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_documents t),
    'scan_results', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.scan_results t),
    'job_status_history', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.job_status_history t),
    'profiles', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.profiles t),
    'invites', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.invites t),
    'app_settings', (select coalesce(jsonb_agg(to_jsonb(t)), '[]'::jsonb) from public.app_settings t),
    -- Who changed what in the last 30 days, without the before/after copies that make the log large.
    'audit_log_last_30_days', (select coalesce(jsonb_agg(jsonb_build_object('id', t.id, 'at', t.at, 'user_email', t.user_email,
                                'table_name', t.table_name, 'record_id', t.record_id, 'action', t.action)), '[]'::jsonb)
                                from public.audit_log t where t.at > now() - interval '30 days')
  );
  insert into public.backups(size_bytes, data) values (octet_length(d::text), d) returning id into new_id;
  delete from public.backups where id not in (select id from public.backups order by id desc limit 14);
  return new_id;
end $$;
