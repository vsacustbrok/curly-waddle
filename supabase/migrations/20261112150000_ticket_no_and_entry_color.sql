-- Ticket number, and the selectivity colour the entry is given once it is lodged.
alter table public.jobs
  add column ticket_no text,
  add column entry_color text check (entry_color in ('red', 'orange', 'yellow'));
