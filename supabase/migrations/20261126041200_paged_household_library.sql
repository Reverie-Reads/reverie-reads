begin;

-- Give PostgREST a typed, unique ordering column for the existing authorized projection.
create function public.household_library_book_rows(p_household uuid)
returns table (work_id uuid, book jsonb)
language sql stable security invoker set search_path = '' as $$
  select (entry->>'work_id')::uuid, entry
  from public.household_library_works_v2() as entries(entry)
  where exists (
    select 1 from public.household_members mine
    where mine.user_id = (select auth.uid()) and mine.household_id = p_household
  );
$$;
revoke all on function public.household_library_book_rows(uuid) from public, anon, service_role;
grant execute on function public.household_library_book_rows(uuid) to authenticated;
commit;
