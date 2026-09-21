-- Optional private release reference. No backfill and no shared-catalog authority.
create or replace function public.valid_copy_inventory(p jsonb) returns boolean
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
    if e ? 'sourceUrl' then
      if jsonb_typeof(e->'sourceUrl') is distinct from 'string' or char_length(e->>'sourceUrl') > 2048 then return false; end if;
      if e->>'sourceUrl' <> '' and e->>'sourceUrl' !~ '^https://(hardcover[.]app|www[.]penguinrandomhouse[.]com)/books/[^/?#@[:space:]]+(/[^/?#@[:space:]]+)*/?$' then return false; end if;
    end if;
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
      if k not in ('id','label','format','isbn','publisher','published','pages','cover','sourceUrl') then return false; end if;
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
