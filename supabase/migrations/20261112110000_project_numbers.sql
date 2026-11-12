-- Shipments are identified by a PN (project number) instead of a job number.
-- New shipments are numbered PN26-00006, ...; existing J-numbers are renamed to match.
alter table public.jobs
  alter column job_no set default ((('PN'::text || to_char(now(), 'YY'::text)) || '-'::text) || lpad((nextval('job_seq'::regclass))::text, 5, '0'::text));
update public.jobs set job_no = 'PN' || substring(job_no from 2) where job_no ~ '^J\d{2}-\d+$';
