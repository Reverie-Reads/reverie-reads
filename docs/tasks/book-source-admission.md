# Source identity and edition admission

Second in the owner-approved September 12 correction sequence, following reliable shelf additions.

## Behavior

- Enrichment checks every returned provider record. A matching input ISBN alone no longer grants high confidence to unrelated title-search results.
- Open Library ISBN lookup reads the exact edition and resolves every declared author (at most eight). Wrong/competing ISBNs, incomplete authors, contradictory titles, and ambiguous or capped work results remain unresolved.
- Title/author work lookup uses exact full contributor agreement. A declared subtitle can match its combined title; arbitrary suffix stripping, surnames and search series labels cannot upgrade identity.
- Work summaries may provide title, authors, cover, description and categories. Median pages, work publication dates, first language, arbitrary edition IDs and selected ISBNs stay out. Search series labels cannot create membership.
- Selected edition fields come from the exact edition. Dates preserve valid whole tuples and original precision, including month-name dates. No January 1 from year-only input or cross-source year/month/day combinations.
- HTTP errors, malformed/oversized bodies, incomplete author requests and HTTP-200 GraphQL errors remain failures. Partial responses can retain independently admitted peer fields, but are not cached as completed acquisition. Requests and author fanout are bounded.
- `identity-admitted-v2:` replaces the previous enrichment cache namespace without deleting historical rows. ISBN cache entries include the requested title/author; stale entries or records without versioned admission cannot be reused. Maintenance promotion verifies identity and freshness, preserves existing ISBN sets, and retains the cross-work collision stop.
- Personal automatic merge requires a unique compatible ISBN or exact full title/contributor. Contradictory ISBN identities, surnames, series labels and competing candidates never auto-merge. The existing Add/import review and explicit single-add keep-separate behavior remain. Stored reader verdict keys are unchanged.

## Verification and rollout

Synthetic actual-handler tests intercept all outbound HTTP; no provider acquisition, production cache mutation or historical repair is part of verification. Core/Edge parity tests cover the shared admission behavior. The final receipt must include code gates, Deno checking and the fresh-database full browser run.

Deploy the public change through the private upstream sync. The `enrich` function changes and needs the normal owner function deployment after merge. No new migration in this patch. Save-boundary metadata continuity follows as the next separate change; existing catalog repair waits for that verification and a concrete owner review.

## Source reference

Open Library distinguishes works and editions and documents ISBN access to edition JSON: [Books API](https://openlibrary.org/dev/docs/api/books), [Search API](https://openlibrary.org/dev/docs/api/search). These references describe record scope, not guarantees of catalog correctness.
