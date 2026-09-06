-- A reader's navigation priorities and Home composition travel with their account. The document is
-- versioned in JSON so new destinations can arrive without rewriting every existing profile; the
-- client rejects corrupt or future versions locally and does not overwrite them until explicit Save.
alter table public.profiles
  add column arrangement jsonb not null default '{
    "version": 1,
    "priorityDestinations": ["home", "match", "library"],
    "homeModules": ["next-read", "reading", "priority"]
  }'::jsonb,
  add constraint profiles_arrangement_object_check
    check (jsonb_typeof(arrangement) = 'object');

comment on column public.profiles.arrangement is
  'Versioned reader-owned navigation priorities and ordered Home modules. Unknown/future versions are preserved until explicit Save.';
