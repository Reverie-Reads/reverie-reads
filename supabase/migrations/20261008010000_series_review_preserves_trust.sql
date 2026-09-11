-- Durable guard only: no historical catalog, suggestion or personal rows are rewritten.
-- Review preserves existing graph authority; it cannot manufacture it from a candidate label.
-- Owner-run migration: changes the outcome of classification/review writes.

create or replace function public.sync_corpus_series_catalog_work(p_work uuid, p_action text default 'sync')
returns uuid
language plpgsql
security definer
set search_path = ''
as $fn$
declare
  work public.works%rowtype;
  target_series uuid;
  current_entry public.corpus_series_entries%rowtype;
  v_source_name text;
  v_source_ref text;
  v_series_name text;
  v_name_key text;
  v_creator_key text;
  source_lock text;
  name_lock text;
  claim jsonb;
  evidence_value jsonb;
  valid_status text;
  count_conflict boolean := false;
begin
  select w.* into work from public.works w where w.id = p_work for update;
  if not found then return null; end if;

  select e.* into current_entry
  from public.corpus_series_entries e
  join public.corpus_series s on s.id = e.series_id
  where e.work_id = p_work and e.removed_at is null and e.is_primary
  order by e.id
  limit 1;

  -- A pending proposal is not authority for the retained scalar label. Preserve existing graph
  -- rows exactly (including their evidence/revision), but never create or revive one on review.
  -- Dismissal likewise preserves the graph; the reviewer RPC scopes and restores this flag.
  if work.series_check_state = 'review'
     or coalesce(current_setting('reverie.series_review_preserve_catalog', true), '') = 'on' then
    return current_entry.series_id;
  end if;

  v_series_name := nullif(trim(coalesce(work.series, '')), '');
  if v_series_name is null or work.series_check_state <> 'found' then
    if current_entry.id is not null then
      update public.corpus_series_entries
         set removed_at = now(), is_primary = false, archive_primary_intent = false
       where id = current_entry.id;
      update public.corpus_series
         set revision = revision + 1
       where id = current_entry.series_id;
    end if;
    return null;
  end if;

  v_name_key := public.corpus_series_identity_key(v_series_name);
  v_creator_key := public.corpus_series_identity_key(work.author_text);
  v_source_name := coalesce(
    nullif(work.metadata_provenance -> 'series' ->> 'source', ''),
    nullif(work.series_check_source, ''),
    'corpus'
  );
  v_source_ref := nullif(work.metadata_provenance -> 'series' ->> 'sourceRef', '');
  if v_source_ref is null then
    -- A candidate label carries a BOOK locator, not a series id. Only one matching relational
    -- reference may supply the fallback; competing references leave provider identity unset.
    select min(item ->> 'sourceRef') into v_source_ref
    from jsonb_array_elements(case
      when jsonb_typeof(work.series_check_evidence) = 'array' then work.series_check_evidence
      else '[]'::jsonb end) item
    where item ->> 'kind' = 'relational_membership'
      and item ->> 'source' = v_source_name
      and public.corpus_series_identity_key(item ->> 'series') = v_name_key
      and nullif(trim(item ->> 'sourceRef'), '') is not null
    having count(distinct item ->> 'sourceRef') = 1;
  end if;
  if v_source_name = 'hardcover' and v_source_ref ~ '^hardcover:(book:)?[0-9]+$' then
    v_source_ref := null;
  end if;
  evidence_value := case
    when jsonb_typeof(work.series_check_evidence) = 'array' then work.series_check_evidence
    else '[]'::jsonb
  end;
  claim := jsonb_strip_nulls(jsonb_build_object(
    'origin', 'corpus', 'source', v_source_name, 'sourceRef', v_source_ref,
    'confidence', coalesce(
      nullif(work.metadata_provenance -> 'series' ->> 'membershipConfidence', ''),
      nullif(work.metadata_provenance -> 'series' ->> 'confidence', ''),
      'high'
    ),
    'at', coalesce(work.series_checked_at, now())
  ));
  valid_status := case when work.status in (
    'ongoing', 'completed', 'on_hiatus', 'cancelled',
    'interconnected_standalone', 'interconnected_series'
  ) then work.status end;

  -- All catalog identity writers use the same sorted advisory-key order after their affected work
  -- locks. A stable provider id wins; name+creator is the fallback, never name alone.
  source_lock := case
    when v_source_name not in ('manual', 'corpus') and v_source_ref is not null
      then 'source:' || v_source_name || ':' || v_source_ref
  end;
  name_lock := 'name:' || v_name_key || ':' || v_creator_key;
  perform pg_advisory_xact_lock(hashtextextended(lock_key, 0))
  from (
    select distinct lock_key
    from unnest(array_remove(array[source_lock, name_lock], null)) as keys(lock_key)
    order by lock_key
  ) ordered_keys;

  -- A catalog lifecycle RPC pins the intended target in transaction-local state. Ordinary corpus
  -- edits do not set it and therefore resolve by provider id, then normalized name+creator.
  begin
    target_series := nullif(current_setting('reverie.corpus_series_target', true), '')::uuid;
  exception when invalid_text_representation then
    target_series := null;
  end;

  if target_series is null and source_lock is not null then
    select s.series_id into target_series
    from public.corpus_series_sources s
    join public.corpus_series c on c.id = s.series_id and c.archived_at is null
    where s.source = v_source_name and s.source_ref = v_source_ref;
  end if;
  if target_series is null then
    select (array_agg(distinct n.series_id order by n.series_id))[1] into target_series
    from public.corpus_series_names n
    join public.corpus_series c on c.id = n.series_id and c.archived_at is null
    where n.name_key = v_name_key and n.creator_key = v_creator_key
    having count(distinct n.series_id) = 1;
  end if;

  if target_series is null then
    insert into public.corpus_series (
      name, name_key, creator_key, status, declared_count, evidence
    ) values (
      v_series_name, v_name_key, v_creator_key, valid_status, work.series_count, evidence_value
    ) returning id into target_series;
    insert into public.corpus_series_names (
      series_id, name, name_key, creator_key, kind, source, source_ref
    ) values (
      target_series, v_series_name, v_name_key, v_creator_key, 'canonical', v_source_name, v_source_ref
    );
    insert into public.corpus_series_edits (
      series_id, action, previous_value, next_value
    ) values (
      target_series, 'seed', null,
      jsonb_build_object('work_id', work.id, 'name', v_series_name, 'position', work.position)
    );
  end if;

  if source_lock is not null then
    insert into public.corpus_series_sources (
      series_id, source, source_ref, evidence, observed_at
    ) values (
      target_series, v_source_name, v_source_ref, evidence_value,
      coalesce(work.series_checked_at, now())
    )
    on conflict (source, source_ref) do update set
      evidence = excluded.evidence,
      observed_at = excluded.observed_at;
  end if;

  -- A spelling from the reviewed work becomes an alias only inside the creator scope. A name
  -- fallback is used only when it resolves to exactly one active series; provider ids distinguish
  -- homonyms without forcing an arbitrary merge.
  insert into public.corpus_series_names (
    series_id, name, name_key, creator_key, kind, source, source_ref
  ) values (
    target_series, v_series_name, v_name_key, v_creator_key,
    case when exists (
      select 1 from public.corpus_series_names n
      where n.series_id = target_series and n.kind = 'canonical'
    ) then 'alias' else 'canonical' end,
    v_source_name, v_source_ref
  )
  on conflict (series_id, name_key, creator_key) do nothing;

  if current_entry.id is not null and current_entry.series_id <> target_series then
    update public.corpus_series_entries
       set removed_at = now(), is_primary = false, archive_primary_intent = false
     where id = current_entry.id;
    update public.corpus_series set revision = revision + 1
     where id = current_entry.series_id;
  end if;

  -- Never let an old primary survive a reviewed move. Secondary memberships are preserved.
  update public.corpus_series_entries
     set is_primary = false
   where work_id = p_work and removed_at is null and is_primary and series_id <> target_series;

  insert into public.corpus_series_entries (
    series_id, work_id, position, title, author_text, is_primary,
    membership_claim, position_claim, evidence, source, source_ref
  ) values (
    target_series, p_work, work.position, work.title, work.author_text, true,
    claim,
    case when work.position is null then '{"origin":"unknown"}'::jsonb else claim end,
    evidence_value, v_source_name, v_source_ref
  )
  on conflict (series_id, work_id) where work_id is not null and removed_at is null
  do update set
    position = excluded.position,
    title = excluded.title,
    author_text = excluded.author_text,
    is_primary = true,
    membership_claim = excluded.membership_claim,
    position_claim = excluded.position_claim,
    evidence = excluded.evidence,
    source = excluded.source,
    source_ref = excluded.source_ref;

  select c.declared_count is not null and work.series_count is not null
         and c.declared_count <> work.series_count
    into count_conflict
  from public.corpus_series c where c.id = target_series;

  update public.corpus_series c
     set status = coalesce(c.status, valid_status),
         declared_count = coalesce(c.declared_count, work.series_count),
         catalog_state = case when count_conflict then 'review' else c.catalog_state end,
         evidence = case
           when evidence_value = '[]'::jsonb or c.evidence @> evidence_value then c.evidence
           else c.evidence || evidence_value
         end,
         revision = c.revision + 1
   where c.id = target_series;

  insert into public.corpus_series_edits (
    series_id, action, previous_value, next_value
  ) values (
    target_series,
    case when p_action in ('seed', 'sync') then p_action else 'sync' end,
    case when current_entry.id is null then null else to_jsonb(current_entry) end,
    jsonb_build_object('work_id', work.id, 'position', work.position, 'primary', true)
  );
  return target_series;
end;
$fn$;

revoke all on function public.sync_corpus_series_catalog_work(uuid, text)
  from public, anon, authenticated, service_role;

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
  if p_decision = 'accept' then
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
    -- Rejecting a proposal does not verify the old candidate label. Only an existing active
    -- primary graph anchor may retain found; an unverified/missing/removed anchor stays unresolved.
    -- Do not re-copy the rejected proposal's evidence into an already-trusted graph on dismissal.
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
end;
$$;

revoke all on function public.review_corpus_series_suggestion(uuid, text)
  from public, anon, authenticated, service_role;
grant execute on function public.review_corpus_series_suggestion(uuid, text)
  to authenticated;
