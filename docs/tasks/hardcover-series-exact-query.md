# Hardcover exact-query compatibility and mixed-series evidence

## Observed failure

On September 10 the owner-run five-work lookup diagnostic stopped on its first request with
`http_error` / 403. A read-only cache timestamp check placed that failure inside the run;
all five work rows remained unresolved with null check times, and no sweep ran.

In Hardcover's API explorer, the owner confirmed that `series(limit: 1) { id }` succeeded.
The production-shaped relationship query returned `ilike and related operations are not
permitted on this server.` Replacing only `_ilike` with `_eq` returned the relationship and
the exact target title/author/position. Missing `read:me` affected an unrelated profile
diagnostic, not the catalog query. No credential rotation or permission expansion is justified
by this evidence. These observations establish query incompatibility, not every historical
provider failure's cause or a verified post-fix production deployment.

## Implementation

- The series and sibling book-tag queries now use `_eq`. No wildcard/operator substitution,
  lowercase/title-case guessing, search fallback, extra provider, or extra upstream call is added.
  A differently cased or unrecognized candidate remains unavailable/unresolved.
- Exact name/author request keys live in `series-exact-v1:` and `booktags-exact-v1:`. New semantics
  cannot reuse legacy first-contributor or inflated-count payloads. Historical rows are neither
  deleted nor rewritten; normal 24-hour success and five-minute series-failure lifetimes remain.
- A known contributor may appear anywhere in the provider list. Multiple same-name relationships
  are unavailable with a fixed `ambiguous_relationship` diagnostic instead of choosing the largest.
  Book-tag lookup no longer falls back to an unrelated author.
- `membershipEntries` retains deduplicated title/contributor observations for exact-work matching.
  Conflicting ordinals for the same identity become unknown. It is not a canonical roster.
- `entries`, the existing personal-source seeding input, contains only unambiguous positive
  whole-number slots. Different titles at one ordinal are all withheld; no translated edition or
  boxed set wins by response order. Obvious collection labels are also withheld. This is conservative
  collision handling, not a complete multilingual edition/collection resolver.
- Browser and durable-job classification consume membership observations, not the shelf subset.
  Hardcover matching requires the normalized full title and full supplied author, not a subtitle
  prefix or an initial/surname guess. Its reported `books_count` and returned-row count never become
  declared series length or evidence cardinality. Distinct positive whole-number ordinals can
  supply existing membership context but do not establish completeness. Singleton/conflict review,
  source-unavailable behavior, and reader/import protections remain in place.

The owner's example contained translations and sets at positions 1 and 2 plus unnumbered rows,
while reporting `books_count: 3`. That is why neither raw number can be treated as a series length.
Tests use a synthetic equivalent shape, not public authority gold or qualification identities.
No stored catalog count, existing personal entry, qualification lock, or consumed study is repaired
by this patch. Existing incorrect records require a separately reviewed owner action.

## Release and verification boundary

This changes the `series` Edge Function and the web/browser plus durable-job consumer. There is
no new migration. Merge through the normal public PR and private-sync gates; release matching web
code and owner-deploy only `series` using the existing guarded deployment command from clean private
main. Neither deployment is performed by Code. Keep completion/source refresh paused until both
deployments are verified: an old classifier still infers length from returned rows, and an old
function still returns mixed shelf rows. A partial rollout does not clear the data-quality gate.

The consumed browser diagnostic must not be blindly rerun: its old `entries` assumption predates
the split response, and its replay marker remains intact. Prepare a separately reviewed follow-up
after release verification, inspecting membership observations without confusing them with safe
shelf slots. Stop on provider failure and do not start a general sweep. A successful lookup still
does not prove classification persistence or authorize resetting the remaining outage inventory.

Validation results are recorded in the PR; all provider tests intercept outbound HTTP. No live
provider acquisition, production database mutation, permission change, or billing action is part
of this implementation.
