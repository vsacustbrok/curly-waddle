-- Second lock on the data: the anonymous (not signed-in) role gets no table permissions at all.
-- Row-level security already returns nothing to it; this removes the permissions themselves.
-- The public client tracking page uses only the client_portal() function, which stays allowed.
do $$
declare t record;
begin
  for t in select c.relname from pg_class c join pg_namespace n on n.oid = c.relnamespace
           where n.nspname = 'public' and c.relkind in ('r', 'p', 'v', 'm') loop
    execute format('revoke all on public.%I from anon', t.relname);
  end loop;
end $$;
revoke all on all sequences in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;
alter default privileges in schema public revoke all on sequences from anon;
