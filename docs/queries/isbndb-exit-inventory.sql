-- READ-ONLY, aggregate-only ISBNdb marker inventory. One SELECT; no functions or writes.
-- Usage: supabase db query --local --file docs/queries/isbndb-exit-inventory.sql
-- For the verified production project use --linked --project-ref <ref> instead of --local.
-- Exact source markers are positive leads, not deletion targets. Unmarked rows can still contain
-- ISBNdb-derived unions or personal fields whose provenance was discarded. This cannot certify
-- backups, Storage objects, offline caches, exports, or independently acquired rights.
with documents as (
  select 'enrichment_cache' as area, jsonb_build_object(
    'record', record, 'provenance', provenance, 'alternates', alternates
  ) as payload from public.enrichment_cache
  union all
  select 'works', jsonb_build_object('metadata_provenance', metadata_provenance,
    'cover_source', cover_source, 'cover_source_url', cover_source_url, 'cover_options', cover_options)
  from public.works
  union all
  select 'books', jsonb_build_object('cover_source', cover_source,
    'cover_source_url', cover_source_url, 'series_claim', series_claim)
  from public.books
  union all
  select 'work_metadata_edits', jsonb_build_object('previous', previous_value, 'next', next_value)
  from public.work_metadata_edits
  union all
  select 'corpus_metadata_review_events', jsonb_build_object('previous', previous_value, 'next', next_value)
  from public.corpus_metadata_review_events
  union all
  select 'corpus_cover_review_events', jsonb_build_object('previous', previous_value, 'next', next_value)
  from public.corpus_cover_review_events
), marked as (
  select area,
    coalesce(jsonb_path_exists(payload, '$.**.source ? (@ == "isbndb")'), false)
    or coalesce(jsonb_path_exists(payload, '$.**.cover_source ? (@ == "isbndb")'), false)
    or coalesce(jsonb_path_exists(payload, '$.**.ids.isbndb'), false) as has_source_marker,
    payload::text ~* '(api2?\.isbndb\.com|isbndb:)' as has_url_or_id_hint
  from documents
), areas(area) as (
  values ('enrichment_cache'), ('works'), ('books'), ('work_metadata_edits'),
    ('corpus_metadata_review_events'), ('corpus_cover_review_events')
)
select areas.area,
  count(marked.area) as rows_examined,
  count(*) filter (where has_source_marker) as rows_with_explicit_marker,
  count(*) filter (where has_url_or_id_hint) as rows_with_url_or_id_hint,
  count(*) filter (where marked.area is not null and not has_source_marker
    and not has_url_or_id_hint) as rows_without_detected_marker_not_proven_independent
from areas left join marked using (area)
group by areas.area order by areas.area;
