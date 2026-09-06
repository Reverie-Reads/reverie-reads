-- A reader deliberately saves a small, ordered shortlist. Opening a book never creates a copy.
create table public.discovery_sessions (
  owner_id uuid not null references public.profiles(id) on delete cascade,
  id uuid not null,
  document jsonb not null,
  updated_at timestamptz not null default now(),
  primary key (owner_id, id),
  constraint discovery_document_shape check (
    jsonb_typeof(document) = 'object'
    and document->>'version' = '1'
    and document->>'id' = id::text
    and jsonb_typeof(document->'intent') = 'object'
    and jsonb_typeof(document->'picks') = 'array'
    and jsonb_array_length(document->'picks') between 1 and 5
    and octet_length(document::text) <= 64000
    and document ?& array['version','id','createdAt','intent','picks','dismissed']
  )
);
revoke all on public.discovery_sessions from public, anon, authenticated, service_role;
grant select, insert, update, delete on public.discovery_sessions to authenticated;
grant all on public.discovery_sessions to service_role;
alter table public.discovery_sessions enable row level security;
create policy "Readers manage their saved discoveries" on public.discovery_sessions
  for all to authenticated using (owner_id = (select auth.uid()))
  with check (owner_id = (select auth.uid()));

-- Serialize saves per owner so concurrent tabs cannot exceed the 50-shortlist limit.
create function public.guard_discovery_sessions() returns trigger
language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'UPDATE' and (new.owner_id <> old.owner_id or new.id <> old.id) then
    raise exception 'A saved shortlist cannot change owner or identity.' using errcode = '23514';
  end if;
  if auth.uid() is not null and new.owner_id <> auth.uid() then
    raise exception 'This shortlist belongs to another reader.' using errcode = '42501';
  end if;
  perform pg_advisory_xact_lock(hashtextextended('discovery:' || new.owner_id::text, 0));
  if tg_op = 'INSERT'
    and not exists (select 1 from public.discovery_sessions where owner_id = new.owner_id and id = new.id)
    and (select count(*) from public.discovery_sessions where owner_id = new.owner_id) >= 50 then
    raise exception 'You have 50 saved shortlists. Remove one before saving another.' using errcode = '23514';
  end if;
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function public.guard_discovery_sessions() from public, anon, authenticated, service_role;
create trigger guard_discovery_sessions before insert or update on public.discovery_sessions
  for each row execute function public.guard_discovery_sessions();
