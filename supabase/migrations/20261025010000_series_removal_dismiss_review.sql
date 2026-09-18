-- Keeping an unchanged work membership is safe after a sibling merely advances the shared
-- parent revision. Removing a membership remains bound to the exact frozen parent revision.
begin;

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

    if suggestion.proposal_action = 'remove' and p_decision = 'dismiss' then
      if coalesce(suggestion.staging_removal_origin, 'graph') = 'graph' then
        if nullif(btrim(work_row.series), '') is distinct from btrim(suggestion.proposed_series)
          or work_row.position is distinct from suggestion.proposed_position
          or not exists (
            select 1
            from public.corpus_series_entries entry
            join public.corpus_series parent
              on parent.id = entry.series_id and parent.archived_at is null
            where entry.id = suggestion.staging_expected_series_entry
              and entry.work_id = suggestion.work_id
              and entry.removed_at is null
              and entry.is_primary
              and btrim(parent.name) = btrim(suggestion.proposed_series)
              and entry.position is not distinct from suggestion.proposed_position
          ) then
          raise exception 'This catalog series changed. Refresh before reviewing the suggestion.'
            using errcode = 'P0001';
        end if;
      elsif suggestion.staging_removal_origin = 'projection' then
        if exists (
            select 1 from public.corpus_series_entries entry
            where entry.work_id = suggestion.work_id and entry.removed_at is null
          )
          or nullif(btrim(work_row.series), '') is distinct from btrim(suggestion.proposed_series)
          or work_row.position is distinct from suggestion.proposed_position then
          raise exception 'This catalog series changed. Refresh before reviewing the suggestion.'
            using errcode = 'P0001';
        end if;
      else
        raise exception 'This catalog series changed. Refresh before reviewing the suggestion.'
          using errcode = 'P0001';
      end if;
    elsif ((suggestion.proposal_action = 'set'
        and suggestion.staging_series_fingerprint_version = 'work_anchor_v2') is true
        and public.catalog_series_positive_suggestion_fingerprint(work_row)
          is distinct from suggestion.staging_expected_series_fingerprint)
      or ((suggestion.proposal_action = 'set'
            and suggestion.staging_series_fingerprint_version = 'work_anchor_v2') is not true
        and public.catalog_series_confirmation_fingerprint(work_row)
          is distinct from suggestion.staging_expected_series_fingerprint)
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
