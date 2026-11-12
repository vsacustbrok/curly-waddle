-- CRO is tracked on its own (number and valid-until date), separate from how the BL is released
-- (original BL, telex release or seaway bill). Entries get a filing date.
alter table public.jobs add column cro_no text, add column entry_filed_date date;
alter table public.jobs drop constraint if exists jobs_bl_release_type_check;
update public.jobs set bl_release_type = null where bl_release_type = 'cro';
alter table public.jobs add constraint jobs_bl_release_type_check check (bl_release_type in ('original', 'telex', 'seaway'));
