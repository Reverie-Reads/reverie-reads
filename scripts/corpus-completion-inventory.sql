-- Owner/admin read-only snapshot. Save the result privately as a JSON array for the planner.
-- Reader linkage is a priority boolean, never personal metadata or evidence of a book fact.
select
  w.id,
  w.title,
  coalesce(w.author_text, '') as author,
  coalesce(w.isbns, '{}') as isbns,
  w.series_check_state,
  md5(to_jsonb(w)::text) as fingerprint,
  exists(select 1 from public.books b where b.corpus_work_id = w.id) as reader_linked,
  array_remove(array[
    case when nullif(trim(w.description), '') is null then 'description' end,
    case when w.pages is null then 'pages' end,
    case when w.pub_y is null then 'publication' end,
    case when nullif(trim(w.publisher), '') is null then 'publisher' end,
    case when nullif(trim(w.language), '') is null then 'language' end
  ], null) as missing_fields,
  coalesce(r.state, 'open') as saved_review_state,
  coalesce(r.fingerprint = evidence.record->>'fingerprint', false) as review_current,
  evidence.record->'issues' as issues,
  exists(select 1 from public.corpus_isbn_reports i
    where i.work_id = w.id and i.resolved_at is null) as unresolved_isbn_report,
  (select count(*) from public.corpus_editions e where e.work_id = w.id) as edition_count,
  (select count(*) from public.corpus_editions e where e.work_id = w.id
    and e.reviewed and e.details->>'pages' is not null) as reviewed_editions_with_pages
from public.works w
left join public.corpus_metadata_reviews r on r.work_id = w.id
cross join lateral (select public.catalog_metadata_review_record(w) as record) evidence
order by w.id;
