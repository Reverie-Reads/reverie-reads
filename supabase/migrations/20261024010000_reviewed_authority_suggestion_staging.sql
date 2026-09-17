-- Hand independently reviewed post-recovery authority findings to the existing administrator
-- suggestion queue. Staging never changes the shared catalog or personal books. It may replace
-- only the exact pending corpus-shadow removal review frozen into the packet; ordinary pending
-- suggestions remain authoritative and block staging.
begin;

create function public.admin_stage_reviewed_authority_series_suggestions(
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
  work_row public.works%rowtype;
  current_pending jsonb;
  expected_pending jsonb;
  current_revision integer;
  existing_id uuid;
  suggestion_id uuid;
  proposed_series text;
  proposed_position numeric;
  source_url text;
  review_note text;
  affected integer := 0;
  staged integer := 0;
  already_present integer := 0;
  superseded integer := 0;
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
    raise exception 'invalid reviewed authority staging batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if item->>'workId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or item->>'identityFingerprint' !~ '^[a-f0-9]{32}$'
      or item->>'expectedSeriesFingerprint' !~ '^[a-f0-9]{32}$'
      or jsonb_typeof(item->'expectedReviewRevision') is distinct from 'number'
      or (item->>'expectedReviewRevision')::integer < 0
      or item->'proposal'->>'decisionSha256' !~ '^[a-f0-9]{64}$'
      or item->'proposal'->>'role' <> 'primary'
      or nullif(btrim(item->'proposal'->>'series'), '') is null
      or length(item->'proposal'->>'series') > 1000
      or coalesce(nullif(btrim(item->'proposal'->>'sourceUrl'), ''), '') !~ '^https://[^[:space:]]+$'
      or length(item->'proposal'->>'sourceUrl') > 2000
      or length(btrim(coalesce(item->'proposal'->>'note', ''))) not between 8 and 2000
      or not (item ? 'expectedPendingSuggestion') then
      raise exception 'invalid reviewed authority staging item' using errcode = '22023';
    end if;

    proposed_series := btrim(item->'proposal'->>'series');
    proposed_position := case
      when item->'proposal'->'position' = 'null'::jsonb then null
      else (item->'proposal'->>'position')::numeric
    end;
    if proposed_position is not null and (proposed_position <= 0 or proposed_position > 999999) then
      raise exception 'invalid reviewed authority proposal position' using errcode = '22023';
    end if;
    source_url := btrim(item->'proposal'->>'sourceUrl');
    review_note := btrim(item->'proposal'->>'note');
    expected_pending := item->'expectedPendingSuggestion';
    if expected_pending <> 'null'::jsonb and (
      jsonb_typeof(expected_pending) <> 'object'
      or expected_pending->>'id' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or expected_pending->>'proposalAction' <> 'remove'
      or expected_pending->>'source' <> 'corpus_shadow_authority_removal_review'
    ) then
      raise exception 'only an exact corpus shadow removal review may be superseded'
        using errcode = '22023';
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

    if md5(jsonb_build_object(
      'id',work_row.id,'title',work_row.title,'contributors',work_row.contributors,'pubY',work_row.pub_y
    )::text) is distinct from item->>'identityFingerprint' then
      raise exception 'reviewed authority identity changed; rebuild before staging'
        using errcode = 'P0001';
    end if;
    if public.catalog_series_positive_suggestion_fingerprint(work_row)
        is distinct from item->>'expectedSeriesFingerprint' then
      raise exception 'reviewed authority series changed; rebuild before staging'
        using errcode = 'P0001';
    end if;
    select coalesce(review.revision, 0) into current_revision
    from (select 1) seed
    left join public.corpus_metadata_reviews review on review.work_id = work_row.id;
    if current_revision is distinct from (item->>'expectedReviewRevision')::integer then
      raise exception 'reviewed authority review changed; rebuild before staging'
        using errcode = 'P0001';
    end if;

    select case when suggestion.id is null then 'null'::jsonb else jsonb_build_object(
      'id', suggestion.id,
      'proposalAction', suggestion.proposal_action,
      'series', suggestion.proposed_series,
      'position', suggestion.proposed_position,
      'source', suggestion.source,
      'stagingManifestSha256', suggestion.staging_manifest_sha256,
      'stagingProposalSha256', suggestion.staging_proposal_sha256
    ) end into current_pending
    from (select 1) seed
    left join public.work_series_suggestions suggestion
      on suggestion.work_id = work_row.id and suggestion.status = 'pending';
    if current_pending is distinct from expected_pending then
      raise exception 'reviewed authority pending suggestion changed; rebuild before staging'
        using errcode = 'P0001';
    end if;

    if expected_pending <> 'null'::jsonb then
      update public.work_series_suggestions suggestion
         set status = 'superseded', reviewed_by = caller, reviewed_at = now(), updated_at = now()
       where suggestion.id = (expected_pending->>'id')::uuid
         and suggestion.work_id = work_row.id
         and suggestion.status = 'pending'
         and suggestion.proposal_action = 'remove'
         and suggestion.source = 'corpus_shadow_authority_removal_review';
      get diagnostics affected = row_count;
      if affected <> 1 then
        raise exception 'reviewed authority removal review changed; rebuild before staging'
          using errcode = 'P0001';
      end if;
      superseded := superseded + 1;
    end if;

    insert into public.work_series_suggestions(
      work_id, proposed_series, proposed_position, source, source_ref, confidence,
      checked_at, identity_confidence, evidence, reason, proposal_action,
      staging_manifest_sha256, staging_packet_sha256, staging_proposal_sha256,
      staging_expected_series_fingerprint, staging_expected_review_revision
    ) values (
      work_row.id, proposed_series, proposed_position, 'post_recovery_authority_review',
      source_url, 'high', now(), 'high',
      jsonb_build_array(jsonb_strip_nulls(jsonb_build_object(
        'source','post_recovery_authority_review','kind','relational_membership',
        'sourceRef',source_url,'series',proposed_series,'position',proposed_position,
        'orderType','publication'
      ))),
      review_note, 'set', p_manifest_sha256, p_packet_sha256,
      item->'proposal'->>'decisionSha256', item->>'expectedSeriesFingerprint',
      (item->>'expectedReviewRevision')::integer
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

revoke all on function public.admin_stage_reviewed_authority_series_suggestions(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_stage_reviewed_authority_series_suggestions(text,text,jsonb)
  to authenticated;

commit;
