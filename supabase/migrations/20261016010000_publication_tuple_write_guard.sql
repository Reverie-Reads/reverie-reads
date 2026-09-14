-- Prevent new impossible or disconnected publication tuples without blocking unrelated edits to
-- the two historical invalid rows. Existing bad data remains visible for explicit correction.
begin;

create function public.validate_publication_tuple_write()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  if tg_op = 'UPDATE'
    and new.pub_y is not distinct from old.pub_y
    and new.pub_m is not distinct from old.pub_m
    and new.pub_d is not distinct from old.pub_d
  then
    return new;
  end if;

  if new.pub_y is null and new.pub_m is null and new.pub_d is null then
    return new;
  end if;

  if not public.publication_tuple_is_valid(new.pub_y, new.pub_m, new.pub_d) then
    raise exception 'Use a valid year, year-month, or complete publication date.'
      using errcode = '22007';
  end if;

  return new;
end;
$$;

revoke all on function public.validate_publication_tuple_write()
  from public, anon, authenticated, service_role;

create trigger books_validate_publication_tuple
before insert or update of pub_y, pub_m, pub_d on public.books
for each row execute function public.validate_publication_tuple_write();

create trigger works_validate_publication_tuple
before insert or update of pub_y, pub_m, pub_d on public.works
for each row execute function public.validate_publication_tuple_write();

commit;
