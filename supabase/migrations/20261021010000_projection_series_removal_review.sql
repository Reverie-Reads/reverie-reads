-- Historical scalar series labels can predate the canonical graph. Admit those projection-only
-- labels to the same explicit administrator removal-review queue without manufacturing a graph
-- membership during staging. Acceptance remains revision/fingerprint bound and preserves reader
-- and import choices through the existing corpus-default propagation guard.
begin;

alter table public.work_series_suggestions
  add column staging_removal_origin text
    check (staging_removal_origin in ('graph', 'projection'));

alter table public.work_series_suggestions
  drop constraint work_series_suggestions_removal_review_shape_check,
  add constraint work_series_suggestions_removal_review_shape_check check (
    (proposal_action = 'set'
      and staging_removal_origin is null
      and staging_expected_series_entry is null
      and staging_expected_series_revision is null)
    or
    (proposal_action = 'remove'
      and staging_manifest_sha256 is not null
      and (
        (coalesce(staging_removal_origin, 'graph') = 'graph'
          and staging_expected_series_entry is not null
          and staging_expected_series_revision is not null)
        or
        (staging_removal_origin = 'projection'
          and staging_expected_series_entry is null
          and staging_expected_series_revision is null)
      ))
  );

create function public.admin_stage_corpus_shadow_projection_series_removal_reviews(
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
  expected_position numeric;
  existing_id uuid;
  suggestion_id uuid;
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
    raise exception 'invalid corpus shadow projection removal-review batch' using errcode = '22023';
  end if;

  for item in select value from jsonb_array_elements(p_items)
  loop
    if item->>'workId' !~ '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
      or item->>'identityFingerprint' !~ '^[a-f0-9]{32}$'
      or coalesce(item->>'action', '') not in ('review_historical_authority', 'review_standalone_conflict')
      or coalesce(item->'proposal'->>'action', '') <> 'remove'
      or item->'proposal'->>'decisionSha256' !~ '^[a-f0-9]{64}$'
      or item->'proposal'->>'role' <> 'primary'
      or nullif(btrim(item->'proposal'->>'series'), '') is null
      or jsonb_typeof(item->'expectedPendingSuggestions') <> 'array'
      or jsonb_typeof(item->'expectedBaseline') <> 'object'
      or item->'expectedBaseline'->>'currentOrigin' <> 'projection' then
      raise exception 'invalid corpus shadow projection removal-review item' using errcode = '22023';
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

    expected_position := case
      when item->'proposal'->'position' = 'null'::jsonb then null
      else (item->'proposal'->>'position')::numeric
    end;
    if exists (
      select 1 from public.corpus_series_entries entry
      where entry.work_id = work_row.id and entry.removed_at is null
    )
      or nullif(btrim(work_row.series), '') is distinct from btrim(item->'proposal'->>'series')
      or work_row.position is distinct from expected_position then
      raise exception 'corpus shadow series changed; rebuild before staging' using errcode = 'P0001';
    end if;

    current_memberships := jsonb_build_array(jsonb_build_object(
      'series', work_row.series,
      'position', work_row.position,
      'role', 'primary'
    ));
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
    current_baseline := jsonb_build_object(
      'currentOrigin', 'projection',
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
      checked_at, identity_confidence, evidence, reason, proposal_action,
      staging_manifest_sha256, staging_packet_sha256, staging_proposal_sha256,
      staging_expected_series_fingerprint, staging_expected_review_revision,
      staging_removal_origin, staging_expected_series_entry, staging_expected_series_revision
    ) values (
      work_row.id, btrim(work_row.series), work_row.position,
      'corpus_shadow_authority_removal_review',
      'sha256:' || (item->'proposal'->>'decisionSha256'), 'medium', now(), 'high', '[]'::jsonb,
      case item->>'action'
        when 'review_standalone_conflict' then
          'The truth-blind authority review found an affirmative standalone conflict. Confirm before removing the historical shared series.'
        else
          'The completed truth-blind authority review could not safely verify this historical shared series. Keep or remove it explicitly.'
      end,
      'remove', p_manifest_sha256, p_packet_sha256,
      item->'proposal'->>'decisionSha256', current_fingerprint, current_revision,
      'projection', null, null
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

revoke all on function public.admin_stage_corpus_shadow_projection_series_removal_reviews(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_stage_corpus_shadow_projection_series_removal_reviews(text,text,jsonb)
  to authenticated;

create or replace function public.review_corpus_series_suggestion_revisioned(
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
  after_value jsonb;
  current_revision integer;
  classifier_before text := current_setting('reverie.series_classifier', true);
begin
  if caller is null then raise exception 'corpus administrator required' using errcode = '42501'; end if;
  perform 1 from public.profiles where id = caller for key share;
  perform 1 from public.corpus_admins where user_id = caller for update;
  if not found then raise exception 'corpus administrator required' using errcode = '42501'; end if;
  if p_decision not in ('accept', 'dismiss') then
    raise exception 'invalid series suggestion decision' using errcode = '22023';
  end if;

  select row.* into suggestion from public.work_series_suggestions row
  where row.id = p_suggestion for update;
  if not found then raise exception 'series suggestion not found' using errcode = 'P0002'; end if;
  if suggestion.status <> 'pending' then
    raise exception 'series suggestion already reviewed' using errcode = 'P0001';
  end if;
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
      or current_revision is distinct from suggestion.staging_expected_review_revision
      or (suggestion.proposal_action = 'remove'
        and coalesce(suggestion.staging_removal_origin, 'graph') = 'graph'
        and not exists (
          select 1
          from public.corpus_series_entries entry
          join public.corpus_series parent
            on parent.id = entry.series_id and parent.archived_at is null
          where entry.id = suggestion.staging_expected_series_entry
            and entry.work_id = suggestion.work_id
            and entry.removed_at is null
            and entry.is_primary
            and parent.revision = suggestion.staging_expected_series_revision
        ))
      or (suggestion.proposal_action = 'remove'
        and suggestion.staging_removal_origin = 'projection'
        and (
          exists (
            select 1 from public.corpus_series_entries entry
            where entry.work_id = suggestion.work_id and entry.removed_at is null
          )
          or nullif(btrim(work_row.series), '') is distinct from btrim(suggestion.proposed_series)
          or work_row.position is distinct from suggestion.proposed_position
        )) then
      raise exception 'This catalog series or review changed. Refresh before reviewing the suggestion.'
        using errcode = 'P0001';
    end if;
  end if;

  if suggestion.proposal_action = 'remove'
     and suggestion.staging_removal_origin = 'projection'
     and p_decision = 'accept' then
    perform set_config('reverie.series_classifier', 'on', true);
    update public.works
       set series = null,
           position = null,
           series_count = null,
           status = case when status in ('ongoing', 'completed', 'on_hiatus', 'cancelled')
             then 'standalone' else status end,
           series_check_state = 'no_series',
           series_checked_at = suggestion.checked_at,
           series_check_source = suggestion.source,
           series_check_evidence = suggestion.evidence,
           series_check_reason = suggestion.reason,
           metadata_provenance = coalesce(metadata_provenance, '{}'::jsonb)
             || jsonb_build_object('series', jsonb_build_object(
               'source', suggestion.source,
               'sourceRef', suggestion.source_ref,
               'identityConfidence', suggestion.identity_confidence,
               'classification', 'no_series',
               'at', suggestion.checked_at,
               'reviewedBy', caller,
               'evidence', suggestion.evidence
             ))
     where id = suggestion.work_id;
    perform set_config('reverie.series_classifier', coalesce(classifier_before, ''), true);

    update public.work_series_suggestions
       set status = 'accepted', reviewed_by = caller, reviewed_at = now(), updated_at = now()
     where id = p_suggestion;
    select to_jsonb(work) into after_value from public.works work
    where work.id = suggestion.work_id;
    if after_value is distinct from to_jsonb(work_row) then
      insert into public.work_metadata_edits (work_id, editor_id, previous_value, next_value)
      values (suggestion.work_id, caller, to_jsonb(work_row), after_value);
    end if;
    return p_suggestion;
  end if;

  return public.review_corpus_series_suggestion(p_suggestion, p_decision);
exception when others then
  perform set_config('reverie.series_classifier', coalesce(classifier_before, ''), true);
  raise;
end;
$$;

revoke all on function public.review_corpus_series_suggestion_revisioned(uuid,text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_corpus_series_suggestion_revisioned(uuid,text)
  to authenticated;

commit;
