-- A work is the shared identity. An edition is a published version, never a reader's copy.
-- No private inventories, annotations, reading history or assessments are copied into this registry.
begin;
alter table public.works add column shared_spice integer check (shared_spice between 0 and 5);
alter table public.works add column shared_darkness integer check (shared_darkness between 0 and 5);

create function public.corpus_edition_details_valid(v jsonb)
returns boolean language plpgsql immutable set search_path='' as $$
declare k text; y integer; m integer; d integer;
begin
  if jsonb_typeof(v) is distinct from 'object' or v - array['title','statement','format','publisher','language','pages','publication'] <> '{}'::jsonb then return false; end if;
  foreach k in array array['title','statement','format','publisher','language'] loop
    if v ? k and (jsonb_typeof(v->k) not in ('string','null') or length(v->>k)>1000) then return false; end if;
  end loop;
  if v->>'format' is not null and v->>'format' not in ('hardcover','paperback','ebook','audiobook','other') then return false; end if;
  if v ? 'pages' and v->'pages'<>'null'::jsonb then
    if jsonb_typeof(v->'pages')<>'number' or (v->>'pages') !~ '^[0-9]{1,5}$' then return false; end if;
    if (v->>'pages')::integer not between 1 and 20000 then return false; end if;
  end if;
  if v ? 'publication' and v->'publication'<>'null'::jsonb then
    if jsonb_typeof(v->'publication')<>'object' or not (v->'publication') ?& array['y','m','d']
      or (v->'publication')-array['y','m','d']<>'{}'::jsonb then return false; end if;
    foreach k in array array['y','m','d'] loop
      if v->'publication'->k<>'null'::jsonb and (jsonb_typeof(v->'publication'->k)<>'number'
        or v->'publication'->>k !~ '^[0-9]{1,4}$') then return false; end if;
    end loop;
    y := (v->'publication'->>'y')::integer; m := (v->'publication'->>'m')::integer; d := (v->'publication'->>'d')::integer;
    if not public.publication_tuple_is_valid(y,m,d) then return false; end if;
  end if;
  return true;
end;
$$;
revoke all on function public.corpus_edition_details_valid(jsonb) from public,anon,authenticated,service_role;

create table public.corpus_editions (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  isbn text unique check (isbn is null or (public.library_isbn_checksum_is_valid(isbn) and isbn=public.canonical_library_isbn(isbn))),
  details jsonb not null default '{}' check (public.corpus_edition_details_valid(details)),
  reviewed boolean not null default false,
  revision integer not null default 1 check (revision>0),
  provenance jsonb not null default '{}',
  source_url text,
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now()
);
create index corpus_editions_work_idx on public.corpus_editions(work_id,id);
create table public.corpus_isbn_exclusions (
  work_id uuid not null references public.works(id) on delete cascade,
  isbn text not null,
  primary key(work_id,isbn)
);
create table public.corpus_record_edits (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete restrict,
  edition_id uuid references public.corpus_editions(id) on delete restrict,
  editor_id uuid references public.profiles(id) on delete set null,
  action text not null check (action in ('edition','guidance','remove_isbn','resolve_report')),
  previous_value jsonb not null,
  next_value jsonb not null,
  source_url text not null,
  note text not null,
  created_at timestamptz not null default now()
);
create index corpus_record_edits_work_idx on public.corpus_record_edits(work_id,created_at desc,id);
create index corpus_record_edits_edition_idx on public.corpus_record_edits(edition_id);
create index corpus_record_edits_editor_idx on public.corpus_record_edits(editor_id);
create table public.corpus_isbn_reports (
  id uuid primary key default gen_random_uuid(),
  work_id uuid not null references public.works(id) on delete cascade,
  reporter_id uuid not null references public.profiles(id) on delete cascade,
  isbn text not null check (length(isbn)<=32),
  proposed_isbn text check (proposed_isbn is null or (public.library_isbn_checksum_is_valid(proposed_isbn) and proposed_isbn=public.canonical_library_isbn(proposed_isbn))),
  note text not null check (length(note) between 1 and 1200),
  resolved_at timestamptz,
  created_at timestamptz not null default now()
);
create index corpus_isbn_reports_work_idx on public.corpus_isbn_reports(work_id,created_at,id);
create index corpus_isbn_reports_reporter_idx on public.corpus_isbn_reports(reporter_id);
create unique index corpus_isbn_reports_open_idx on public.corpus_isbn_reports(work_id,reporter_id,isbn) where resolved_at is null;

alter table public.corpus_editions enable row level security;
alter table public.corpus_isbn_exclusions enable row level security;
alter table public.corpus_record_edits enable row level security;
alter table public.corpus_isbn_reports enable row level security;
revoke all on public.corpus_editions,public.corpus_isbn_exclusions,public.corpus_record_edits,public.corpus_isbn_reports from public,anon,authenticated,service_role;
-- All access is through work-scoped, authenticated read/write functions. No direct API table writes.

create function public.corpus_record_fingerprint(p_work uuid)
returns text language sql stable security definer set search_path='' as $$
  select md5(jsonb_build_array(to_jsonb(w),
    (select coalesce(jsonb_agg(to_jsonb(e) order by e.id),'[]') from public.corpus_editions e where e.work_id=w.id),
    (select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') from public.corpus_isbn_reports r where r.work_id=w.id))::text)
  from public.works w where w.id=p_work;
$$;
revoke all on function public.corpus_record_fingerprint(uuid) from public,anon,authenticated,service_role;

create function public.get_corpus_record(p_work uuid)
returns jsonb language plpgsql stable security definer set search_path='' as $$
declare w public.works; is_admin boolean;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into w from public.works where id=p_work;
  if not found then raise exception 'corpus work not found' using errcode='P0002'; end if;
  is_admin := public.is_corpus_admin();
  return jsonb_build_object('id',w.id,'title',w.title,'author',w.author_text,'contributors',w.contributors,
    'description',w.description,'genre',w.genre,'genres',w.genres,'subgenre',w.subgenre,'subgenres',w.subgenres,
    'spice',w.shared_spice,'darkness',w.shared_darkness,'guidanceSource',w.metadata_provenance->'sharedGuidance',
    'isbns',w.isbns,'fingerprint',public.corpus_record_fingerprint(w.id),
    'editions',(select coalesce(jsonb_agg(to_jsonb(e) order by e.reviewed desc,e.created_at,e.id),'[]') from public.corpus_editions e where e.work_id=w.id),
    'reports',(select coalesce(jsonb_agg(to_jsonb(r)-'reporter_id' order by r.created_at,r.id),'[]')
      from public.corpus_isbn_reports r where r.work_id=w.id and r.resolved_at is null and (is_admin or r.reporter_id=(select auth.uid()))),
    'history',case when is_admin then (select coalesce(jsonb_agg(to_jsonb(x)-'editor_id' order by x.created_at desc,x.id),'[]') from
      (select * from public.corpus_record_edits where work_id=w.id order by created_at desc,id limit 30) x) else '[]'::jsonb end);
end;
$$;
revoke all on function public.get_corpus_record(uuid) from public,anon,authenticated,service_role;
grant execute on function public.get_corpus_record(uuid) to authenticated;

-- Invalid legacy ISBNs remain reviewable. Only globally unambiguous, checksum-valid references
-- get edition rows; absent pages, binding, language and publisher remain unknown.
create function public.sync_corpus_edition_references()
returns trigger language plpgsql security definer set search_path='' as $$
declare i text; facts jsonb; pub_fields text[];
begin
  foreach i in array public.catalog_review_isbns(new.isbns) loop
    if exists(select 1 from public.corpus_isbn_exclusions where work_id=new.id and isbn=i)
      or exists(select 1 from public.works w where w.id<>new.id and public.catalog_review_isbns(w.isbns) @> array[i]) then continue; end if;
    facts := '{}'::jsonb;
    if new.pages is not null and public.corpus_edition_fields_match(new.metadata_provenance,array['pageCount'],i,jsonb_build_object('pages',new.pages))
      and new.metadata_provenance->'pageCount' ? 'referenceIsbn' then facts := facts || jsonb_build_object('pages',new.pages); end if;
    pub_fields := array['pubY'] || case when new.pub_m is null then '{}'::text[] else array['pubM'] end
      || case when new.pub_d is null then '{}'::text[] else array['pubD'] end;
    if new.pub_y is not null and public.publication_tuple_is_valid(new.pub_y,new.pub_m,new.pub_d)
      and new.metadata_provenance->'pubY' ? 'referenceIsbn'
      and public.corpus_edition_fields_match(new.metadata_provenance,pub_fields,i,jsonb_build_object('y',new.pub_y,'m',new.pub_m,'d',new.pub_d)) then
      facts := facts || jsonb_build_object('publication',jsonb_build_object('y',new.pub_y,'m',new.pub_m,'d',new.pub_d));
    end if;
    insert into public.corpus_editions(work_id,isbn,details,provenance) values(new.id,i,facts,new.metadata_provenance)
      on conflict(isbn) do update set details=excluded.details || corpus_editions.details,
        provenance=excluded.provenance || corpus_editions.provenance,
        revision=corpus_editions.revision+1,updated_at=now()
      where corpus_editions.work_id=new.id and not corpus_editions.reviewed
        and excluded.details || corpus_editions.details is distinct from corpus_editions.details;
  end loop;
  return new;
end;
$$;
revoke all on function public.sync_corpus_edition_references() from public,anon,authenticated,service_role;
create trigger works_sync_corpus_editions after insert or update of isbns,pages,pub_y,pub_m,pub_d,metadata_provenance on public.works
  for each row execute function public.sync_corpus_edition_references();
-- Generic structural backfill of identifier references only. Do not certify old work-level facts.
insert into public.corpus_editions(work_id,isbn)
select w.id,i from public.works w cross join lateral unnest(public.catalog_review_isbns(w.isbns)) i
where not exists(select 1 from public.works other where other.id<>w.id and public.catalog_review_isbns(other.isbns) @> array[i])
on conflict(isbn) do nothing;

-- Rejected assignments must not reappear on the next automatic provider refresh.
create or replace function public.validate_work_isbn_assignment()
returns trigger language plpgsql security definer set search_path='' as $$
begin
  new.isbns := public.canonical_library_isbns(new.isbns);
  perform public.lock_library_isbns(new.isbns);
  new.isbns := array(select i from unnest(new.isbns) i where not exists(
    select 1 from public.corpus_isbn_exclusions x where x.work_id=new.id and x.isbn=i));
  if exists(select 1 from public.works existing cross join unnest(new.isbns) isbn where existing.id<>new.id and isbn=any(existing.isbns)) then
    raise exception 'canonical ISBN is already assigned to another work' using errcode='23505';
  end if;
  return new;
end;
$$;
revoke all on function public.validate_work_isbn_assignment() from public,anon,authenticated,service_role;

create function public.admin_save_corpus_record(p_work uuid,p_expected_fingerprint text,p_action text,p_value jsonb,p_source_url text,p_note text,p_confirmed boolean default false)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); w public.works; old_record jsonb; next_record jsonb;
  e public.corpus_editions; eid uuid; reference text; old_isbn text; isbns_to_lock text[];
  preserve_catalog_before text := current_setting('reverie.series_review_preserve_catalog',true);
  genres text[]; subs text[]; spice integer; darkness integer; report_id uuid;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_confirmed is distinct from true or nullif(btrim(p_note),'') is null or length(p_note)>1200
    or p_source_url is null or length(p_source_url)>2000 or p_source_url !~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'
    or p_action is null or p_action not in ('edition','guidance','remove_isbn','resolve_report') or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Review the change and provide its evidence link and explanation.' using errcode='22023'; end if;
  -- Freeze all old/new ISBN locks before the work lock, matching the existing intake lock order.
  select isbns into isbns_to_lock from public.works where id=p_work;
  if p_action='edition' then
    if not p_value ?& array['id','isbn','details'] or p_value-array['id','isbn','details']<>'{}'::jsonb
      or not public.corpus_edition_details_valid(p_value->'details')
      or jsonb_typeof(p_value->'isbn') not in ('string','null') then raise exception 'Invalid edition details.' using errcode='22023'; end if;
    eid := (p_value->>'id')::uuid;
    if eid is null then raise exception 'Edition identifier required.' using errcode='22023'; end if;
    if nullif(btrim(p_value->>'isbn'),'') is not null then
      if not public.library_isbn_checksum_is_valid(p_value->>'isbn') then raise exception 'Enter a valid ISBN-10 or ISBN-13.' using errcode='22023'; end if;
      reference := public.canonical_library_isbn(p_value->>'isbn');
    end if;
    select isbn into old_isbn from public.corpus_editions where id=eid and work_id=p_work;
    isbns_to_lock := isbns_to_lock || array[reference,old_isbn];
  elsif p_action='remove_isbn' then
    if jsonb_typeof(p_value->'isbn') is distinct from 'string' or length(p_value->>'isbn')>32
      or p_value-array['isbn']<>'{}'::jsonb then raise exception 'Choose an existing ISBN assignment.' using errcode='22023'; end if;
    old_isbn := p_value->>'isbn'; isbns_to_lock := isbns_to_lock || array[old_isbn];
  end if;
  perform public.lock_library_isbns(isbns_to_lock);
  select * into w from public.works where id=p_work for update;
  if not found then raise exception 'corpus work not found' using errcode='P0002'; end if;
  if p_expected_fingerprint is distinct from public.corpus_record_fingerprint(p_work) then
    raise exception 'This catalog record changed. Reload before reviewing the change again.' using errcode='40001'; end if;
  old_record := public.get_corpus_record(p_work)-array['reports','history','fingerprint'];
  perform set_config('reverie.series_review_preserve_catalog','on',true);
  if p_action='edition' then
    select * into e from public.corpus_editions where id=eid for update;
    if found and e.work_id<>p_work then raise exception 'Edition belongs to a different work.' using errcode='22023'; end if;
    if reference is not null and exists(select 1 from public.works other where other.id<>p_work and reference=any(public.catalog_review_isbns(other.isbns))) then
      raise exception 'This ISBN belongs to another catalog record. Review and remove its incorrect assignment there first.' using errcode='23505'; end if;
    if reference is not null and exists(select 1 from public.corpus_editions other where other.id<>eid and other.isbn=reference) then
      raise exception 'This ISBN already has an edition. Edit that edition instead.' using errcode='23505'; end if;
    -- Changing an edition ISBN corrects its old work assignment, with an exclusion against reacquisition.
    if e.isbn is not null and e.isbn is distinct from reference then
      insert into public.corpus_isbn_exclusions values(p_work,e.isbn) on conflict do nothing;
    end if;
    if reference is not null then delete from public.corpus_isbn_exclusions where work_id=p_work and isbn=reference; end if;
    insert into public.corpus_editions(id,work_id,isbn,details,reviewed,source_url,provenance)
      values(eid,p_work,reference,p_value->'details',true,p_source_url,jsonb_build_object('source','administrator','observedAt',now()))
      on conflict(id) do update set isbn=excluded.isbn,details=excluded.details,reviewed=true,source_url=excluded.source_url,
        provenance=excluded.provenance,revision=corpus_editions.revision+1,updated_at=now();
    update public.works set isbns=array(select distinct i from unnest(w.isbns || case when reference is null then '{}'::text[] else array[reference] end) i
      where i is distinct from e.isbn or i=reference) where id=p_work;
  elsif p_action='remove_isbn' then
    if not old_isbn=any(w.isbns) then raise exception 'This ISBN is no longer assigned to this work.' using errcode='40001'; end if;
    insert into public.corpus_isbn_exclusions values(p_work,coalesce(public.canonical_library_isbn(old_isbn),old_isbn)) on conflict do nothing;
    -- Retain the edition and its history; only the incorrect identifier assignment is removed.
    update public.corpus_editions set isbn=null,reviewed=false,revision=revision+1,updated_at=now() where work_id=p_work and isbn=public.canonical_library_isbn(old_isbn);
    update public.works set isbns=array_remove(w.isbns,old_isbn) where id=p_work;
  elsif p_action='guidance' then
    if not p_value ?& array['genres','subgenres','spice','darkness'] or p_value-array['genres','subgenres','spice','darkness']<>'{}'::jsonb
      or jsonb_typeof(p_value->'genres')<>'array' or jsonb_typeof(p_value->'subgenres')<>'array'
      or jsonb_array_length(p_value->'genres')>30 or jsonb_array_length(p_value->'subgenres')>50
      or exists(select 1 from jsonb_array_elements((p_value->'genres') || (p_value->'subgenres')) item where jsonb_typeof(item)<>'string' or length(item#>>'{}') not between 1 and 120)
      or (p_value->'spice'<>'null'::jsonb and (jsonb_typeof(p_value->'spice')<>'number' or p_value->>'spice' !~ '^[0-5]$'))
      or (p_value->'darkness'<>'null'::jsonb and (jsonb_typeof(p_value->'darkness')<>'number' or p_value->>'darkness' !~ '^[0-5]$')) then
      raise exception 'Use genre names and guidance levels from 0 to 5, or leave levels unknown.' using errcode='22023'; end if;
    select coalesce(array_agg(name order by ord),'{}') into genres from (select lower(btrim(value)) name,min(ord) ord from jsonb_array_elements_text(p_value->'genres') with ordinality a(value,ord) where nullif(btrim(value),'') is not null group by lower(btrim(value))) g;
    select coalesce(array_agg(name order by ord),'{}') into subs from (select (array_agg(btrim(value) order by ord))[1] name,min(ord) ord from jsonb_array_elements_text(p_value->'subgenres') with ordinality a(value,ord) where nullif(btrim(value),'') is not null group by lower(btrim(value))) g;
    spice := (p_value->>'spice')::integer; darkness := (p_value->>'darkness')::integer;
    update public.works set genre=genres[1],genres=genres,subgenre=subs[1],subgenres=subs,shared_spice=spice,shared_darkness=darkness,
      metadata_provenance=coalesce(metadata_provenance,'{}') || jsonb_build_object('sharedGuidance',jsonb_build_object('source','administrator','sourceRef',p_source_url,'observedAt',now())) where id=p_work;
  else
    if p_value-array['reportId']<>'{}'::jsonb then raise exception 'Choose a report to resolve.' using errcode='22023'; end if;
    report_id := (p_value->>'reportId')::uuid;
    update public.corpus_isbn_reports set resolved_at=now() where id=report_id and work_id=p_work and resolved_at is null;
    if not found then raise exception 'The report has already changed.' using errcode='40001'; end if;
  end if;
  perform set_config('reverie.series_review_preserve_catalog',coalesce(preserve_catalog_before,''),true);
  next_record := public.get_corpus_record(p_work)-array['reports','history','fingerprint'];
  insert into public.corpus_record_edits(work_id,edition_id,editor_id,action,previous_value,next_value,source_url,note)
    values(p_work,eid,caller,p_action,old_record,next_record || case when report_id is null then '{}'::jsonb else jsonb_build_object('resolvedReport',report_id) end,p_source_url,btrim(p_note));
  return p_work;
end;
$$;
revoke all on function public.admin_save_corpus_record(uuid,text,text,jsonb,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_corpus_record(uuid,text,text,jsonb,text,text,boolean) to authenticated;

create function public.report_corpus_isbn(p_work uuid,p_isbn text,p_proposed_isbn text,p_note text)
returns uuid language plpgsql security definer set search_path='' as $$
declare caller uuid := (select auth.uid()); result uuid; proposed text;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  if p_isbn is null or length(p_isbn)>32 or nullif(btrim(p_note),'') is null or length(p_note)>1200
    or length(p_proposed_isbn)>32 or (nullif(btrim(p_proposed_isbn),'') is not null and not public.library_isbn_checksum_is_valid(p_proposed_isbn)) then
    raise exception 'Describe the ISBN problem and check any suggested replacement.' using errcode='22023'; end if;
  perform 1 from public.works where id=p_work for update;
  if not found then raise exception 'corpus work not found' using errcode='P0002'; end if;
  if not exists(select 1 from public.books b where b.owner_id=caller and b.corpus_work_id=p_work and b.removed_at is null)
    and not public.is_corpus_admin() then raise exception 'Add this book to your library before reporting its ISBN.' using errcode='42501'; end if;
  proposed := case when nullif(btrim(p_proposed_isbn),'') is null then null else public.canonical_library_isbn(p_proposed_isbn) end;
  insert into public.corpus_isbn_reports(work_id,reporter_id,isbn,proposed_isbn,note) values(p_work,caller,btrim(p_isbn),proposed,btrim(p_note))
    on conflict(work_id,reporter_id,isbn) where resolved_at is null do update set proposed_isbn=excluded.proposed_isbn,note=excluded.note
    returning id into result;
  return result;
end;
$$;
revoke all on function public.report_corpus_isbn(uuid,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.report_corpus_isbn(uuid,text,text,text) to authenticated;

-- Keep reader reports in the existing admin queue, including otherwise complete records.
do $$
declare definition text;
begin
  definition := pg_get_functiondef('public.catalog_metadata_review_record(public.works)'::regprocedure);
  if position('case when conflict then' in definition)=0 then raise exception 'metadata review record changed'; end if;
  definition := replace(definition,'case when conflict then',
    'case when exists(select 1 from public.corpus_isbn_reports r where r.work_id=p_work.id and r.resolved_at is null) then ''reader_report'' end, case when conflict then');
  -- New reader reports reopen an old assessment; absent reports preserve legacy fingerprints.
  if position('else ''[]''::jsonb end)::text)' in definition)=0 then raise exception 'metadata fingerprint changed'; end if;
  definition := replace(definition,'else ''[]''::jsonb end)::text)',
    'else ''[]''::jsonb end || coalesce((select jsonb_agg(jsonb_build_array(r.id,r.isbn,r.proposed_isbn,r.note) order by r.id) from public.corpus_isbn_reports r where r.work_id=p_work.id and r.resolved_at is null),''[]''::jsonb))::text)');
  execute definition;
  definition := pg_get_functiondef('public.admin_list_corpus_metadata_reviews(text,text,text,integer,integer,uuid)'::regprocedure);
  if position('''invalid_isbn''' in definition)=0 then raise exception 'metadata review queue changed'; end if;
  definition := replace(definition,'''all'',''description'',''invalid_isbn''','''all'',''description'',''reader_report'',''invalid_isbn''');
  execute definition;
end;
$$;

-- Existing automatic completion may append provider genres. Administrator-reviewed guidance wins.
do $$
declare definition text; anchor text := 'replace_cover :=';
begin
  definition := pg_get_functiondef('public.complete_corpus_work_metadata_without_series_review(uuid,jsonb,timestamptz)'::regprocedure);
  if position(anchor in definition)=0 then raise exception 'corpus completion changed'; end if;
  definition := replace(definition,anchor,
    'if before_value->''metadata_provenance'' ? ''sharedGuidance'' then p_patch := p_patch-array[''genre'',''genres'']; end if; ' || anchor);
  execute definition;
end;
$$;

-- Deliberate selection changes only the personal record's selected ISBN/page/date tuple. It never
-- creates ownership, changes a configured copy inventory, or imports unknown values from a sibling.
create function public.select_corpus_edition(p_book uuid,p_edition uuid,p_revision integer,p_expected jsonb)
returns uuid language plpgsql security definer set search_path='' as $$
declare b public.books; e public.corpus_editions;
begin
  if (select auth.uid()) is null then raise exception 'authentication required' using errcode='42501'; end if;
  select * into b from public.books where id=p_book and owner_id=(select auth.uid()) and removed_at is null for update;
  if not found then raise exception 'personal book not found' using errcode='42501'; end if;
  if b.copy_inventory is not null then raise exception 'Choose editions within your individual copy inventory.' using errcode='22023'; end if;
  if p_expected is distinct from jsonb_build_object('isbn',coalesce(b.isbn,''),'pages',b.pages,'publication',jsonb_build_object('y',b.pub_y,'m',b.pub_m,'d',b.pub_d)) then
    raise exception 'Your book details changed. Reload before choosing an edition.' using errcode='40001'; end if;
  select * into e from public.corpus_editions where id=p_edition and work_id=b.corpus_work_id for share;
  if not found or not e.reviewed or e.revision is distinct from p_revision then
    raise exception 'This edition changed or still needs review. Reload its details.' using errcode='40001'; end if;
  update public.books set isbn=coalesce(e.isbn,''),pages=(e.details->>'pages')::integer,
    pub_y=(e.details->'publication'->>'y')::integer,pub_m=(e.details->'publication'->>'m')::integer,pub_d=(e.details->'publication'->>'d')::integer
    where id=b.id;
  return b.id;
end;
$$;
revoke all on function public.select_corpus_edition(uuid,uuid,integer,jsonb) from public,anon,authenticated,service_role;
grant execute on function public.select_corpus_edition(uuid,uuid,integer,jsonb) to authenticated;
commit;
