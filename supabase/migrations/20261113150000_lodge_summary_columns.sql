-- Columns from the office's daily lodge summary sheet, so it can be imported and exported as CSV.
alter table public.jobs
  add column item_description text,
  add column supplier text,
  add column dp_contract text,
  add column yard text,
  add column empty_return text,
  add column empty_return_date date,
  add column lodge_remarks text,
  add column lodge_remarks_2 text,
  add column lodge_note text;
