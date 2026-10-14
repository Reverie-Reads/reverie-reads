begin;
-- Household bibliography is a shared overlay, not corpus authority or another reader's book.
-- No historical personal annotations are published by this migration.
alter table public.household_work_enrichment add column bibliography jsonb not null default '{}'
  check (jsonb_typeof(bibliography)='object');

create function public.sync_personal_household_bibliography(p_book uuid,p_previous jsonb default null)
returns void language plpgsql security definer set search_path='' as $$
declare b public.books; hid uuid; value jsonb := '{}'; snapshot jsonb; k text;
begin
  select * into b from public.books where id=p_book and owner_id=(select auth.uid()) and removed_at is null for update;
  if not found then return; end if;
  select household_id into hid from public.household_members where user_id=b.owner_id for key share;
  if hid is null then return; end if;
  perform 1 from public.households where id=hid for update;
  if not exists(select 1 from public.household_members where user_id=b.owner_id and household_id=hid)
    or not exists(select 1 from public.household_works where household_id=hid and work_id=b.corpus_work_id and removed_at is null) then return; end if;
  snapshot := jsonb_build_object('title',b.title,'author',coalesce(nullif(b.authors_display,''),concat_ws(' ',b.author_first,b.author_last)),
    'series_name',b.series,'series_position',b.position,'series_count',b.series_count,'series_status',b.status,
    'primary_genre',b.genre,'genres',b.genres,'subgenre',b.subgenre,'subgenres',b.subgenres,
    'isbns',case when nullif(btrim(b.isbn),'') is null then '[]'::jsonb else jsonb_build_array(b.isbn) end,
    'pub_y',b.pub_y,'pub_m',b.pub_m,'pub_d',b.pub_d);
  -- Unknown intake fields preserve existing shared information. Later deliberate clears travel
  -- as one group, so clearing a series/date cannot leave a stale position/day behind.
  foreach k in array array['title','author','primary_genre','genres','subgenre','subgenres','isbns'] loop
    if (p_previous is null and snapshot->k not in ('null'::jsonb,'""'::jsonb,'[]'::jsonb))
      or (p_previous is not null and snapshot->k is distinct from p_previous->k) then
      value := value || jsonb_build_object(k,snapshot->k);
    end if;
  end loop;
  if (p_previous is null and nullif(btrim(b.series),'') is not null) or (p_previous is not null and
    jsonb_build_array(snapshot->'series_name',snapshot->'series_position',snapshot->'series_count',snapshot->'series_status') is distinct from
    jsonb_build_array(p_previous->'series_name',p_previous->'series_position',p_previous->'series_count',p_previous->'series_status')) then
    value := value || jsonb_build_object('series_name',b.series,'series_position',b.position,'series_count',b.series_count,'series_status',b.status);
  end if;
  if (p_previous is null and b.pub_y is not null) or (p_previous is not null and
    jsonb_build_array(snapshot->'pub_y',snapshot->'pub_m',snapshot->'pub_d') is distinct from
    jsonb_build_array(p_previous->'pub_y',p_previous->'pub_m',p_previous->'pub_d')) then
    value := value || jsonb_build_object('pub_y',b.pub_y,'pub_m',b.pub_m,'pub_d',b.pub_d);
  end if;
  if value='{}'::jsonb then return; end if;
  insert into public.household_work_enrichment(household_id,work_id,updated_by,bibliography)
    values(hid,b.corpus_work_id,b.owner_id,value)
    on conflict(household_id,work_id) do update set
      bibliography=household_work_enrichment.bibliography || excluded.bibliography,
      updated_by=excluded.updated_by,updated_at=now();
end;
$$;
revoke all on function public.sync_personal_household_bibliography(uuid,jsonb) from public,anon,authenticated,service_role;

create function public.on_personal_household_bibliography()
returns trigger language plpgsql security definer set search_path='' as $$
declare previous jsonb;
begin
  if tg_op='UPDATE' and not (old.ownership<>'owned' and new.ownership='owned') then
    previous := jsonb_build_object('title',old.title,'author',coalesce(nullif(old.authors_display,''),concat_ws(' ',old.author_first,old.author_last)),
      'series_name',old.series,'series_position',old.position,'series_count',old.series_count,'series_status',old.status,
      'primary_genre',old.genre,'genres',old.genres,'subgenre',old.subgenre,'subgenres',old.subgenres,
      'isbns',case when nullif(btrim(old.isbn),'') is null then '[]'::jsonb else jsonb_build_array(old.isbn) end,
      'pub_y',old.pub_y,'pub_m',old.pub_m,'pub_d',old.pub_d);
  end if;
  perform public.sync_personal_household_bibliography(new.id,previous);
  return new;
end;
$$;
revoke all on function public.on_personal_household_bibliography() from public,anon,authenticated,service_role;
-- Alphabetically after owned membership admission. Only bibliography columns can publish a patch.
create trigger books_zz_household_bibliography after insert or update of title,authors_display,author_first,author_last,
  series,position,series_count,status,genre,genres,subgenre,subgenres,isbn,pub_y,pub_m,pub_d,ownership on public.books
  for each row execute function public.on_personal_household_bibliography();

-- Explicit Add/import must synchronize the selected personal rows even if the work was already
-- in the household. Existing destination/ownership checks continue to run in the original body.
do $patch$
declare definition text; anchor text;
begin
  definition := pg_get_functiondef('public.add_personal_books_to_household(uuid[])'::regprocedure);
  anchor := '  perform 1 from public.households household';
  if position(anchor in definition)=0 then raise exception 'household batch locking changed'; end if;
  definition := replace(definition,anchor,'  perform 1 from public.books where id=any(p_books) and owner_id=caller order by id for update; ' || anchor);
  anchor := 'return requested_count;';
  if position(anchor in definition)=0 then raise exception 'household batch add changed'; end if;
  execute replace(definition,anchor,'perform public.sync_personal_household_bibliography(book_id,null) from unnest(p_books) book_id; ' || anchor);
  definition := pg_get_functiondef('public.add_personal_book_to_household(uuid)'::regprocedure);
  anchor := 'from public.household_members hm where hm.user_id = caller;';
  if position(anchor in definition)=0 then raise exception 'household personal locking changed'; end if;
  definition := replace(definition,anchor,'from public.household_members hm where hm.user_id = caller for key share;');
  anchor := 'return target_work;';
  if position(anchor in definition)=0 then raise exception 'household personal add changed'; end if;
  execute replace(definition,anchor,'perform public.sync_personal_household_bibliography(p_book,null); ' || anchor);
end;
$patch$;

-- Versioned read preserves the established v1 response for older clients. The normal roster and
-- copy privacy checks still run in v1, then only the allowlisted household bibliography overlays it.
create function public.household_library_works_v2()
returns setof jsonb language sql stable security definer set search_path='' as $$
  select to_jsonb(row) || coalesce(enrichment.bibliography,'{}') || jsonb_build_object('corpus_bibliography',to_jsonb(row))
  from public.household_library_works() row
  join public.household_members mine on mine.user_id=(select auth.uid())
  left join public.household_work_enrichment enrichment
    on enrichment.household_id=mine.household_id and enrichment.work_id=row.work_id;
$$;
revoke all on function public.household_library_works_v2() from public,anon,authenticated,service_role;
grant execute on function public.household_library_works_v2() to authenticated;
commit;
