-- Stage reviewed corpus-shadow differences as administrator suggestions. This migration creates no
-- suggestions by itself and never writes the shared catalog or personal books.
begin;

alter table public.work_series_suggestions
  add column staging_manifest_sha256 text,
  add column staging_packet_sha256 text,
  add column staging_proposal_sha256 text,
  add column staging_expected_series_fingerprint text,
  add column staging_expected_review_revision integer,
  add constraint work_series_suggestions_staging_shape_check check (
    (staging_manifest_sha256 is null
      and staging_packet_sha256 is null
      and staging_proposal_sha256 is null
      and staging_expected_series_fingerprint is null
      and staging_expected_review_revision is null)
    or
    (staging_manifest_sha256 ~ '^[a-f0-9]{64}$'
      and staging_packet_sha256 ~ '^[a-f0-9]{64}$'
      and staging_proposal_sha256 ~ '^[a-f0-9]{64}$'
      and staging_expected_series_fingerprint ~ '^[a-f0-9]{32}$'
      and staging_expected_review_revision >= 0)
  );

create unique index work_series_suggestions_staging_identity_idx
  on public.work_series_suggestions (staging_manifest_sha256, work_id, staging_proposal_sha256)
  where staging_manifest_sha256 is not null;

create function public.admin_stage_corpus_shadow_series_suggestions(
  p_manifest_sha256 text,
  p_packet_sha256 text,
  p_items jsonb
) returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  item jsonb;
  work_row public.works;
  current_memberships jsonb;
  current_pending jsonb;
  current_baseline jsonb;
  current_fingerprint text;
  current_revision integer;
  existing_id uuid;
  suggestion_id uuid;
  proposed_series text;
  proposed_position numeric;
  expected_pending integer;
  staged integer := 0;
  already_present integer := 0;
  superseded integer := 0;
  affected integer := 0;
  staged_ids jsonb := '[]'::jsonb;
begin
  if caller is null then
    raise exception 'authentication required' using errcode = '42501';
  end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  if p_manifest_sha256 !~ '^[a-f0-9]{64}$'
    or p_packet_sha256 !~ '^[a-f0-9]{64}$'
    or jsonb_typeof(p_items) <> 'array'
    or jsonb_array_length(p_items) not between 1 and 25 then
    raise exception 'invalid corpus shadow staging batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if item->>'workId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or item->>'identityFingerprint' !~ '^[a-f0-9]{32}$'
      or item->'proposal'->>'decisionSha256' !~ '^[a-f0-9]{64}$'
      or item->'proposal'->>'role' <> 'primary'
      or nullif(btrim(item->'proposal'->>'series'), '') is null
      or length(item->'proposal'->>'series') > 1000
      or jsonb_typeof(item->'expectedPendingSuggestions') <> 'array'
      or jsonb_typeof(item->'expectedBaseline') <> 'object' then
      raise exception 'invalid corpus shadow staging item' using errcode = '22023';
    end if;
    proposed_series := btrim(item->'proposal'->>'series');
    proposed_position := case when item->'proposal'->'position' = 'null'::jsonb
      then null else (item->'proposal'->>'position')::numeric end;
    if proposed_position is not null and (proposed_position <= 0 or proposed_position > 999999) then
      raise exception 'invalid corpus shadow proposal position' using errcode = '22023';
    end if;

    select suggestion.id into existing_id
    from public.work_series_suggestions suggestion
    where suggestion.staging_manifest_sha256 = p_manifest_sha256
      and suggestion.work_id = (item->>'workId')::uuid
      and suggestion.staging_proposal_sha256 = item->'proposal'->>'decisionSha256'
    order by suggestion.id
    limit 1;
    if existing_id is not null then
      already_present := already_present + 1;
      staged_ids := staged_ids || to_jsonb(existing_id);
      continue;
    end if;

    perform 1 from public.books book
    where book.corpus_work_id = (item->>'workId')::uuid and book.removed_at is null
    order by book.id for update;
    select work.* into work_row from public.works work
    where work.id = (item->>'workId')::uuid for update;
    if not found then raise exception 'corpus work not found' using errcode = 'P0002'; end if;

    current_fingerprint := md5(jsonb_build_object(
      'id',work_row.id,'title',work_row.title,'contributors',work_row.contributors,'pubY',work_row.pub_y
    )::text);
    if current_fingerprint is distinct from item->>'identityFingerprint' then
      raise exception 'corpus shadow identity changed; rebuild before staging' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'series', series_row.name,
      'position', entry.position,
      'role', case when entry.is_primary then 'primary' else 'unknown' end
    ) order by public.corpus_series_identity_key(series_row.name), entry.position nulls last, entry.id), '[]'::jsonb)
    into current_memberships
    from public.corpus_series_entries entry
    join public.corpus_series series_row
      on series_row.id = entry.series_id and series_row.archived_at is null
    where entry.work_id = work_row.id and entry.removed_at is null;
    if jsonb_array_length(current_memberships) = 0 and nullif(btrim(work_row.series), '') is not null then
      current_memberships := jsonb_build_array(jsonb_build_object(
        'series', work_row.series, 'position', work_row.position, 'role', 'primary'
      ));
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'suggestionId', suggestion.id,
      'series', suggestion.proposed_series,
      'position', suggestion.proposed_position,
      'seriesCount', suggestion.proposed_count,
      'source', suggestion.source,
      'confidence', suggestion.confidence
    ) order by suggestion.created_at, suggestion.id), '[]'::jsonb)
    into current_pending
    from public.work_series_suggestions suggestion
    where suggestion.work_id = work_row.id and suggestion.status = 'pending';
    expected_pending := jsonb_array_length(item->'expectedPendingSuggestions');
    current_baseline := jsonb_build_object(
      'currentOrigin', case
        when exists(select 1 from public.corpus_series_entries entry
          join public.corpus_series series_row
            on series_row.id = entry.series_id and series_row.archived_at is null
          where entry.work_id = work_row.id and entry.removed_at is null) then 'graph'
        else 'projection' end,
      'currentMemberships', current_memberships,
      'pendingSuggestionCount', jsonb_array_length(current_pending)
    );
    if current_baseline is distinct from item->'expectedBaseline'
      or current_pending is distinct from item->'expectedPendingSuggestions' then
      raise exception 'corpus shadow baseline changed; rebuild before staging' using errcode = 'P0001';
    end if;

    update public.work_series_suggestions suggestion
       set status = 'superseded', reviewed_by = caller, reviewed_at = now(), updated_at = now()
     where suggestion.work_id = work_row.id and suggestion.status = 'pending';
    get diagnostics affected = row_count;
    superseded := superseded + affected;

    current_fingerprint := public.catalog_series_confirmation_fingerprint(work_row);
    select coalesce(review.revision, 0) into current_revision
    from (select 1) seed
    left join public.corpus_metadata_reviews review on review.work_id = work_row.id;
    insert into public.work_series_suggestions(
      work_id, proposed_series, proposed_position, source, source_ref, confidence,
      checked_at, identity_confidence, evidence, reason,
      staging_manifest_sha256, staging_packet_sha256, staging_proposal_sha256,
      staging_expected_series_fingerprint, staging_expected_review_revision
    ) values (
      work_row.id, proposed_series, proposed_position, 'corpus_shadow_authority_review',
      'sha256:' || (item->'proposal'->>'decisionSha256'), 'high', now(), 'high',
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'source','corpus_shadow_authority_review','kind','relational_membership',
        'sourceRef','sha256:' || (item->'proposal'->>'decisionSha256'),
        'series',proposed_series,'position',proposed_position,'orderType','unspecified'
      ))),
      'Truth-blind full-corpus rebuild proposal. Review the private hash-bound authority artifact before accepting.',
      p_manifest_sha256, p_packet_sha256, item->'proposal'->>'decisionSha256',
      current_fingerprint, current_revision
    ) returning id into suggestion_id;
    staged := staged + 1;
    staged_ids := staged_ids || to_jsonb(suggestion_id);
  end loop;

  return jsonb_build_object(
    'staged', staged,
    'alreadyPresent', already_present,
    'superseded', superseded,
    'suggestionIds', staged_ids
  );
end;
$$;

revoke all on function public.admin_stage_corpus_shadow_series_suggestions(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_stage_corpus_shadow_series_suggestions(text,text,jsonb)
  to authenticated;

create function public.review_corpus_series_suggestion_revisioned(
  p_suggestion uuid,
  p_decision text
) returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  suggestion public.work_series_suggestions%rowtype;
  work_row public.works;
  current_revision integer;
begin
  if caller is null then raise exception 'corpus administrator required' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then raise exception 'corpus administrator required' using errcode = '42501'; end if;

  select row.* into suggestion from public.work_series_suggestions row
  where row.id = p_suggestion for update;
  if not found then raise exception 'series suggestion not found' using errcode = 'P0002'; end if;
  if suggestion.staging_manifest_sha256 is not null then
    perform 1 from public.books book
    where book.corpus_work_id = suggestion.work_id and book.removed_at is null
    order by book.id for update;
    select work.* into work_row from public.works work
    where work.id = suggestion.work_id for update;
    select coalesce(review.revision, 0) into current_revision
    from (select 1) seed
    left join public.corpus_metadata_reviews review on review.work_id = suggestion.work_id;
    if public.catalog_series_confirmation_fingerprint(work_row)
        is distinct from suggestion.staging_expected_series_fingerprint
      or current_revision is distinct from suggestion.staging_expected_review_revision then
      raise exception 'This catalog series or review changed. Refresh before reviewing the suggestion.'
        using errcode = 'P0001';
    end if;
  end if;
  return public.review_corpus_series_suggestion(p_suggestion, p_decision);
end;
$$;

revoke all on function public.review_corpus_series_suggestion(uuid,text)
  from public, anon, authenticated, service_role;
revoke all on function public.review_corpus_series_suggestion_revisioned(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_corpus_series_suggestion_revisioned(uuid,text)
  to authenticated;

commit;
