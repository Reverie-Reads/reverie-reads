-- Let the completed truth-blind corpus shadow surface historical series claims for an explicit
-- administrator keep/remove decision. Staging remains no-write review preparation; only accepting
-- one revision-bound removal review changes the shared catalog.
begin;

alter table public.work_series_suggestions
  add column proposal_action text not null default 'set'
    check (proposal_action in ('set', 'remove')),
  add column staging_expected_series_entry uuid,
  add column staging_expected_series_revision bigint
    check (staging_expected_series_revision is null or staging_expected_series_revision > 0),
  add constraint work_series_suggestions_removal_review_shape_check check (
    (proposal_action = 'set'
      and staging_expected_series_entry is null
      and staging_expected_series_revision is null)
    or
    (proposal_action = 'remove'
      and staging_manifest_sha256 is not null
      and staging_expected_series_entry is not null
      and staging_expected_series_revision is not null)
  );

create function public.admin_stage_corpus_shadow_series_removal_reviews(
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
  primary_entry public.corpus_series_entries%rowtype;
  series_row public.corpus_series%rowtype;
  current_memberships jsonb;
  current_pending jsonb;
  current_baseline jsonb;
  current_fingerprint text;
  current_revision integer;
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
    raise exception 'invalid corpus shadow removal-review batch' using errcode = '22023';
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
      or jsonb_typeof(item->'expectedBaseline') <> 'object' then
      raise exception 'invalid corpus shadow removal-review item' using errcode = '22023';
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

    select entry.* into primary_entry
    from public.corpus_series_entries entry
    join public.corpus_series parent on parent.id = entry.series_id and parent.archived_at is null
    where entry.work_id = work_row.id and entry.removed_at is null and entry.is_primary
    order by entry.id
    limit 1;
    if primary_entry.id is null then
      raise exception 'corpus shadow series changed; rebuild before staging' using errcode = 'P0001';
    end if;
    select parent.* into series_row from public.corpus_series parent
    where parent.id = primary_entry.series_id and parent.archived_at is null;
    if series_row.id is null
      or series_row.name is distinct from btrim(item->'proposal'->>'series')
      or primary_entry.position is distinct from (case
        when item->'proposal'->'position' = 'null'::jsonb then null
        else (item->'proposal'->>'position')::numeric
      end) then
      raise exception 'corpus shadow series changed; rebuild before staging' using errcode = 'P0001';
    end if;

    select coalesce(jsonb_agg(jsonb_build_object(
      'series', parent.name,
      'position', entry.position,
      'role', case when entry.is_primary then 'primary' else 'unknown' end
    ) order by public.corpus_series_identity_key(parent.name), entry.position nulls last, entry.id), '[]'::jsonb)
    into current_memberships
    from public.corpus_series_entries entry
    join public.corpus_series parent
      on parent.id = entry.series_id and parent.archived_at is null
    where entry.work_id = work_row.id and entry.removed_at is null;

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
      'currentOrigin', 'graph',
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
      staging_expected_series_entry, staging_expected_series_revision
    ) values (
      work_row.id, series_row.name, primary_entry.position,
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
      primary_entry.id, series_row.revision
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

revoke all on function public.admin_stage_corpus_shadow_series_removal_reviews(text,text,jsonb)
  from public, anon, authenticated, service_role;
grant execute on function public.admin_stage_corpus_shadow_series_removal_reviews(text,text,jsonb)
  to authenticated;

create or replace function public.review_corpus_series_suggestion(
  p_suggestion uuid,
  p_decision text
)
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  suggestion public.work_series_suggestions%rowtype;
  before_value jsonb;
  after_value jsonb;
  removal_series_id uuid;
  removal_series_revision bigint;
  remaining_entries bigint;
  preserve_catalog_before text := current_setting('reverie.series_review_preserve_catalog', true);
begin
  if caller is null then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.profiles profile where profile.id = caller for key share;
  perform 1 from public.corpus_admins admin where admin.user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  if p_decision not in ('accept', 'dismiss') then
    raise exception 'invalid series suggestion decision' using errcode = '22023';
  end if;
  select s.* into suggestion from public.work_series_suggestions s
  where s.id = p_suggestion for update;
  if not found then raise exception 'series suggestion not found' using errcode = 'P0002'; end if;
  if suggestion.status <> 'pending' then
    raise exception 'series suggestion already reviewed' using errcode = 'P0001';
  end if;

  perform 1
  from public.books book
  where book.corpus_work_id = suggestion.work_id and book.removed_at is null
  order by book.id
  for update;

  select to_jsonb(w) into before_value from public.works w
  where w.id = suggestion.work_id for update;
  perform set_config('reverie.series_classifier', 'on', true);
  if p_decision = 'accept' and suggestion.proposal_action = 'remove' then
    select entry.series_id into removal_series_id
    from public.corpus_series_entries entry
    join public.corpus_series parent on parent.id = entry.series_id and parent.archived_at is null
    where entry.id = suggestion.staging_expected_series_entry
      and entry.work_id = suggestion.work_id
      and entry.removed_at is null
      and entry.is_primary;
    if removal_series_id is null then
      raise exception 'This catalog series changed. Refresh before reviewing the suggestion.'
        using errcode = 'P0001';
    end if;
    perform public.remove_corpus_series_entry(
      suggestion.staging_expected_series_entry,
      suggestion.staging_expected_series_revision
    );
    update public.works
       set series_check_state = 'no_series',
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
    select parent.revision,
           count(entry.id) filter (where entry.removed_at is null)
      into removal_series_revision, remaining_entries
    from public.corpus_series parent
    left join public.corpus_series_entries entry on entry.series_id = parent.id
    where parent.id = removal_series_id and parent.archived_at is null
    group by parent.id;
    if removal_series_revision is not null and remaining_entries = 0 then
      perform public.archive_corpus_series(removal_series_id, removal_series_revision);
    end if;
  elsif p_decision = 'accept' then
    update public.works
       set series = suggestion.proposed_series,
           position = suggestion.proposed_position,
           series_count = suggestion.proposed_count,
           series_check_state = 'found', series_checked_at = suggestion.checked_at,
           series_check_source = suggestion.source,
           series_check_evidence = suggestion.evidence,
           series_check_reason = suggestion.reason,
           metadata_provenance = coalesce(metadata_provenance, '{}'::jsonb)
             || jsonb_build_object('series', jsonb_strip_nulls(jsonb_build_object(
               'source', suggestion.source, 'sourceRef', suggestion.source_ref,
               'identityConfidence', suggestion.identity_confidence,
               'confidence', suggestion.confidence,
               'membershipConfidence', suggestion.confidence,
               'at', suggestion.checked_at, 'reviewedBy', caller,
               'evidence', suggestion.evidence
             )))
     where id = suggestion.work_id;
  else
    perform set_config('reverie.series_review_preserve_catalog', 'on', true);
    update public.works w
       set series_check_state = case
         when nullif(trim(w.series), '') is not null and exists (
           select 1 from public.corpus_series_entries e
           join public.corpus_series c on c.id = e.series_id and c.archived_at is null
           where e.work_id = w.id and e.removed_at is null and e.is_primary
         ) then 'found' else 'unresolved' end
     where w.id = suggestion.work_id;
    perform set_config('reverie.series_review_preserve_catalog', coalesce(preserve_catalog_before, ''), true);
  end if;
  perform set_config('reverie.series_classifier', '', true);

  update public.work_series_suggestions
     set status = case p_decision when 'accept' then 'accepted' else 'dismissed' end,
         reviewed_by = caller, reviewed_at = now(), updated_at = now()
   where id = p_suggestion;

  select to_jsonb(w) into after_value from public.works w where w.id = suggestion.work_id;
  if after_value is distinct from before_value then
    insert into public.work_metadata_edits (work_id, editor_id, previous_value, next_value)
    values (suggestion.work_id, caller, before_value, after_value);
  end if;
  return p_suggestion;
exception when others then
  perform set_config('reverie.series_classifier', '', true);
  perform set_config('reverie.series_review_preserve_catalog', coalesce(preserve_catalog_before, ''), true);
  raise;
end;
$$;

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
      or current_revision is distinct from suggestion.staging_expected_review_revision
      or (suggestion.proposal_action = 'remove' and not exists (
        select 1
        from public.corpus_series_entries entry
        join public.corpus_series parent
          on parent.id = entry.series_id and parent.archived_at is null
        where entry.id = suggestion.staging_expected_series_entry
          and entry.work_id = suggestion.work_id
          and entry.removed_at is null
          and entry.is_primary
          and parent.revision = suggestion.staging_expected_series_revision
      )) then
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
