-- Manual, edition-bound page/date corrections. No backfill or personal-copy writer.
begin;

-- Replacing this event constraint admits a new audited action; no history is removed.
alter table public.corpus_metadata_review_events drop constraint corpus_metadata_review_events_action_check;
alter table public.corpus_metadata_review_events add constraint corpus_metadata_review_events_action_check
  check (action in ('description','reviewed','defer','reopen','edition_details'));

create or replace function public.catalog_metadata_review_record(p_work public.works)
returns jsonb language sql stable security definer set search_path = '' as $$
  with related as (
    select w.id, w.title, coalesce(w.author_text,'') as author, w.isbns,
      w.description, w.pub_y, w.publisher, w.language,
      public.catalog_review_isbns(w.isbns) && public.catalog_review_isbns(p_work.isbns) as isbn_match,
      (nullif(trim(p_work.title),'') is not null and nullif(trim(p_work.author_text),'') is not null
        and public.library_work_key(w.title,w.author_text) = public.library_work_key(p_work.title,p_work.author_text)) as identity_match
    from public.works w where w.id <> p_work.id and (
      public.catalog_review_isbns(w.isbns) && public.catalog_review_isbns(p_work.isbns)
      or (nullif(trim(p_work.title),'') is not null and nullif(trim(p_work.author_text),'') is not null
        and public.library_work_key(w.title,w.author_text) = public.library_work_key(p_work.title,p_work.author_text))
    )
  ), evidence as (
    select coalesce(jsonb_agg(to_jsonb(r) order by r.id),'[]') as peers,
      coalesce(bool_or(isbn_match),false) as conflict,
      coalesce(bool_or(identity_match),false) as duplicate from related r
  )
  select jsonb_build_object(
    'id', p_work.id, 'title', p_work.title, 'author', coalesce(p_work.author_text,''),
    'contributors', p_work.contributors, 'isbns', p_work.isbns, 'description', coalesce(p_work.description,''),
    'descriptionSource', p_work.metadata_provenance->'description'->>'sourceRef',
    'cover', p_work.cover_url, 'year', p_work.pub_y, 'publisher', p_work.publisher, 'language', p_work.language,
    'editionCorrectionVersion', 1, 'pages', p_work.pages,
    'publication', jsonb_build_object('y',p_work.pub_y,'m',p_work.pub_m,'d',p_work.pub_d),
    'editionProvenance', jsonb_build_object('pages',p_work.metadata_provenance->'pageCount',
      'pubY',p_work.metadata_provenance->'pubY','pubM',p_work.metadata_provenance->'pubM','pubD',p_work.metadata_provenance->'pubD'),
    'issues', to_jsonb(array_remove(array[
      case when conflict then 'isbn_conflict' end,
      case when duplicate then 'duplicate_identity' end,
      case when exists(select 1 from unnest(p_work.isbns) i where not public.library_isbn_checksum_is_valid(i)) then 'invalid_isbn' end,
      case when nullif(btrim(p_work.description, E' \t\r\n'),'') is null then 'description' end
    ],null)),
    'related', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from related order by id limit 10) r),'[]'),
    'relatedTotal', (select count(*) from related),
    'fingerprint', md5(jsonb_build_array('edition-review-v1',p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance,p_work.pages,p_work.pub_y,p_work.pub_m,p_work.pub_d,
      p_work.publisher,p_work.language,peers)::text)
  ) from evidence;
$$;
revoke all on function public.catalog_metadata_review_record(public.works) from public, anon, authenticated, service_role;

create function public.admin_correct_corpus_edition_details(
  p_work uuid, p_expected_fingerprint text, p_expected_revision integer,
  p_isbn text, p_evidence_title text, p_evidence_author text,
  p_field text, p_value jsonb, p_source_url text, p_note text,
  p_identity_confirmed boolean default false
) returns uuid language plpgsql security definer set search_path = '' as $$
declare
  caller uuid := (select auth.uid());
  work_row public.works;
  previous_review public.corpus_metadata_reviews;
  saved_review public.corpus_metadata_reviews;
  before_record jsonb;
  after_record jsonb;
  reference_isbn text;
  provenance jsonb;
  preserve_catalog_before text := current_setting('reverie.series_review_preserve_catalog', true);
  y integer; m integer; d integer; v_pages integer;
begin
  if caller is null then raise exception 'authentication required' using errcode='42501'; end if;
  perform 1 from public.profiles where id=caller for key share;
  perform 1 from public.corpus_admins where user_id=caller for update;
  if not found then raise exception 'corpus administrator required' using errcode='42501'; end if;
  if p_identity_confirmed is distinct from true
    or p_note is null or length(p_note)>1200 or nullif(btrim(p_note),'') is null
    or p_source_url is null or length(p_source_url)>2000
    or p_source_url !~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'
    or p_evidence_title is null or length(p_evidence_title)>1000 or nullif(btrim(p_evidence_title),'') is null
    or p_evidence_author is null or length(p_evidence_author)>2000 or nullif(btrim(p_evidence_author),'') is null
    or p_isbn is null or length(p_isbn)>32 or not public.library_isbn_checksum_is_valid(p_isbn)
    or p_field is null or p_field not in ('pages','publication') then
    raise exception 'Confirm the exact edition identity, source link and explanation.' using errcode='22023';
  end if;
  reference_isbn := public.canonical_library_isbn(p_isbn);
  -- Same ISBN fence as catalog assignment, before the work lock; cannot race a new claim.
  perform public.lock_library_isbns(array[reference_isbn]);
  select * into work_row from public.works where id=p_work for update;
  if not found then raise exception 'corpus work not found' using errcode='P0002'; end if;
  before_record := public.catalog_metadata_review_record(work_row);
  select * into previous_review from public.corpus_metadata_reviews where work_id=p_work for update;
  if p_expected_fingerprint is distinct from before_record->>'fingerprint'
    or p_expected_revision is distinct from coalesce(previous_review.revision,0) then
    raise exception 'This catalog record or review changed. Refresh before deciding.' using errcode='P0001';
  end if;
  if not reference_isbn=any(public.catalog_review_isbns(work_row.isbns))
    or nullif(btrim(work_row.author_text),'') is null
    or public.library_work_key(p_evidence_title,p_evidence_author)
      is distinct from public.library_work_key(work_row.title,work_row.author_text)
    or exists(select 1 from public.works w where w.id<>p_work
      and reference_isbn=any(public.catalog_review_isbns(w.isbns))) then
    raise exception 'Resolve the title, full contributor identity and ISBN conflict before correcting edition details.' using errcode='22023';
  end if;
  -- A matching display string must not hide an omitted coauthor/editor/translator. This narrow
  -- action does not reconcile roles or reorder names: inconsistent contributor records defer.
  if jsonb_typeof(work_row.contributors) is distinct from 'array' then
    raise exception 'Resolve the recorded contributor identity before correcting edition details.' using errcode='22023';
  end if;
  if jsonb_array_length(work_row.contributors)>0 and (
    exists(select 1 from jsonb_array_elements(work_row.contributors) c
      where jsonb_typeof(c->'name') is distinct from 'string' or nullif(btrim(c->>'name'),'') is null)
    or public.library_work_key('',p_evidence_author) is distinct from
      (select public.library_work_key('',string_agg(c->>'name',' ' order by ord))
        from jsonb_array_elements(work_row.contributors) with ordinality as contributor(c,ord))
  ) then
    raise exception 'Resolve the recorded contributor identity before correcting edition details.' using errcode='22023';
  end if;
  if jsonb_typeof(p_value) is distinct from 'object' then
    raise exception 'Choose one valid page count or whole publication date.' using errcode='22023';
  end if;
  provenance := jsonb_build_object('source','manual','sourceRef',p_source_url,
    'referenceIsbn',reference_isbn,'observedAt',now());
  if p_field='pages' then
    if not p_value ? 'pages' or (p_value-'pages')<>'{}'::jsonb
      or jsonb_typeof(p_value->'pages') is distinct from 'number'
      or (p_value->>'pages') !~ '^[0-9]{1,5}$' then
      raise exception 'Pages must be a whole number from 1 to 20000.' using errcode='22023';
    end if;
    v_pages := (p_value->>'pages')::integer;
    if v_pages not between 1 and 20000 then
      raise exception 'Pages must be a whole number from 1 to 20000.' using errcode='22023';
    end if;
    -- Reuse the existing transaction-local graph-preservation guard. The metadata trigger
    -- sees the update but cannot rewrite shared relationships for unrelated page provenance.
    perform set_config('reverie.series_review_preserve_catalog','on',true);
    update public.works set pages=v_pages,
      metadata_provenance=coalesce(metadata_provenance,'{}') || jsonb_build_object('pageCount',provenance)
      where id=p_work returning * into work_row;
  else
    if not p_value ?& array['y','m','d'] or (p_value-array['y','m','d'])<>'{}'::jsonb
      or jsonb_typeof(p_value->'y') is distinct from 'number'
      or (p_value->>'y') !~ '^[0-9]{1,4}$'
      or exists(select 1 from jsonb_each(p_value) v where v.key in ('m','d')
        and v.value<>'null'::jsonb and (jsonb_typeof(v.value)<>'number' or v.value::text !~ '^[0-9]{1,2}$')) then
      raise exception 'Use a valid year, year-month or whole date; clearing is not supported.' using errcode='22023';
    end if;
    y := (p_value->>'y')::integer; m := (p_value->>'m')::integer; d := (p_value->>'d')::integer;
    if not public.publication_tuple_is_valid(y,m,d) then
      raise exception 'Use a valid year, year-month or whole date; clearing is not supported.' using errcode='22023';
    end if;
    -- Remove obsolete precision provenance along with obsolete month/day. Other fields survive.
    perform set_config('reverie.series_review_preserve_catalog','on',true);
    update public.works set pub_y=y,pub_m=m,pub_d=d,
      metadata_provenance=(coalesce(metadata_provenance,'{}')-array['pubY','pubM','pubD'])
        || jsonb_build_object('pubY',provenance)
        || case when m is null then '{}'::jsonb else jsonb_build_object('pubM',provenance) end
        || case when d is null then '{}'::jsonb else jsonb_build_object('pubD',provenance) end
      where id=p_work returning * into work_row;
  end if;
  perform set_config('reverie.series_review_preserve_catalog',coalesce(preserve_catalog_before,''),true);
  after_record := public.catalog_metadata_review_record(work_row);
  insert into public.work_metadata_edits(work_id,editor_id,previous_value,next_value)
    values(p_work,caller,
      jsonb_build_object('field',p_field,'value',before_record->p_field,'provenance',before_record->'editionProvenance'),
      jsonb_build_object('field',p_field,'value',after_record->p_field,'referenceIsbn',reference_isbn,'sourceUrl',p_source_url));
  insert into public.corpus_metadata_reviews(work_id,fingerprint,revision,state,note,source_url,reviewed_by)
    values(p_work,after_record->>'fingerprint',coalesce(previous_review.revision,0)+1,'open',trim(p_note),p_source_url,caller)
    on conflict(work_id) do update set fingerprint=excluded.fingerprint,revision=excluded.revision,state='open',
      note=excluded.note,source_url=excluded.source_url,reviewed_by=excluded.reviewed_by,reviewed_at=now()
    returning * into saved_review;
  insert into public.corpus_metadata_review_events(work_id,action,previous_value,next_value,editor_id)
    values(p_work,'edition_details',jsonb_build_object('record',before_record,'review',to_jsonb(previous_review)),
      jsonb_build_object('record',after_record,'review',to_jsonb(saved_review),'field',p_field,
        'referenceIsbn',reference_isbn,'evidenceTitle',p_evidence_title,'evidenceAuthor',p_evidence_author,
        'identityConfirmed',p_identity_confirmed),caller);
  return p_work;
end;
$$;
revoke all on function public.admin_correct_corpus_edition_details(uuid,text,integer,text,text,text,text,jsonb,text,text,boolean)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_correct_corpus_edition_details(uuid,text,integer,text,text,text,text,jsonb,text,text,boolean)
  to authenticated;
commit;
