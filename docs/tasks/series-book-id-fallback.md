# Hardcover series lookup by verified book identity

## Problem and scope

A stored search label can differ from a provider's current relational name. An exact-name miss is
not necessarily an outage and is never proof of standalone status. The September 10 read-only
diagnosis found one exact book whose single direct series link used a shorter name than its stored
candidate label. No fuzzy aliases or new provider/model are needed to retrieve that relationship.

The existing series Edge Function retains name lookup as its first step. The browser classifier and
durable sweep may add `hardcoverBookId` and the target title only from an explicit
`hardcover:<id>` or `hardcover:book:<id>` enrichment work reference. Corpus UUIDs, edition references
and series references are not converted. The sweep's `workId` remains its corpus authorization ID.

## Fail-closed fallback

- Only a valid HTTP-200 GraphQL response with an empty exact-name series array admits fallback.
  Missing tokens, authorization errors, HTTP failures, timeouts, GraphQL errors and name ambiguity
  stop without fallback.
- The direct book response must match the requested numeric ID, exact normalized full title and
  expected full author anywhere in its contributors. Subtitle, initials and surname-only matches
  cannot pass. IDs are positive GraphQL 32-bit integers.
- Exactly one direct relationship is required. Duplicate or competing links remain unresolved,
  even if one label resembles the old candidate. No first/largest-series selection or pagination.
- Fetch the selected series by its series ID. Require that ID and name to agree, and exactly one
  published relationship row with the original book ID and exact title/full author. Ordinary
  mixed-edition deduplication and slot-collision/collection guards still apply.
- Caps are sentinel limits: 51 contributors, 21 book relationships and 201 series relationships;
  reaching a cap fails unresolved. At most three upstream calls, each with a five-second deadline,
  with no automatic retry. Successful name lookups make only the original one call.
- Opt-in requests use `series-book-v1:[name,author,bookId,title]`, separate from the existing
  case-sensitive name-only cache. Ordinary name results are still reused across book locators;
  only fallback responses enter the book-scoped cache. Success TTL remains 24 hours and failures five minutes. No old
  cache rows are deleted or read as fallback evidence.

## Classification and writes

The response carries the canonical series name and series ID, separate from the book locator.
Neither `books_count`, returned row count nor maximum position becomes a declared length. Browser
and durable classifiers retain both the old candidate label and the actual relationship evidence.
This can yield a positive membership proposal, but the existing database RPC still queues a
conflicting stored name or position for administrator review. It does not automatically declare
the two labels aliases or rename shared/personal rows. Existing reader/import choice protections,
singleton review, low book-identity abstention, and source-conflict rules remain intact.

No migration, SQL backfill, trial runtime, qualification lock, model, provider subscription, or
production data mutation is part of this patch. No live recovery script is committed. A stopped
owner batch remains consumed; after deployment, any continuation needs a freshly reviewed exact
scope and must understand that a recovered canonical name can save as review rather than confirmed.

## Verification and rollout

Handler tests execute the real Edge handler with all HTTP intercepted; fixtures are synthetic,
not qualification data. They cover canonical-name recovery, exact identity and contributor checks,
ambiguous/duplicate links, reached limits, graph changes, source errors, deadlines and cache isolation.
Browser and durable-step tests verify request wiring, unchanged corpus authorization IDs, and both
candidate and canonical evidence. The existing database suite verifies stored-name conflict review
and preservation of reader choices. Full gate and fresh-database browser results are recorded in
the PR before readiness is claimed.

After public merge and private sync, the owner deploys the series function and web build through
the existing guarded workflow. No migration is required. New callers against the old function
remain unresolved on name misses; old callers against the new function retain name-only behavior.
Do not enable a general catalog sweep to verify this change.
