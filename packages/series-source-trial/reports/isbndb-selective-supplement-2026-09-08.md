# Selective ISBNdb metadata supplement — 2026-09-08

## Decision and evidence

Keep Google Books and Open Library as the identity/metadata baseline. Evaluate ISBNdb selectively
for missing page counts and edition formats, with review required before any downstream use.

The preceding edition comparison covered 12 editions across eight work/adaptation groups. Nine
cases had fully observed three-source results. On those nine, ISBNdb offered five additional field
opportunities over Google plus Open Library: two page counts and three edition formats, but no
additional strict identities. The three other cases lacked complete baselines because of
infrastructure errors. These are small-sample opportunities, not independently certified correct
fills or a population accuracy estimate. The completed comparison and its frozen inputs were not
rerun or modified for this implementation.

## Implemented path

The package command `metadata:supplement` runs a separate, no-write metadata experiment:

1. Validate a bounded development input containing identity, current page/format values, and actual
   Google/Open Library observations. Unknown fields, unsupported providers, duplicate cases, and
   invalid ISBNs are rejected. Baseline provenance is supplied by the operator, not independently
   authenticated by this CLI.
2. Require returned canonical ISBN, full-title, and full-author agreement before considering a paid
   lookup. Baseline identity disagreement or edition-format conflict prevents the lookup.
3. Skip ISBNdb when current or baseline fields already suffice. Page-count disagreements remain
   review items; audiobook page counts are not treated as gaps.
4. Send only the canonical ISBN to the fixed ISBNdb endpoint with header authentication, serial
   pacing, bounded response/time/request budgets, no redirects, and no retries. Authentication,
   quota, and repeated infrastructure failures halt further requests.
5. Validate the returned edition again. Contradictory format or supplied language, unknown binding,
   title/long-title mismatch, and contributor mismatch cannot produce candidates. Only missing page count and
   edition format can be proposed, with review-only source/time annotations in memory.
6. Emit aggregate counts only. No provider field values, identities, keys, URLs, raw responses, or
   raw errors are written to reports by the runner. It has no LLM, Supabase, corpus, or export writer.

Publisher names, publication dates, covers, descriptions, contributors, and series classification
are deliberately excluded. Edition format never changes possession or reading format. This is a
callable evaluation path, not a reader-facing feature, persistent review queue, or LLM integration.

The existing production ISBNdb enrichment adapter is unchanged. This branch neither enables it
nor verifies deployed flags. No new Supabase secret, migration, or deployment is needed.

## Verification

- Focused supplement tests: 26 passed, including CLI execution, dry-run credential isolation,
  strict identity, preservation/conflicts, aggregate retention, request pacing, failure stops,
  redirect refusal, malformed/oversized responses, request budgets, and conflicting long-title
  qualifiers. After adding the long-title guard, all 279 trial-package tests and scoped lint passed.
- The documented synthetic dry-run command completed with zero HTTP requests and zero writes.
- A separate live implementation smoke used one Google request and one ISBNdb request. An exact
  baseline identity with a controlled empty local metadata state yielded two review-only field
  candidates: one page count and one edition format, with no conflicts. No raw provider content
  was saved. The smoke was executed once more after adding the long-title guard and preserving
  baseline subtitles, with the same aggregate result. These checks verify wiring, not independent
  metadata accuracy, and do not change or rerun the frozen comparison.
- This implementation added two ISBNdb requests (and two Google requests); cumulative ISBNdb
  requests across the earlier pilot/comparison and these smokes are 24. There were no model calls, Exa requests, PRH requests,
  production writes, or qualification runs in this implementation.
- Repository lint, type checking, and build passed. The local build emitted its expected warning
  about committed local-demo Supabase URLs; this was not a production build or deployment.
- Initial full unit run: trial 278 passed; core 2,687 passed; web 863 passed and one failed. The failure was
  the unchanged `AppRoomPreview` test exceeding its 5-second timeout. It was not rerun to obtain
  a green result. The workflow integration test, skipped by the failed chained web command, was
  then run separately and passed (one test). The repository unit gate remains red.
- The local reset applied migrations and seed but its final Storage health check timed out.
  Storage subsequently became healthy without a code change. The full browser suite then started
  under the shared stack lock against that freshly reset local database: 269 tests, default one
  worker, retries zero. Final browser results are pending.

## Remaining gates

Before exposing candidates to users or an LLM, add a reviewed baseline acquisition/provenance path
and test representative editions, contributor variants, translations, audio, and conflicting
formats. Do not turn the development input's provider label into a trust assertion. Precision,
abstention, incremental useful fills, latency, and request counts need a larger evaluation.

Account-specific storage and redistribution rights and retention/deletion controls must be
reviewed before persisting provider values or promoting this to production. The trial's
aggregate-only retention is an intentional boundary, not a conclusion about subscription rights.
The five-field comparison result does not justify a public catalog mirror, training corpus,
vector/graph index of restricted responses, or a resale service.
