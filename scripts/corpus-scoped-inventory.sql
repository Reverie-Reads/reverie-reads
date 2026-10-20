-- Owner/admin SELECT-only baseline. Execute in a read-only transaction and retain privately.
-- No personal columns: reader linkage is only an EXISTS priority flag.
-- This is NOT the v1 corpus-completion planner input and never authorizes a correction.
-- Presence, a source URL, and an edition's reviewed flag do not certify individual facts.
with identities as materialized (
  select w.id, public.library_work_key(w.title,w.author_text) as identity_key,
    nullif(btrim(w.title), '') is not null and nullif(btrim(w.author_text), '') is not null as complete,
    public.catalog_review_isbns(w.isbns) as isbns,
    exists(select 1 from unnest(w.isbns) i where not public.library_isbn_checksum_is_valid(i)) as invalid_isbn
  from public.works w
), duplicate_keys as (
  select identity_key from identities where complete group by identity_key having count(*)>1
), isbn_members as materialized (
  select distinct id, unnest(isbns) as isbn from identities
), conflicting_isbns as (
  select isbn from isbn_members group by isbn having count(*)>1
), records as (
  select w.*, i.invalid_isbn,
    exists(select 1 from duplicate_keys k where i.complete and k.identity_key=i.identity_key) as duplicate_identity,
    exists(select 1 from isbn_members m join conflicting_isbns c on c.isbn=m.isbn where m.id=w.id) as isbn_conflict,
    exists(select 1 from public.books b where b.corpus_work_id = w.id) as reader_linked
  from public.works w
  join identities i on i.id=w.id
)
select
  w.id,
  public.corpus_record_fingerprint(w.id) as fingerprint,
  w.reader_linked,
  jsonb_build_object(
    'description', case when nullif(btrim(w.description, E' \t\r\n'), '') is null then 'missing' else 'present' end,
    'pages', case when w.pages is null then 'missing' else 'present' end,
    'publication', case when w.pub_y is null then 'missing' else 'present' end,
    'publisher', case when nullif(btrim(w.publisher), '') is null then 'missing' else 'present' end,
    'language', case when nullif(btrim(w.language), '') is null then 'missing' else 'present' end,
    'cover', case when nullif(btrim(w.cover_url), '') is null then 'missing' else 'present' end
  ) as work_fields,
  case when nullif(btrim(w.title), '') is null or nullif(btrim(w.author_text), '') is null
    or w.invalid_isbn or w.isbn_conflict or w.duplicate_identity
    or exists(select 1 from public.corpus_isbn_reports i where i.work_id=w.id and i.resolved_at is null)
    then 'review_required' else 'unknown' end as identity_state,
  array_remove(array[
    case when nullif(btrim(w.title), '') is null then 'missing_title' end,
    case when nullif(btrim(w.author_text), '') is null then 'missing_creator' end,
    case when w.invalid_isbn then 'invalid_isbn' end,
    case when w.isbn_conflict then 'isbn_conflict' end,
    case when w.duplicate_identity then 'duplicate_identity' end,
    case when exists(select 1 from public.corpus_isbn_reports i where i.work_id=w.id and i.resolved_at is null)
      then 'unresolved_isbn_report' end
  ], null) as identity_reasons,
  case
    when jsonb_typeof(w.contributors) is distinct from 'array' then 'not_observed'
    when jsonb_array_length(w.contributors)=0 then 'missing'
    when exists(select 1 from jsonb_array_elements(w.contributors) c
      where nullif(btrim(c->>'name'), '') is null or c->>'role' is null
        or c->>'role' not in ('author','co_author','translator','illustrator','narrator','editor')) then 'review_required'
    else 'structured_unverified'
  end as contributor_state,
  coalesce(r.state, 'open') as saved_review_state,
  -- Only saved assessments need their exact existing review fingerprint recomputed.
  case when r.work_id is null then false else
    r.fingerprint = public.catalog_metadata_review_record(original)->>'fingerprint' end as review_current,
  w.series_check_state as series_state,
  coalesce((select jsonb_agg(jsonb_build_object(
    'id', e.id,
    'reviewed', e.reviewed,
    'fields', jsonb_build_object(
      -- Unknown format cannot establish whether page count applies. Audiobooks have no page gap.
      'pages', case when e.details->>'format'='audiobook' then 'not_applicable'
        when e.details->>'pages' is not null then 'present'
        when nullif(btrim(e.details->>'format'), '') is null then 'unknown' else 'missing' end,
      'publication', case when e.details->'publication'->>'y' is null then 'missing' else 'present' end,
      'publisher', case when nullif(btrim(e.details->>'publisher'), '') is null then 'missing' else 'present' end,
      'language', case when nullif(btrim(e.details->>'language'), '') is null then 'missing' else 'present' end,
      'format', case when nullif(btrim(e.details->>'format'), '') is null then 'unknown' else 'present' end
    ),
    -- to_jsonb permits an honest not_observed result before credit-storage deployment.
    'credit_state', case when not to_jsonb(e) ? 'credits' then 'not_observed'
      when exists(select 1 from jsonb_array_elements(to_jsonb(e)->'credits') c where c->'reviewRequired'='true'::jsonb)
        then 'review_required'
      when jsonb_array_length(to_jsonb(e)->'credits')>0 then 'recorded' else 'unknown' end,
    'credit_count', case when to_jsonb(e) ? 'credits' then jsonb_array_length(to_jsonb(e)->'credits') end,
    'held_credit_count', case when to_jsonb(e) ? 'credits' then
      (select count(*) from jsonb_array_elements(to_jsonb(e)->'credits') c where c->'reviewRequired'='true'::jsonb) end
  ) order by e.id) from public.corpus_editions e where e.work_id=w.id), '[]'::jsonb) as editions
from records w
join public.works original on original.id=w.id
left join public.corpus_metadata_reviews r on r.work_id=w.id
order by w.id;
