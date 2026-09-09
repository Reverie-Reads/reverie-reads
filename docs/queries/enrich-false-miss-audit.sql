-- Which books were stamped `enriched_at` without anything actually being checked.
-- HISTORICAL ONLY: queries below use pre-retirement cache keys and must not diagnose current
-- cache misses after the no-isbndb-v1 cutover. A missing old key is not evidence nothing answered.
-- See docs/tasks/isbndb-retirement.md; do not run the suggested un-stamp from this stale join.
-- READ-ONLY. Owner's to run — Code has no production read access (see BACKLOG).
--
-- THE DISCRIMINATOR. The enrich function only writes `enrichment_cache` when at least one source
-- returned a record (`if (sourceList) await writeCache(...)`). So a book whose `enriched_at` was
-- stamped but which has NO corresponding cache row is a book where every source failed or returned
-- nothing — and before this branch, those two were the same event and both were stamped.
--
-- The cache key mirrors `cacheKeyFor()`: `isbn:<13>` when an ISBN is known, else
-- `ta:<norm-title>|<norm-author>` where norm is lowercase with every non-alphanumeric stripped.

-- ── 1. The headline: stamped-but-never-cached, newest first ──────────────────────────────────
with keyed as (
  select b.id, b.title, b.author_first, b.author_last, b.cover_url, b.isbn, b.enriched_at,
         case
           when length(regexp_replace(coalesce(b.isbn, ''), '[^0-9Xx]', '', 'g')) >= 10
             then 'isbn:' || upper(regexp_replace(b.isbn, '[^0-9Xx]', '', 'g'))
           else 'ta:' || regexp_replace(lower(coalesce(b.title, '')), '[^a-z0-9]', '', 'g')
                || '|' || regexp_replace(lower(trim(coalesce(b.author_first,'') || ' ' || coalesce(b.author_last,''))),
                                          '[^a-z0-9]', '', 'g')
         end as cache_key
  from public.books b
  where b.enriched_at is not null
)
select k.enriched_at::date as stamped_on,
       count(*) as books_stamped,
       count(*) filter (where ec.key is null) as never_cached_so_nothing_answered,
       count(*) filter (where ec.key is null and coalesce(k.cover_url,'') = '') as of_those_still_coverless
from keyed k
left join public.enrichment_cache ec on ec.key = k.cache_key
group by 1
order by 1 desc;

-- ── 2. The specific books, so they can be un-stamped and retried ─────────────────────────────
-- Anything listed here was negative-cached without an answer. Clearing `enriched_at` puts it back
-- in the next sweep's candidate set immediately, instead of waiting out the 3-day window.
with keyed as (
  select b.id, b.title, b.cover_url, b.enriched_at,
         case
           when length(regexp_replace(coalesce(b.isbn, ''), '[^0-9Xx]', '', 'g')) >= 10
             then 'isbn:' || upper(regexp_replace(b.isbn, '[^0-9Xx]', '', 'g'))
           else 'ta:' || regexp_replace(lower(coalesce(b.title, '')), '[^a-z0-9]', '', 'g')
                || '|' || regexp_replace(lower(trim(coalesce(b.author_first,'') || ' ' || coalesce(b.author_last,''))),
                                          '[^a-z0-9]', '', 'g')
         end as cache_key
  from public.books b
  where b.enriched_at is not null and coalesce(b.cover_url, '') = ''
)
select k.id, k.title, k.enriched_at
from keyed k
left join public.enrichment_cache ec on ec.key = k.cache_key
where ec.key is null
order by k.enriched_at desc;

-- ── 3. The un-stamp, when you want it. NOT run automatically — this is a write. ──────────────
-- update public.books set enriched_at = null
-- where id in ( <ids from query 2> );

-- ── 4. Sanity: how big is the candidate set the sweep actually sees, vs the button's number? ──
-- The button counts `isIncomplete` only; the sweep additionally applies the recheck window. A run
-- that "stopped at 49 of ~490" may simply have had 49 candidates. This settles which.
select
  count(*) filter (
    where coalesce(cover_url,'') = '' or coalesce(isbn,'') = '' or pub_y is null
  ) as button_shows_roughly,
  count(*) filter (
    where (coalesce(cover_url,'') = '' or coalesce(isbn,'') = '' or pub_y is null)
      and (enriched_at is null or enriched_at < now() - interval '3 days')
  ) as sweep_candidates_now,
  count(*) filter (where enriched_at is null) as never_checked
from public.books;
