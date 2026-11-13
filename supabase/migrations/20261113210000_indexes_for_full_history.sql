-- With ten years of lodge history in the app: indexes for the board (this year's lodgements),
-- the year filter, container search, and the two foreign keys the database advisor flagged.
create index if not exists jobs_entry_filed_date_idx on public.jobs (entry_filed_date);
create index if not exists jobs_containers_gin on public.jobs using gin (containers);
create index if not exists job_notes_author_idx on public.job_notes (author_id);
create index if not exists invites_invited_by_idx on public.invites (invited_by);
