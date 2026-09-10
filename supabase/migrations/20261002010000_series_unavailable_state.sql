-- Durable closure only: no historical work rows are rewritten by this migration.
-- See docs/tasks/series-unavailable-recovery.md for the separate owner-run recovery.

create or replace function public.record_corpus_series_discovery(
  p_work uuid,
  p_result jsonb,
  p_checked_at timestamptz default now()
)
returns jsonb
language plpgsql
security definer
set search_path = ''
as $$
declare
  caller uuid := (select auth.uid());
  work public.works%rowtype;
  before_value jsonb;
  after_value jsonb;
  matched boolean := coalesce((p_result ->> 'matched')::boolean, false);
  proposed_series text := nullif(trim(p_result ->> 'series'), '');
  proposed_position numeric;
  proposed_count integer;
  source_name text := lower(coalesce(nullif(trim(p_result ->> 'source'), ''), 'catalog'));
  source_ref text := nullif(trim(p_result ->> 'sourceRef'), '');
  identity_confidence text := coalesce(
    nullif(trim(p_result ->> 'identityConfidence'), ''),
    nullif(trim(p_result ->> 'confidence'), ''),
    'none'
  );
  membership_confidence text := coalesce(
    nullif(trim(p_result ->> 'membershipConfidence'), ''),
    nullif(trim(p_result ->> 'confidence'), ''),
    'none'
  );
  evidence jsonb := coalesce(p_result -> 'evidence', '[]'::jsonb);
  reason text := nullif(trim(p_result ->> 'reason'), '');
  has_relational_evidence boolean := false;
  outcome text;
  suggestion_id uuid;
begin
  if caller is null then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  perform 1 from public.profiles profile where profile.id = caller for key share;
  perform 1 from public.corpus_admins admin where admin.user_id = caller for update;
  if not found then
    raise exception 'corpus administrator required' using errcode = '42501';
  end if;
  if jsonb_typeof(coalesce(p_result, '{}'::jsonb)) <> 'object' then
    raise exception 'series discovery result must be an object' using errcode = '22023';
  end if;
  if identity_confidence not in ('high', 'medium', 'low', 'none')
     or membership_confidence not in ('high', 'medium', 'low', 'none') then
    raise exception 'invalid series discovery confidence' using errcode = '22023';
  end if;
  if jsonb_typeof(evidence) <> 'array' then
    raise exception 'series discovery evidence must be an array' using errcode = '22023';
  end if;
  if exists (
    select 1 from jsonb_array_elements(evidence) item
    where nullif(trim(item ->> 'source'), '') is null
      or item ->> 'kind' not in (
        'relational_membership', 'candidate_label', 'provider_unavailable'
      )
  ) then
    raise exception 'series discovery evidence has an invalid source or kind'
      using errcode = '22023';
  end if;

  -- Evidence is an allowlisted record, never an upstream-document cache. Fantastic Fiction has an
  -- even narrower contract: membership, series name, order, source URL, and observation time only.
  -- In particular, do not retain or derive its series-size count or any arbitrary page content.
  select coalesce(jsonb_agg(jsonb_strip_nulls(jsonb_build_object(
    'source', lower(trim(item ->> 'source')),
    'kind', item ->> 'kind',
    'sourceRef', nullif(trim(item ->> 'sourceRef'), ''),
    'series', nullif(trim(item ->> 'series'), ''),
    'position', case when jsonb_typeof(item -> 'position') = 'number'
      then item -> 'position' else null end,
    'memberCount', case
      when lower(trim(item ->> 'source')) <> 'fantasticfiction'
        and jsonb_typeof(item -> 'memberCount') = 'number'
      then item -> 'memberCount' else null end,
    'orderType', case when item ->> 'orderType' in (
      'publication', 'recommended', 'narrative', 'unspecified'
    ) then item ->> 'orderType' else 'unspecified' end
  ))), '[]'::jsonb)
  into evidence
  from jsonb_array_elements(evidence) item;

  if p_result ? 'position' and nullif(trim(p_result ->> 'position'), '') is not null then
    begin
      proposed_position := (p_result ->> 'position')::numeric;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid series position' using errcode = '22023';
    end;
    if proposed_position <= 0 then
      raise exception 'series position must be greater than zero' using errcode = '22023';
    end if;
  end if;
  if p_result ? 'count' and nullif(trim(p_result ->> 'count'), '') is not null then
    begin
      proposed_count := (p_result ->> 'count')::integer;
    exception when invalid_text_representation or numeric_value_out_of_range then
      raise exception 'invalid series count' using errcode = '22023';
    end;
    if proposed_count < 1 or proposed_count > 999 then
      raise exception 'series count must be between 1 and 999' using errcode = '22023';
    end if;
  end if;
  if source_name = 'fantasticfiction' then proposed_count := null; end if;

  if proposed_series is not null then
    select exists (
      select 1
      from jsonb_array_elements(evidence) item
      where item ->> 'kind' = 'relational_membership'
        and nullif(trim(item ->> 'source'), '') is not null
        and lower(regexp_replace(trim(item ->> 'series'), '[^[:alnum:]]+', '', 'g'))
          = lower(regexp_replace(proposed_series, '[^[:alnum:]]+', '', 'g'))
    ) into has_relational_evidence;
  end if;

  -- Review and manual edits lock a pending suggestion before books. Take that row first even when
  -- this result will supersede rather than upsert it, then follow the shared book -> work order.
  perform 1
  from public.work_series_suggestions suggestion
  where suggestion.work_id = p_work and suggestion.status = 'pending'
  for update;

  -- Personal writes take book before work. Prelocking all active copies in UUID order keeps this
  -- classifier on the same order before its work update fires the personal-default trigger.
  perform 1
  from public.books book
  where book.corpus_work_id = p_work and book.removed_at is null
  order by book.id
  for update;

  select w.* into work from public.works w where w.id = p_work for update;
  if not found then raise exception 'corpus work not found' using errcode = 'P0002'; end if;
  before_value := to_jsonb(work);

  perform set_config('reverie.series_classifier', 'on', true);

  -- A null confirmed name is also how the classifier represents a failed relationship lookup.
  -- Explicit unresolved outcomes always fail closed. For null names, contradictory evidence or
  -- any other explicit outcome cannot masquerade as a successful no-label observation. Preserve
  -- old clients' matched/null/empty-evidence observations; positive claims still use the relational
  -- gates below, never the caller's outcome alone.
  if not matched or identity_confidence in ('low', 'none')
     or p_result ->> 'outcome' = 'unresolved'
     or (proposed_series is null and (
       jsonb_array_length(evidence) > 0
       or (p_result ->> 'outcome' is not null and p_result ->> 'outcome' <> 'no_series')
     )) then
    update public.works
       set series_check_state = 'unresolved', series_checked_at = p_checked_at,
           series_check_source = source_name, series_check_evidence = evidence,
           series_check_reason = reason
     where id = p_work;
    outcome := 'unresolved';

  elsif proposed_series is null then
    update public.work_series_suggestions
       set status = 'superseded', reviewed_at = p_checked_at, updated_at = p_checked_at
     where work_id = p_work and status = 'pending';
    update public.works
       set series_check_state = 'no_series', series_checked_at = p_checked_at,
           series_check_source = source_name, series_check_evidence = evidence,
           series_check_reason = reason
     where id = p_work;
    outcome := 'no_series';

  -- A provider's search label is not authority. Without the actual relationship this remains a
  -- retryable unresolved observation and does not flood the administrator queue.
  elsif membership_confidence in ('low', 'none') or not has_relational_evidence then
    update public.works
       set series_check_state = 'unresolved', series_checked_at = p_checked_at,
           series_check_source = source_name, series_check_evidence = evidence,
           series_check_reason = reason
     where id = p_work;
    outcome := 'unresolved';

  elsif membership_confidence = 'high' and (
    nullif(trim(work.series), '') is null
    or (
      lower(regexp_replace(trim(work.series), '[^[:alnum:]]+', '', 'g'))
        = lower(regexp_replace(proposed_series, '[^[:alnum:]]+', '', 'g'))
      and (work.position is null or proposed_position is null or work.position = proposed_position)
      and (work.series_count is null or proposed_count is null or work.series_count = proposed_count)
    )
  ) then
    update public.work_series_suggestions
       set status = 'superseded', reviewed_at = p_checked_at, updated_at = p_checked_at
     where work_id = p_work and status = 'pending';
    update public.works
       set series = coalesce(nullif(trim(series), ''), proposed_series),
           position = case when nullif(trim(work.series), '') is null
             then coalesce(proposed_position, position) else coalesce(position, proposed_position) end,
           series_count = coalesce(series_count, proposed_count),
           series_check_state = 'found', series_checked_at = p_checked_at,
           series_check_source = source_name, series_check_evidence = evidence,
           series_check_reason = reason,
           metadata_provenance = coalesce(metadata_provenance, '{}'::jsonb)
             || jsonb_build_object('series', jsonb_strip_nulls(jsonb_build_object(
               'source', source_name, 'sourceRef', source_ref,
               'identityConfidence', identity_confidence,
               'membershipConfidence', membership_confidence,
               'confidence', membership_confidence, 'at', p_checked_at,
               'evidence', evidence
             )))
     where id = p_work;
    outcome := case when nullif(trim(work.series), '') is null then 'applied' else 'confirmed' end;

  else
    insert into public.work_series_suggestions (
      work_id, proposed_series, proposed_position, proposed_count, source, source_ref,
      identity_confidence, confidence, evidence, reason, checked_at
    ) values (
      p_work, proposed_series, proposed_position, proposed_count, source_name, source_ref,
      identity_confidence, membership_confidence, evidence, reason, p_checked_at
    )
    on conflict (work_id) where status = 'pending'
    do update set proposed_series = excluded.proposed_series,
      proposed_position = excluded.proposed_position, proposed_count = excluded.proposed_count,
      source = excluded.source, source_ref = excluded.source_ref,
      identity_confidence = excluded.identity_confidence,
      confidence = excluded.confidence, evidence = excluded.evidence, reason = excluded.reason,
      checked_at = excluded.checked_at, updated_at = now()
    returning id into suggestion_id;
    update public.works
       set series_check_state = 'review', series_checked_at = p_checked_at,
           series_check_source = source_name, series_check_evidence = evidence,
           series_check_reason = reason
     where id = p_work;
    outcome := 'review';
  end if;

  perform set_config('reverie.series_classifier', '', true);
  select to_jsonb(w) into after_value from public.works w where w.id = p_work;
  if after_value is distinct from before_value then
    insert into public.work_metadata_edits (work_id, editor_id, previous_value, next_value)
    values (p_work, caller, before_value, after_value);
  end if;
  return jsonb_strip_nulls(jsonb_build_object('outcome', outcome, 'suggestion_id', suggestion_id));
end;
$$;

revoke all on function public.record_corpus_series_discovery(uuid, jsonb, timestamptz)
  from public, anon, authenticated, service_role;
grant execute on function public.record_corpus_series_discovery(uuid, jsonb, timestamptz)
  to authenticated;
