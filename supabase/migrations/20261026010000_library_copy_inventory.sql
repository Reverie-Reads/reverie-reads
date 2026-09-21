-- Personal editions/copies travel atomically with their book, its RLS, offline mirror and backup.
-- NULL means not set up. No historical quantities, bindings or edition identities are invented.
alter table public.books
  add column copy_inventory jsonb,
  add column copy_inventory_revision integer not null default 0;

create function public.valid_copy_inventory(p jsonb) returns boolean
language plpgsql immutable security definer set search_path = '' as $$
declare e jsonb; c jsonb; k text; ids text[] := '{}'; copy_ids text[] := '{}';
  uuid_pattern text := '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$';
  dt text;
begin
  if p is null then return true; end if;
  if jsonb_typeof(p) <> 'object' or p->'version' is distinct from '1'::jsonb
    or jsonb_typeof(p->'editions') is distinct from 'array'
    or jsonb_typeof(p->'copies') is distinct from 'array' then return false; end if;
  if octet_length(p::text) > 1048576 or jsonb_array_length(p->'editions') > 100
    or jsonb_array_length(p->'copies') > 500 then return false; end if;
  for k in select jsonb_object_keys(p) loop
    if k not in ('version','editions','copies') then return false; end if;
  end loop;
  for e in select value from jsonb_array_elements(p->'editions') loop
    if jsonb_typeof(e) <> 'object' then return false; end if;
    if jsonb_typeof(e->'id') is distinct from 'string' or (e->>'id') !~ uuid_pattern
      or e->>'id' = any(ids) then return false; end if;
    ids := array_append(ids,e->>'id');
    if coalesce(e->>'format','') not in ('paperback','hardcover','physical','ebook','audiobook','unknown') then return false; end if;
    foreach k in array array['label','isbn','publisher','published','cover'] loop
      if jsonb_typeof(e->k) is distinct from 'string' then return false; end if;
    end loop;
    if char_length(e->>'label') > 160 or char_length(e->>'isbn') > 32
      or char_length(e->>'publisher') > 160 or char_length(e->>'cover') > 2048 then return false; end if;
    if e->>'cover' <> '' and (e->>'cover' !~ '^https://[^/@[:space:]]+([/?#]|$)' or e->>'cover' ~ '^https://[^/]*@') then return false; end if;
    if e->>'isbn' <> '' and not public.library_isbn_checksum_is_valid(e->>'isbn') then return false; end if;
    if e->>'cover' ~* '^https://books\.(google\.com|googleusercontent\.com)/books/content(/|[?#]|$)' then return false; end if;
    dt := e->>'published';
    if dt <> '' then
      if dt !~ '^[0-9]{4}(-[0-9]{2}(-[0-9]{2})?)?$' or substring(dt,1,4)::integer < 1 then return false; end if;
      -- ISO date parsing rejects impossible days without filling unsupported precision in storage.
      perform (dt || case char_length(dt) when 4 then '-01-01' when 7 then '-01' else '' end)::date;
    end if;
    if e->'pages' is distinct from 'null'::jsonb then
      if jsonb_typeof(e->'pages') is distinct from 'number' or (e->>'pages')::numeric <> trunc((e->>'pages')::numeric)
        or (e->>'pages')::numeric not between 1 and 20000 then return false; end if;
    end if;
    for k in select jsonb_object_keys(e) loop
      if k not in ('id','label','format','isbn','publisher','published','pages','cover') then return false; end if;
    end loop;
  end loop;
  for c in select value from jsonb_array_elements(p->'copies') loop
    if jsonb_typeof(c) <> 'object' then return false; end if;
    if jsonb_typeof(c->'id') is distinct from 'string' or c->>'id' !~ uuid_pattern or c->>'id' = any(copy_ids)
      or not coalesce(c->>'editionId' = any(ids),false)
      or coalesce(c->>'state','') not in ('owned','borrowed','wishlist','unset') then return false; end if;
    copy_ids := array_append(copy_ids,c->>'id');
    foreach k in array array['label','location'] loop
      if jsonb_typeof(c->k) is distinct from 'string' or char_length(c->>k)>160 then return false; end if;
    end loop;
    for k in select jsonb_object_keys(c) loop
      if k not in ('id','editionId','state','label','location') then return false; end if;
    end loop;
  end loop;
  return true;
exception when others then return false;
end;
$$;
revoke all on function public.valid_copy_inventory(jsonb) from public, anon, authenticated, service_role;
grant execute on function public.valid_copy_inventory(jsonb) to authenticated, service_role;
alter table public.books add constraint books_copy_inventory_valid check (public.valid_copy_inventory(copy_inventory));

create function public.project_copy_inventory() returns trigger
language plpgsql security definer set search_path = '' as $$
declare formats text[]; changed boolean;
begin
  changed := tg_op = 'INSERT';
  if tg_op = 'UPDATE' then
    changed := new.copy_inventory is distinct from old.copy_inventory;
    if old.copy_inventory is not null and new.copy_inventory is null then
      raise exception 'Edit individual editions and copies instead of clearing their inventory';
    end if;
    if old.copy_inventory is not null and not changed and
      row(new.ownership,new.borrowed,new.wishlist,new.owned_physical,new.owned_ebook,new.owned_audiobook)
      is distinct from row(old.ownership,old.borrowed,old.wishlist,old.owned_physical,old.owned_ebook,old.owned_audiobook) then
      raise exception 'Manage possession in Your editions & copies';
    end if;
    new.copy_inventory_revision := old.copy_inventory_revision + case when changed or
      (old.copy_inventory is null and row(new.ownership,new.borrowed,new.wishlist,new.owned_physical,new.owned_ebook,new.owned_audiobook,new.isbn,new.pages,new.pub_y,new.pub_m,new.pub_d)
       is distinct from row(old.ownership,old.borrowed,old.wishlist,old.owned_physical,old.owned_ebook,old.owned_audiobook,old.isbn,old.pages,old.pub_y,old.pub_m,old.pub_d)) then 1 else 0 end;
  else
    new.copy_inventory_revision := 0;
  end if;
  if new.copy_inventory is null then return new; end if;
  if not public.valid_copy_inventory(new.copy_inventory) then raise exception 'Invalid editions and copies' using errcode='23514'; end if;
  select array_agg(distinct e->>'format') into formats
    from jsonb_array_elements(new.copy_inventory->'editions') e
    where exists (select 1 from jsonb_array_elements(new.copy_inventory->'copies') c
      where c->>'editionId'=e->>'id' and c->>'state' in ('owned','borrowed'));
  new.ownership := case when exists(select 1 from jsonb_array_elements(new.copy_inventory->'copies') c where c->>'state'='owned') then 'owned' else 'unowned' end;
  new.borrowed := exists(select 1 from jsonb_array_elements(new.copy_inventory->'copies') c where c->>'state'='borrowed');
  new.wishlist := exists(select 1 from jsonb_array_elements(new.copy_inventory->'copies') c where c->>'state'='wishlist');
  new.owned_physical := case
    when 'physical'=any(formats) or ('paperback'=any(formats) and 'hardcover'=any(formats)) then 'yes'
    when 'paperback'=any(formats) then 'paperback' when 'hardcover'=any(formats) then 'hardcover' else null end;
  new.owned_ebook := coalesce('ebook'=any(formats),false);
  new.owned_audiobook := coalesce('audiobook'=any(formats),false);
  return new;
end;
$$;
revoke all on function public.project_copy_inventory() from public, anon, authenticated, service_role;
-- Before existing book/household AFTER triggers: they continue to see the truthful aggregate.
create trigger books_copy_inventory before insert or update on public.books
  for each row execute function public.project_copy_inventory();

create function public.save_copy_inventory(p_book uuid, p_expected_revision integer, p_inventory jsonb)
returns public.books language plpgsql security definer set search_path = '' as $$
declare b public.books;
begin
  select * into b from public.books where id=p_book and owner_id=(select auth.uid()) and removed_at is null for update;
  if not found then raise exception 'Book unavailable' using errcode='42501'; end if;
  if p_inventory is null or not public.valid_copy_inventory(p_inventory) then raise exception 'Invalid editions and copies' using errcode='23514'; end if;
  -- A retry of a confirmed-but-lost response is read-only. Stable item IDs prevent extra copies.
  if b.copy_inventory = p_inventory then return b; end if;
  if p_expected_revision is distinct from b.copy_inventory_revision then
    raise exception 'Copies changed elsewhere. Reload the saved copies before trying again.' using errcode='PT409';
  end if;
  update public.books set copy_inventory=p_inventory where id=p_book returning * into b;
  return b;
end;
$$;
revoke all on function public.save_copy_inventory(uuid,integer,jsonb) from public, anon, authenticated, service_role;
grant execute on function public.save_copy_inventory(uuid,integer,jsonb) to authenticated;

-- Legacy duplicate merges delete a book row and know nothing about individual inventory.
-- Refuse BEFORE any merge side effects. Readers can keep both; no existing duplicate is collapsed.
-- Patch the common internal merge so both old and authority-aware entrypoints retain protection.
do $$
declare body text; marker text := '  -- 1. Carry the loser''s reads onto the primary';
begin
  body := pg_get_functiondef('public.merge_books(uuid,uuid,jsonb)'::regprocedure);
  if strpos(body,marker)=0 then raise exception 'merge_books inventory guard anchor missing'; end if;
  body := replace(body, marker, $guard$
  perform 1 from public.books where id in (p_primary,p_loser) order by id for update;
  if exists (select 1 from public.books where id in (p_primary,p_loser) and copy_inventory is not null) then
    raise exception 'These books have individual editions and copies. Keep both to preserve their inventories.';
  end if;
$guard$ || marker);
  execute body;
end;
$$;
comment on column public.books.copy_inventory is 'Private v1 editions and individual copies. Null is legacy/unconfigured. Explicit reader setup only; not shared catalog evidence.';
