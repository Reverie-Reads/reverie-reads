-- Read-only inventory. Keep identities/fingerprints private; do not commit query output.
begin read only;
select w.id, w.title, w.author_text, w.series_checked_at,
       md5(to_jsonb(w)::text) as work_fingerprint
from public.works w
where w.series_check_state = 'no_series'
  and w.series_checked_at < timestamptz '2026-09-10T00:00:00Z'
  and w.series_check_reason = 'The relational series source was unavailable; the search label was not accepted by itself.'
  and w.series_check_evidence @> '[{"source":"hardcover","kind":"provider_unavailable"}]'::jsonb
  and not exists (select 1 from public.corpus_series_entries e
                  where e.work_id = w.id and e.removed_at is null)
order by w.id;
commit;
