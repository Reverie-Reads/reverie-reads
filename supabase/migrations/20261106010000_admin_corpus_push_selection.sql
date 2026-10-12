-- Direct administrator changes remain explicit, fingerprint-bound and audited.
-- Evidence is optional only for the edition/guidance push; other correction workflows retain it.
begin;
create schema if not exists corpus_admin_private;
revoke all on schema corpus_admin_private from public,anon,authenticated,service_role;
alter table public.corpus_record_edits alter column source_url drop not null;
alter table public.corpus_record_edits add column review_mode text not null default 'evidence'
  check (review_mode in ('direct','evidence'));

create function corpus_admin_private.apply_corpus_record_change(p_work uuid,p_expected_fingerprint text,p_action text,p_value jsonb,p_source_url text,p_note text,p_confirmed boolean,p_review_mode text)
returns uuid language plpgsql security invoker set search_path='' as $$
declare caller uuid := (select auth.uid()); w public.works; old_record jsonb; next_record jsonb;
  e public.corpus_editions; eid uuid; reference text; old_isbn text; isbns_to_lock text[];
  preserve_catalog_before text := current_setting('reverie.series_review_preserve_catalog',true);
  desired_genres text[]; subs text[]; spice integer; darkness integer; report_id uuid;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  p_source_url := nullif(btrim(p_source_url),'');
  p_note := coalesce(btrim(p_note),'');
  if p_confirmed is distinct from true or p_review_mode is null or p_review_mode not in ('direct','evidence')
    or length(p_note)>1200 or length(p_source_url)>2000
    or (p_source_url is not null and p_source_url !~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$')
    or (p_review_mode='evidence' and (p_source_url is null or p_note=''))
    or (p_review_mode='direct' and p_action not in ('edition','guidance'))
    or p_action is null or p_action not in ('edition','guidance','remove_isbn','resolve_report') or jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Choose a valid change. Evidence review needs an HTTPS link and explanation.' using errcode='22023'; end if;
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
    raise exception 'This catalog record changed. Reload before reviewing the change again.' using errcode='PT409'; end if;
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
      values(eid,p_work,reference,p_value->'details',true,p_source_url,jsonb_build_object('source','administrator','reviewMode',p_review_mode,'observedAt',now()))
      on conflict(id) do update set isbn=excluded.isbn,details=excluded.details,reviewed=true,source_url=excluded.source_url,
        provenance=excluded.provenance,revision=corpus_editions.revision+1,updated_at=now();
    update public.works set isbns=array(select distinct i from unnest(w.isbns || case when reference is null then '{}'::text[] else array[reference] end) i
      where i is distinct from e.isbn or i=reference) where id=p_work;
  elsif p_action='remove_isbn' then
    if not old_isbn=any(w.isbns) then raise exception 'This ISBN is no longer assigned to this work.' using errcode='PT409'; end if;
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
    select coalesce(array_agg(name order by ord),'{}') into desired_genres from (select lower(btrim(value)) name,min(ord) ord from jsonb_array_elements_text(p_value->'genres') with ordinality a(value,ord) where nullif(btrim(value),'') is not null group by lower(btrim(value))) g;
    select coalesce(array_agg(name order by ord),'{}') into subs from (select (array_agg(btrim(value) order by ord))[1] name,min(ord) ord from jsonb_array_elements_text(p_value->'subgenres') with ordinality a(value,ord) where nullif(btrim(value),'') is not null group by lower(btrim(value))) g;
    spice := (p_value->>'spice')::integer; darkness := (p_value->>'darkness')::integer;
    update public.works set genre=desired_genres[1],genres=desired_genres,subgenre=subs[1],subgenres=subs,shared_spice=spice,shared_darkness=darkness,
      metadata_provenance=coalesce(metadata_provenance,'{}') || jsonb_build_object('sharedGuidance',jsonb_build_object('source','administrator','reviewMode',p_review_mode,'sourceRef',p_source_url,'observedAt',now())) where id=p_work;
  else
    if p_value-array['reportId']<>'{}'::jsonb then raise exception 'Choose a report to resolve.' using errcode='22023'; end if;
    report_id := (p_value->>'reportId')::uuid;
    update public.corpus_isbn_reports set resolved_at=now() where id=report_id and work_id=p_work and resolved_at is null;
    if not found then raise exception 'The report has already changed.' using errcode='PT409'; end if;
  end if;
  perform set_config('reverie.series_review_preserve_catalog',coalesce(preserve_catalog_before,''),true);
  next_record := public.get_corpus_record(p_work)-array['reports','history','fingerprint'];
  insert into public.corpus_record_edits(work_id,edition_id,editor_id,action,previous_value,next_value,source_url,note,review_mode)
    values(p_work,eid,caller,p_action,old_record,next_record || case when report_id is null then '{}'::jsonb else jsonb_build_object('resolvedReport',report_id) end,p_source_url,p_note,p_review_mode);
  return p_work;
end;
$$;

revoke all on function corpus_admin_private.apply_corpus_record_change(uuid,text,text,jsonb,text,text,boolean,text) from public,anon,authenticated,service_role;

-- Preserve the established evidence-backed API and its confirmation requirement.
create or replace function public.admin_save_corpus_record(p_work uuid,p_expected_fingerprint text,p_action text,p_value jsonb,p_source_url text,p_note text,p_confirmed boolean default false)
returns uuid language sql security definer set search_path='' as $$
  select corpus_admin_private.apply_corpus_record_change(p_work,p_expected_fingerprint,p_action,p_value,p_source_url,p_note,p_confirmed,'evidence');
$$;
revoke all on function public.admin_save_corpus_record(uuid,text,text,jsonb,text,text,boolean) from public,anon,authenticated,service_role;
grant execute on function public.admin_save_corpus_record(uuid,text,text,jsonb,text,text,boolean) to authenticated;

-- One transaction: at most one exact edition and one guidance update. The edition runs first
-- so all old/new ISBN advisory locks precede the work lock, as in ordinary intake.
create function public.admin_push_corpus_record(p_work uuid,p_expected_fingerprint text,p_changes jsonb,p_review_mode text,p_source_url text default null,p_note text default null)
returns uuid language plpgsql security definer set search_path='' as $$
declare change jsonb; expected text := p_expected_fingerprint;
begin
  if (select auth.uid()) is null or not public.is_corpus_admin() then
    raise exception 'corpus administrator required' using errcode='42501'; end if;
  if jsonb_typeof(p_changes) is distinct from 'array' then
    raise exception 'Select edition or guidance changes.' using errcode='22023'; end if;
  if jsonb_array_length(p_changes) not between 1 and 2
    or exists(select 1 from jsonb_array_elements(p_changes) c where jsonb_typeof(c) is distinct from 'object'
      or not c ?& array['action','value'] or c-array['action','value']<>'{}'::jsonb
      or c->>'action' is null or c->>'action' not in ('edition','guidance'))
    or (select count(distinct c->>'action') from jsonb_array_elements(p_changes) c)<>jsonb_array_length(p_changes) then
    raise exception 'Select at most one edition and one guidance change.' using errcode='22023'; end if;
  for change in select c from jsonb_array_elements(p_changes) c order by case c->>'action' when 'edition' then 0 else 1 end loop
    perform corpus_admin_private.apply_corpus_record_change(p_work,expected,change->>'action',change->'value',p_source_url,p_note,true,p_review_mode);
    -- This is the transaction's own locked intermediate revision, never a client stale-edit rebase.
    expected := public.corpus_record_fingerprint(p_work);
  end loop;
  return p_work;
end;
$$;
revoke all on function public.admin_push_corpus_record(uuid,text,jsonb,text,text,text) from public,anon,authenticated,service_role;
grant execute on function public.admin_push_corpus_record(uuid,text,jsonb,text,text,text) to authenticated;
commit;
