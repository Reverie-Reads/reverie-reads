begin;
create table public.reader_planner_entries (
  owner_id uuid not null default auth.uid() references public.profiles(id) on delete cascade,
  id uuid not null,
  kind text not null check(kind in ('watch','plan')),
  title text not null check(length(trim(title)) between 1 and 500),
  author text not null default '' check(length(author)<=500),
  series text not null default '' check(length(series)<=500),
  timing text not null default '' check(timing='' or timing ~ '^[1-9][0-9]{3}(-[0-9]{2}(-[0-9]{2})?)?$'),
  check(timing='' or (timing || case length(timing) when 4 then '-01-01' when 7 then '-01' else '' end)::date is not null),
  primary key(owner_id,id)
);
alter table public.reader_planner_entries enable row level security;
create policy reader_planner_own on public.reader_planner_entries to authenticated
  using(owner_id=(select auth.uid())) with check(owner_id=(select auth.uid()));
revoke all on public.reader_planner_entries from public, anon, authenticated;
grant select, insert, update, delete on public.reader_planner_entries to authenticated;
grant all on public.reader_planner_entries to service_role;
commit;
