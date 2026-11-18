-- Each person's preferred screen layout: menu across the top (horizontal) or down the left side
-- with the status board steps stacked (vertical). People already may update their own profile;
-- guard_profile still stops them changing their own role or email.
alter table public.profiles add column if not exists layout text not null default 'horizontal'
  check (layout in ('horizontal', 'vertical'));
