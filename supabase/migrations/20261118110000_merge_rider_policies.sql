-- One rule per action instead of an office rule plus a rider rule: the same access, checked once.
-- Office staff: everything. A rider: their own record and logs, writing only today's or yesterday's.
drop policy if exists riders_staff on public.riders;
drop policy if exists riders_own on public.riders;
create policy riders_select on public.riders for select to authenticated
  using (private.is_staff() or profile_id = (select auth.uid()));
create policy riders_insert on public.riders for insert to authenticated with check (private.is_staff());
create policy riders_update on public.riders for update to authenticated using (private.is_staff()) with check (private.is_staff());
create policy riders_delete on public.riders for delete to authenticated using (private.is_staff());

drop policy if exists rider_logs_staff on public.rider_logs;
drop policy if exists rider_logs_own_select on public.rider_logs;
drop policy if exists rider_logs_own_insert on public.rider_logs;
drop policy if exists rider_logs_own_update on public.rider_logs;
create policy rider_logs_select on public.rider_logs for select to authenticated
  using (private.is_staff() or rider_id = (select private.my_rider_id()));
create policy rider_logs_insert on public.rider_logs for insert to authenticated
  with check (private.is_staff() or (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date)));
create policy rider_logs_update on public.rider_logs for update to authenticated
  using (private.is_staff() or (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date)))
  with check (private.is_staff() or (rider_id = (select private.my_rider_id()) and private.rider_day_open(log_date)));
create policy rider_logs_delete on public.rider_logs for delete to authenticated using (private.is_staff());

drop policy if exists rider_trips_staff on public.rider_trips;
drop policy if exists rider_trips_own_select on public.rider_trips;
drop policy if exists rider_trips_own_insert on public.rider_trips;
drop policy if exists rider_trips_own_update on public.rider_trips;
drop policy if exists rider_trips_own_delete on public.rider_trips;
create policy rider_trips_select on public.rider_trips for select to authenticated
  using (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id and l.rider_id = (select private.my_rider_id())));
create policy rider_trips_insert on public.rider_trips for insert to authenticated
  with check (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id
              and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));
create policy rider_trips_update on public.rider_trips for update to authenticated
  using (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id
         and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)))
  with check (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id
              and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));
create policy rider_trips_delete on public.rider_trips for delete to authenticated
  using (private.is_staff() or exists (select 1 from public.rider_logs l where l.id = log_id
         and l.rider_id = (select private.my_rider_id()) and private.rider_day_open(l.log_date)));

-- Charges and payments: everyone in the office reads; owner and billing write.
drop policy if exists charges_select on public.charges;
drop policy if exists charges_write on public.charges;
create policy charges_select on public.charges for select to authenticated using (private.is_staff());
create policy charges_insert on public.charges for insert to authenticated
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy charges_update on public.charges for update to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy charges_delete on public.charges for delete to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
drop policy if exists payments_select on public.payments;
drop policy if exists payments_write on public.payments;
create policy payments_select on public.payments for select to authenticated using (private.is_staff());
create policy payments_insert on public.payments for insert to authenticated
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy payments_update on public.payments for update to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role))
  with check (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
create policy payments_delete on public.payments for delete to authenticated
  using (private.current_app_role() in ('owner'::public.app_role, 'billing'::public.app_role));
