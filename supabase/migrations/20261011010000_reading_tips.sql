-- A reader may quiet repeated workflow instructions without changing the chosen guide,
-- navigation, library content or access. Existing and new accounts keep tips until they opt out.
alter table public.profiles
  add column show_reading_tips boolean not null default true;

comment on column public.profiles.show_reading_tips is
  'Show optional reading introductions and workflow tips. Defaults true; owner-only through profile RLS. Included in profile backup. Never hides controls, essential information or the library guide.';
