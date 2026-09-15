-- Administrator confirmation of an existing shared series tuple with independently checked evidence.
-- No backfill, provider fetch, candidate import, or direct personal-row writer.
begin;

alter table public.corpus_metadata_review_events
  drop constraint corpus_metadata_review_events_action_check;
alter table public.corpus_metadata_review_events
  add constraint corpus_metadata_review_events_action_check
  check (action in (
    'description','reviewed','defer','reopen','edition_details','series_confirmation'
  ));

-- The series confirmation has its own stale-data boundary. It includes the exact work claim and
-- active primary graph anchor without changing the older assessment or edition fingerprints.
create function public.catalog_series_confirmation_fingerprint(p_work public.works)
returns text
language sql
stable
security definer
set search_path = ''
as $$
  select md5(jsonb_build_array(
    'series-confirmation-v1',
    p_work.title,
    p_work.author_text,
    p_work.contributors,
    p_work.series,
    p_work.position,
    p_work.series_count,
    p_work.series_check_state,
    p_work.series_checked_at,
    p_work.series_check_source,
    p_work.series_check_evidence,
    p_work.series_check_reason,
    p_work.metadata_provenance -> 'series',
    (
      select jsonb_build_object(
        'entryId', entry.id,
        'seriesId', series_row.id,
        'seriesName', series_row.name,
        'seriesRevision', series_row.revision,
        'seriesState', series_row.catalog_state,
        'declaredCount', series_row.declared_count,
        'position', entry.position,
        'membershipClaim', entry.membership_claim,
        'positionClaim', entry.position_claim,
        'source', entry.source,
        'sourceRef', entry.source_ref,
        'evidence', entry.evidence
      )
      from public.corpus_series_entries entry
      join public.corpus_series series_row
        on series_row.id = entry.series_id and series_row.archived_at is null
      where entry.work_id = p_work.id
        and entry.removed_at is null
        and entry.is_primary
      order by entry.id
      limit 1
    )
  )::text);
$$;

revoke all on function public.catalog_series_confirmation_fingerprint(public.works)
  from public, anon, authenticated, service_role;

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
    'seriesConfirmationVersion', 1,
    'series', p_work.series, 'position', p_work.position, 'seriesCount', p_work.series_count,
    'seriesCheckState', p_work.series_check_state, 'seriesCheckedAt', p_work.series_checked_at,
    'seriesSourceUrl', case
      when p_work.metadata_provenance->'series'->>'sourceRef' ~ '^https://[^[:space:]]+$'
      then p_work.metadata_provenance->'series'->>'sourceRef' else null end,
    'seriesFingerprint', public.catalog_series_confirmation_fingerprint(p_work),
    'editionCorrectionVersion', 1, 'pages', p_work.pages,
    'publication', jsonb_build_object('y',p_work.pub_y,'m',p_work.pub_m,'d',p_work.pub_d),
    'editionProvenance', jsonb_build_object('pages',p_work.metadata_provenance->'pageCount',
      'pubY',p_work.metadata_provenance->'pubY','pubM',p_work.metadata_provenance->'pubM','pubD',p_work.metadata_provenance->'pubD'),
    'issues', to_jsonb(array_remove(array[
      case when conflict then 'isbn_conflict' end,
      case when duplicate then 'duplicate_identity' end,
      case when exists(select 1 from unnest(p_work.isbns) i where not public.library_isbn_checksum_is_valid(i)) then 'invalid_isbn' end,
      case when (p_work.pub_y is not null or p_work.pub_m is not null or p_work.pub_d is not null)
        and not public.publication_tuple_is_valid(p_work.pub_y,p_work.pub_m,p_work.pub_d)
        then 'invalid_publication' end,
      case when nullif(btrim(p_work.description, E' \t\r\n'),'') is null then 'description' end
    ],null)),
    'related', coalesce((select jsonb_agg(to_jsonb(r) order by r.id) from (select * from related order by id limit 10) r),'[]'),
    'relatedTotal', (select count(*) from related),
    -- Preserve legacy assessment fingerprints exactly. Valid/unknown publication tuples keep the
    -- pre-invalid-date value; only invalid tuples append their established discriminator.
    'fingerprint', md5((jsonb_build_array(p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance->'description',p_work.pub_y,p_work.publisher,p_work.language,peers)
      || case when (p_work.pub_y is not null or p_work.pub_m is not null or p_work.pub_d is not null)
        and not public.publication_tuple_is_valid(p_work.pub_y,p_work.pub_m,p_work.pub_d)
        then jsonb_build_array('invalid-publication-v1',p_work.pub_y,p_work.pub_m,p_work.pub_d)
        else '[]'::jsonb end)::text),
    'editionFingerprint', md5(jsonb_build_array('edition-review-v1',p_work.title,p_work.author_text,p_work.contributors,p_work.isbns,
      p_work.description,p_work.metadata_provenance,p_work.pages,p_work.pub_y,p_work.pub_m,p_work.pub_d,
      p_work.publisher,p_work.language,peers)::text)
  ) from evidence;
$$;

-- Same signature and restricted grant as before; spell the ACL out after replacement.
revoke all on function public.catalog_metadata_review_record(public.works)
  from public, anon, authenticated, service_role;

create function public.admin_confirm_corpus_series_membership(
  p_work uuid,
  p_expected_fingerprint text,
  p_expected_revision integer,
  p_series text,
  p_position numeric,
  p_series_count integer,
  p_source_url text,
  p_note text,
  p_identity_confirmed boolean default false
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  work_row public.works;
  previous_review public.corpus_metadata_reviews;
  saved_review public.corpus_metadata_reviews;
  before_record jsonb;
  after_record jsonb;
  before_work jsonb;
  after_work jsonb;
  evidence jsonb;
  observed_at timestamptz := now();
  classifier_before text := current_setting('reverie.series_classifier', true);
  catalog_target_before text := current_setting('reverie.corpus_series_target', true);
  preserve_catalog_before text := current_setting('reverie.series_review_preserve_catalog', true);
  primary_series uuid;
  primary_series_name text;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;

  if p_identity_confirmed is distinct from true
    or p_note is null or length(p_note) > 1200 or nullif(btrim(p_note, E' \t\r\n'), '') is null
    or p_source_url is null or length(p_source_url) > 2000
    or p_source_url !~ '^https://[^[:space:]/?#@]+([/?#][^[:space:]]*)?$'
    or p_series is null or length(p_series) > 1000 or nullif(btrim(p_series), '') is null
    or p_position is not null and (p_position <= 0 or p_position > 999999)
    or p_series_count is not null and p_series_count not between 1 and 999 then
    raise exception 'Confirm the exact series tuple, HTTPS source link and explanation.'
      using errcode = '22023';
  end if;

  -- Series suggestion review takes this row before personal books. Refuse rather than silently
  -- superseding a pending proposal with a different review workflow.
  perform 1
  from public.work_series_suggestions suggestion
  where suggestion.work_id = p_work and suggestion.status = 'pending'
  for update;
  if found then
    raise exception 'Resolve the pending series suggestion before confirming this tuple.'
      using errcode = 'P0001';
  end if;

  -- Match the established personal-write lock order before the work update invokes default-only
  -- reconciliation. No personal row is mutated directly by this RPC.
  perform 1
  from public.books book
  where book.corpus_work_id = p_work and book.removed_at is null
  order by book.id
  for update;

  select w.* into work_row
  from public.works w
  where w.id = p_work
  for update;
  if not found then
    raise exception 'corpus work not found' using errcode = 'P0002';
  end if;

  -- Pin the graph state represented by the series fingerprint. The work -> series -> entry order
  -- matches the existing graph writers.
  select series_row.id, series_row.name
  into primary_series, primary_series_name
  from public.corpus_series_entries entry
  join public.corpus_series series_row on series_row.id = entry.series_id
  where entry.work_id = p_work and entry.removed_at is null and entry.is_primary
  order by series_row.id, entry.id
  limit 1
  for update of series_row, entry;

  before_record := public.catalog_metadata_review_record(work_row);
  before_work := to_jsonb(work_row);
  select * into previous_review
  from public.corpus_metadata_reviews
  where work_id = p_work
  for update;

  if p_expected_fingerprint is distinct from before_record->>'seriesFingerprint'
    or p_expected_revision is distinct from coalesce(previous_review.revision, 0) then
    raise exception 'This catalog series or review changed. Refresh before confirming.'
      using errcode = 'P0001';
  end if;
  if btrim(p_series) is distinct from btrim(work_row.series)
    or p_position is distinct from work_row.position
    or p_series_count is distinct from work_row.series_count then
    raise exception 'This action confirms only the exact displayed series tuple. Refresh before confirming.'
      using errcode = '22023';
  end if;

  evidence := jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
    'source', 'manual',
    'kind', 'relational_membership',
    'sourceRef', btrim(p_source_url),
    'series', btrim(work_row.series),
    'position', work_row.position,
    'memberCount', work_row.series_count,
    'orderType', 'unspecified',
    'reviewedBy', caller,
    'at', observed_at
  )));

  -- Naming the tuple columns is intentional. The classifier marker makes an unchanged confirmed
  -- tuple a reconciliation event for eligible defaults; reader and CSV-import choices remain
  -- protected by seed_personal_series_from_corpus(). The normal graph trigger records the source.
  perform set_config('reverie.series_classifier', 'on', true);
  perform set_config('reverie.series_review_preserve_catalog', '', true);
  -- Keep a matching reviewed graph identity stable if duplicate names exist. A mismatched anchor is
  -- not pinned: the existing graph synchronizer must resolve or replace it from the confirmed tuple.
  perform set_config('reverie.corpus_series_target', case
    when primary_series is not null
      and public.corpus_series_identity_key(primary_series_name)
        = public.corpus_series_identity_key(work_row.series)
    then primary_series::text else '' end, true);
  update public.works
     set series = series,
         position = position,
         series_count = series_count,
         series_check_state = 'found',
         series_checked_at = observed_at,
         series_check_source = 'manual',
         series_check_evidence = evidence,
         series_check_reason = 'A corpus administrator confirmed the existing series tuple from an independently checked source.',
         metadata_provenance = coalesce(metadata_provenance, '{}'::jsonb)
           || jsonb_build_object('series', jsonb_strip_nulls(jsonb_build_object(
             'source', 'manual',
             'sourceRef', btrim(p_source_url),
             'identityConfidence', 'high',
             'membershipConfidence', 'high',
             'confidence', 'high',
             'reviewedBy', caller,
             'at', observed_at,
             'evidence', evidence
           )))
   where id = p_work
   returning * into work_row;
  perform set_config('reverie.series_classifier', coalesce(classifier_before, ''), true);
  perform set_config('reverie.corpus_series_target', coalesce(catalog_target_before, ''), true);
  perform set_config('reverie.series_review_preserve_catalog', coalesce(preserve_catalog_before, ''), true);

  after_work := to_jsonb(work_row);
  after_record := public.catalog_metadata_review_record(work_row);
  insert into public.work_metadata_edits(work_id, editor_id, previous_value, next_value)
  values (p_work, caller, before_work, after_work);

  if previous_review.work_id is null then
    insert into public.corpus_metadata_reviews(
      work_id, fingerprint, revision, state, note, source_url, reviewed_by
    ) values (
      p_work, after_record->>'fingerprint', 1, 'open', '', '', null
    ) returning * into saved_review;
  else
    update public.corpus_metadata_reviews
       set fingerprint = after_record->>'fingerprint',
           revision = previous_review.revision + 1
     where work_id = p_work
     returning * into saved_review;
  end if;

  insert into public.corpus_metadata_review_events(
    work_id, action, previous_value, next_value, editor_id
  ) values (
    p_work,
    'series_confirmation',
    jsonb_build_object('record', before_record, 'review', to_jsonb(previous_review)),
    jsonb_build_object(
      'record', after_record,
      'review', to_jsonb(saved_review),
      'seriesConfirmation', jsonb_build_object(
        'series', work_row.series,
        'position', work_row.position,
        'seriesCount', work_row.series_count,
        'sourceUrl', btrim(p_source_url),
        'note', btrim(p_note, E' \t\r\n'),
        'identityConfirmed', p_identity_confirmed,
        'reviewedBy', caller,
        'observedAt', observed_at
      )
    ),
    caller
  );
  return p_work;
end;
$$;

revoke all on function public.admin_confirm_corpus_series_membership(
  uuid, text, integer, text, numeric, integer, text, text, boolean
) from public, anon, authenticated, service_role;
grant execute on function public.admin_confirm_corpus_series_membership(
  uuid, text, integer, text, numeric, integer, text, text, boolean
) to authenticated;

commit;
