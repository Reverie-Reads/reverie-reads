# AGENTS.md

Context for coding agent. Read this first, then `docs/reference/DATA_MODEL.md` before touching anything
that stores a book. `docs/archive/CODING_AGENT_KICKOFF.md` is the original build plan — history now,
not a to-do list. Keep this file updated as the project evolves.

## What this is

Reverie — a personal library app behind a skinnable, **genre-neutral** interface: nine
distinct skins (romance, fantasy, sci-fi, horror, mystery, literary, cozy, nonfiction, YA)
that reskin the whole app to the shelf you're in. It handles intensity levels, tropes, moods,
series gaps, rereads, per-format ownership, cover sourcing, offline caching, and a book-club
layer, and ranks what to read next against _your_ library rather than aggregated ratings.

It **began** as a romance / romantasy / dark-romance app with a gothic New Orleans look, and
that heritage survives as the Tryst skin. Do not write romance-only vocabulary, defaults or
logic into shared code — #69 and #72 de-romanced the taxonomy, the Match quiz and the copy.
Genre-specific language belongs in a skin, not in the core.

## Status & your job

- **Book data serves the reader app first (owner, September 9).** A public book-data provider/API
  is a possible later product after the app gains users, not a launch dependency. Keep provider
  comparison #521 draft; plan edition comparison as a Pro reader feature, not an admin-only
  product. Defer its live connection and optional edition editor. Pro access never grants shared
  catalog edit authority or removes basic data quality and existing corrections from Free. Reuse the
  existing catalog, review controls and semantic matching; do not add a shared vector/graph store
  or additional providers without a demonstrated app need. The next step is the smallest useful
  human-review handoff from existing evidence, not autonomous catalog writes. Existing trial-only,
  qualification, retention and owner-write gates remain unchanged. See
  `docs/tasks/app-first-book-data.md`.
- **The real app is built and shipped.** `apps/web` + `packages/core` + `supabase/` are the
  product; work happens there, on a feature branch, behind a PR.
- `prototype/Reverie_Library.html` is **historical reference only** — the original feature
  source. The shipped app has long since passed it (skins, moods, tropes-as-join, four-state
  ownership, series entries). Where they differ, the shipped app is right; do not "restore
  parity" with the prototype.
- Design: canonical tokens/components in `design/DESIGN_SYSTEM.md`; the genre-neutral public brand
  is scoped in `apps/web/src/styles/brand.css`, while examples and app backgrounds share the
  room renderer in `apps/web/src/components/roomScene.ts`. Install and share assets are generated
  from the accepted mark and brand palette by `apps/web/scripts/generate-brand-assets.mjs`. Design
  exports, if any, in `design/from-design-tool/`.

## Stack (decided — don't re-litigate without asking)

- **Monorepo**, pnpm workspaces.
- **Web:** React + TypeScript (strict) + Vite + Tailwind (design tokens) +
  TanStack Router + TanStack Query. Light UI state via Zustand. Offline cache via
  IndexedDB (Dexie).
- **Backend:** Supabase — Postgres, Auth (email magic-link + OAuth), Realtime, Storage,
  Edge Functions.
- **Data layer:** Supabase client + TanStack Query with optimistic writes. Start with
  query-cache; add the Dexie offline mirror + background sync incrementally
  (local-first is the goal, not the v1 blocker).
- **Tests:** Vitest (unit), Playwright (e2e). **Lint/format:** ESLint + Prettier.

## Layout

```
apps/web/            React app (UI, routes, components) + Playwright e2e
packages/core/       shared TS types + pure logic (merge, CSV import, spoiler gate, skins,
                     covers, taste) — everything testable without a browser
packages/series-source-trial/ reproducible provider, resolver, and authority-source acquisition
                     evaluation; reads local secrets, never writes Supabase or treats search
                     labels/model output as membership evidence
supabase/            migrations, edge functions, seed
prototype/ data/ design/ docs/ backend/   ← reference material, not shipped
```

## Where the answers live

- Features to match → `docs/reference/FEATURES.md`, `docs/reference/REQUIREMENTS.md`
- Architecture & API surface → `docs/reference/ARCHITECTURE.md`
- DB schema & object shapes → `docs/reference/DATA_MODEL.md`
- Design tokens, type, motion, components → `design/DESIGN_SYSTEM.md`; the nine skins'
  token sets live in `packages/core/src/skins.ts` + `apps/web/src/styles/tokens.css`
- Decisions with a rationale → `docs/decisions/` (ADRs)
- Cover/metadata/release data sources → `docs/reference/DATA_SOURCES.md`
- Sharing & book-club design → `docs/reference/SHARING.md`
- Seed data → `data/corpus_seed.json` (bibliographic, CC0) + `data/reader_seed.json` (this
  reader's own data, not published, not licensed), 290 books joined by `id` — split from the
  single `personal_seed.json` in the pre-public-licensing pass so the CC0 corpus dedication in
  `LICENSE-CORPUS` scopes to a file, not a field-kind boundary inside a mixed one. Design-ready
  subset in `data/design_corpus_seed.json` + `data/design_reader_seed.json` (same split, same
  reason — `data/reverie_design_seed.json` carried the identical bibliographic/reader-data
  blend and was split the same way in `chore/split-design-seed`)

## Conventions

- TypeScript strict; functional components + hooks; small, focused modules.
- **No hardcoded colors** — use the design tokens (CSS vars / Tailwind theme). There are
  **nine skins**, not two themes: `tryst`, `grimoire`, `aphelion`, `marrow`, `umbra`, `folio`,
  `hearth`, `almanac`, `bloom` (`packages/core/src/skins.ts`), each with its own token set and
  its own light/dark pair; `mode` is light/dark/system, independent of the skin. "Nocturne /
  Magnolia Dawn" is prototype-era naming and no longer names anything in the code.
- Mobile-first; responsive to desktop.
- Accessibility is part of done: visible keyboard focus, adequate contrast in **every skin** in
  both modes, and **respect `prefers-reduced-motion`** (disable the night-sky drift/twinkle).
  Two layers guard contrast, and they cover different amounts: the **core contrast tests** are
  keyed off the `SKINS` registry, so all nine are checked and a new skin fails until it has
  tokens; the **e2e axe sweep** runs four (`tryst`, `grimoire`, `aphelion`, `marrow`) × both
  modes. A new component's contrast belongs in a registry-keyed core test — that is the layer
  that is exhaustive.
- **First paint requires a complete appearance.** A valid local non-Adaptive room plus mode may
  open immediately and reconcile later. A missing or invalid axis, or Adaptive without its
  profile-only palette, stays in the neutral Reverie front-door material until profile hydration
  applies room and mode together. Never reveal the signed-in shell while
  `data-appearance-pending` remains on the document. A profile failure must offer an explicit retry
  and default-room escape without implying that library data was lost.
- **Port, don't rewrite** the prototype's already-tested logic: the merge engine, the
  Goodreads/StoryGraph CSV importer, and the spoiler-gating rule (`comment.unit <=
myProgress`). Move them into `packages/core` with tests.
- Copy stays sentence case, plain verbs, no filler; empty states invite action.
- **Possession is five independent flags, and every shelf is a derived view.** `ownership` is
  `'owned' | 'unowned'` (default `unowned`) and answers only _do you own a copy_. `borrowed`
  and `wishlist` are **flags beside it, not values inside it** — all combinations are legal
  ("own the paperback, borrowed the audio, still want the special edition") and the schema
  constrains none of them. `owned: {physical, ebook, audiobook}` answers _which formats_ and
  only means anything for a book **in hand**. Ask `isPossessed` (= `owned || borrowed`) or
  `bookOwnedFormats`; **never infer possession from the `owned` booleans** — `all-false =
wishlist` was the pre-#68 model and is long wrong. Format flags **suppress, never clear**, so
  drop → re-acquire loses nothing. A control that must show one word uses `possessionState()`
  (owned > borrowed > wishlist > unset) and writes back through `possessionPatch()`; both are
  views, never stored. The **Owned · Physical / Ebook / Audiobook** shelves are _smart shelves_
  derived from possession — not manual lists. Possession is independent of the format read in
  the reread log, and never gates reading history.
- **Household catalog membership is not a personal copy.** An active household member may add an
  existing corpus work—or create one attributed provisional identity—directly to `household_works`
  without creating `books` or implying owned/borrowed/wishlist/read state. Existing corpus metadata
  is editable only by a household owner or corpus administrator. Routine edits to an active
  personal row stay personal; the existing fill-only removal/account-deletion preservation may
  still populate missing objective corpus gaps before the last source disappears, but series is no
  longer treated as objective without relational evidence. Trusted corpus
  series/position/count is a default for personal rows only while their claim remains
  unknown/enrichment/corpus and the reader-choice guard is false; reader and CSV-import choices are
  never overwritten. A personal owner must explicitly choose “Use shared details” for genre, cover,
  and publication fields; that same deliberate action may replace a personal series choice with the
  shared series. Neither path changes title/contributors, ISBN, possession, reading history, rating,
  or private annotations.
- **Series classification is corpus-first, relational, and default-only.** A search result's series
  label is never membership evidence. Automatic classification must find the exact work inside a
  provider relationship, keep book-identity confidence separate from membership confidence, and
  retain its evidence/reason. A singleton or source conflict waits for corpus-administrator review;
  unavailable is unresolved; a missing label is an observation, never proof of standalone status.
  The database must preserve an explicit unresolved outcome even when the confirmed series name is
  null; a null name with candidate/outage evidence is not a successful no-label observation.
  Historical outage repair is owner-run and fingerprint-scoped, separate from migration; see
  `docs/tasks/series-unavailable-recovery.md`.
  Trusted corpus series seeds household display directly and only replaces personal
  unknown/enrichment/corpus defaults—never a reader or CSV-import choice. Fantastic Fiction may be
  retained only as membership/name/order corroboration and never auto-promotes by itself; do not
  scrape it without written permission or a supported feed. Re-confirming an unchanged trusted
  corpus tuple is still a reconciliation event: it must repair eligible personal defaults and their
  structured membership rather than becoming a tuple-equality no-op. See
  `docs/reference/DATA_SOURCES.md`.
- **LLM resolution consumes cleaned evidence; it never upgrades source risk by itself.** In the
  trial, Google is identity-only; open graph claims require exact-work relational evidence;
  Inventaire `wd:` mirrors retain Wikidata lineage; and an ordinary exact-work, non-singleton
  Hardcover relation remains a candidate until independent open relational evidence agrees.
  Self-titled Hardcover relations, universe groupings, reading-, publication-, chronological-, and
  recommended-order containers, fractional Hardcover positions, and competing relationships are
  review-only; current community-source order needs independent agreement. A first-pass authority
  scout may join the resolver packet for review, but cannot upgrade a Hardcover-only candidate. The
  optional no-write authority join admits only a selected, policy-safe, hash-checked retrieval from
  a human-reviewed origin as relational evidence. Wikidata entity URLs and Inventaire `wd:`
  identifiers normalize to the same lineage. Unknown providers cannot corroborate until profiled.
  The model may select, explain, review, or abstain, but only deterministic eligibility can make a
  proposal automatic and only affirmative authority evidence can establish standalone status. The
  model uses strict structured output, has no Supabase write path, and cannot invent a field or
  citation absent from the packet.
  Inventaire, BookBrainz, and the resolver stay trial-only until the reviewed accuracy,
  standalone-safety, rights, privacy, latency, and cost gates pass. See
  `docs/reference/DATA_SOURCES.md`.
- **LLM authority-source acquisition is a separate, truth-blind shadow capability.** The scout gets
  only title, author, and optional publication year; uses bounded live search; and proposes cited
  author/publisher evidence. It does not receive the case truth, known authority URLs, sample
  sources, or provider packet. Deterministic validation requires every cited URL to appear in the
  API's consulted-source manifest, blocks the case's selection-frame URLs from establishing its
  classification, and quarantines known conflicting marketing taxonomies. A grounded URL proves
  consultation, not source eligibility: the model cannot declare its own evidence authoritative.
  Link hubs and known discovery-only domains cannot establish classification. A blocked or risky
  source is demoted to identity-only; an independently supported claim may survive, but a claim
  that depended on that source must not. Professional-association member directories and
  unverified profiles on hosted discovery platforms are discovery-only, not author-controlled
  evidence, even when the model labels the source `author`. Unmapped translated-edition series
  labels, storefront titles that invert the work and relationship names, and profiled catalog
  contradictions remain review-only. “Standalone” language means reading independence when the
  same authority also assigns a bibliographic series; an unlabelled genre, trope, world, or
  trigger-warning heading is not series evidence. A spin-off, companion, shared-character, or
  same-world statement cannot be reversed into membership for the related work; require separate
  direct evidence. Output stays review-only and cannot write authority gold, Supabase, or the
  corpus. See `docs/reference/DATA_SOURCES.md`.
  A review, endorsement, blurb, testimonial, retailer description, or quotation remains
  third-party evidence when reproduced on an author or publisher page. Preserve the attribution in
  the evidence summary and demote its classification support; first-party hosting does not turn the
  quoted speaker into the page owner.
- **Production qualification is private, locked, and single-use.** Never append qualification
  identities or truth to the public development gold file. Build the reviewed oversample under
  ignored `private-results/` from complete identity frames whose population, eligible, and
  exclusion counts reconcile; select it only through the committed deterministic plan, and commit
  the non-secret dataset/system lock before the run. Ordinary acquisition excludes qualification
  cases. Qualification requires the exact frozen Luna-low plus Exa configuration, an isolated
  cache, and the $10 Exa ceiling; partial selectors and refresh are forbidden. Resume is only for
  incomplete infrastructure failures against the same lock. A completed run cannot be repeated,
  and any inspected failure used to change the system burns that holdout into development. See
  `packages/series-source-trial/reports/authority-qualification-design-2026-09-07.md`.
- **Exa is a shadow locator, never authority evidence.** It receives the same truth-blind title,
  author, and optional publication year, and may compare result URLs with reviewed sources only in
  memory. Persist aggregate recall/cost/latency/error metrics—never Exa responses, result titles,
  snippets, URLs, domains, queries, request IDs, or case-level provider output. The opt-in fallback
  runs only after Luna is unresolved or policy-quarantined, ranks at most eight non-discovery-only
  domains in memory, and gives them to a separate bounded Luna hosted-search call. Only URLs in
  Luna's own consulted-source manifest may ground that proposal; safe resolved first passes make no
  Exa request. Exa output cannot become identity, membership, position, standalone, provider,
  resolver, retrieval-profile, Supabase, or corpus evidence. A generic-only membership label such
  as `series`, `trilogy`, or `duology` is policy-quarantined because it does not name a bibliographic
  series. The completed 18-work development result does not clear rights, privacy, retention, cost,
  or locked-qualification gates. See `docs/reference/DATA_SOURCES.md`.
- **Navigation-aware authority retrieval is a bounded trial primitive, not a crawler.** Only an
  exact URL from the scout's consulted-source manifest and a current, human-reviewed origin profile
  may enter it. Every DNS answer and redirect hop must remain public and profile-approved, and the
  validated DNS result is pinned to the TLS connection. Robots denial, network/5xx failure, an
  unsafe URL, ambiguous navigation, timeout, request/size/type failure, or missing profile returns
  unresolved—never standalone; an RFC-defined 4xx absence still requires an approved profile. Every
  actual redirect hop uses that hop's origin-specific robots policy. The retriever fetches one
  parent and at most one deterministic same-origin child, loads no subresources or JavaScript,
  retains no raw page text in reports/caches, and has no Supabase or corpus writer. The optional
  `--retrieval` trial path invokes a second strict-output, no-tools model call only for unresolved or
  quarantined first-pass cases; it can cite only the retrieved child and the reviewed profile owns
  source kind. The packet is hash-checked and must contain the exact target title and author before
  interpretation; proposed identity, series names, standalone language, and positions must also be
  present in the packet before selection. Unsupported retrieved position is cleared and unsupported
  membership role becomes unknown without discarding otherwise direct membership. A repeated
  numbered catalog-heading pattern may count as relational structure only when the current
  human-reviewed origin profile explicitly grants that finite evidence capability, the gateway
  binds it into the retrieval manifest, and the current profile still matches before provider
  evidence is emitted. Page text is redacted before persistence. When one reviewed origin
  contributed several consulted URLs, select
  a shallow catalog-style hub before its homepage or a detail page so the single child hop is spent
  on exact-title evidence; source kind, depth, and lexical order remain deterministic tie-breakers.
  The repository activates only the owner-reviewed, time-boxed `authorljshen.com` and
  `smdaviesauthor.com` trial profiles through 2026-10-07, and only in this no-write trial path. The
  S. M. Davies profile alone grants `repeated_numbered_catalog_headings` after its bounded technical
  access review; it still cannot inject a URL into truth-blind discovery or write a result. See
  `docs/decisions/0009-authority-retrieval-gateway.md`.
- **The selective ISBNdb supplement is trial-only and gap-targeted.** Exact baseline returned-ISBN,
  full-title, and full-author agreement precedes paid requests. Current/baseline values win; only
  page count and edition format can become ephemeral review candidates, never possession changes.
  The CLI emits aggregates only and has no LLM or corpus writer. Do not enable the legacy production
  ISBNdb adapter from this trial result. The acquired-baseline benchmark fetches Google and Open
  Library in memory; both attempts must complete before a paid lookup, and either provider's
  identity/edition ambiguity blocks it. Resolve all Open Library edition authors, never a partial
  list. Google preview/ebook availability is not edition binding. Reference facts score candidates
  but never enter acquisition or manufacture a gap. See `packages/series-source-trial/README.md`.
  The separate opt-in `metadata:review` development evaluation may compare an existing baseline
  page observation after the same admission/completion gates, using a fresh frozen frame with
  purpose `development-page-review`. It does not change gap-only routing. Its per-field packet is
  memory-only and has no LLM or writer: retain eligible format fills independently from page
  conflicts, protect current values, and emit only aggregate comparisons, never a chosen correction.
  The separate `metadata:value` subscription evaluation independently admits each provider against
  the reviewed input identity; ISBNdb no longer depends on a free-provider match in that command
  only. Compare free-only, selective, and ISBNdb-first policies without reference truth in routing.
  Publisher, numeric-precision publication date, and language join pages/binding as ephemeral
  factual observations. Cover/description/other-edition availability is never quality or a reuse
  license. Deduplicate economic benefit by reviewed work group, penalize regressions and incorrect
  values, and label monthly projections as scenarios, not observed savings or a renewal decision.
  Preserve old commands' admission/routing and keep qualification and production adapters untouched.
  The `metadata:study` wrapper locks a complete private frame and deterministic, work-preserving
  cohorts of at most 20 editions. Live execution requires at least 100 distinct works, the committed
  lock and matching runtime. Its Git-common-directory attempt markers span worktrees; failed or
  interrupted cohorts are not retried, and repricing the same ISBN set cannot reopen it. Only a
  complete, unique set of validated cohort aggregates permits an economic projection. Hashes do not
  certify source truth or rights; historical/qualification overlap and source review remain gates.
  The owner authorized one bounded evaluation before further ISBNdb contact on September 9.
  Public `--run` admits only its committed 100-ISBN/100-work set, before credential loading;
  no flag overrides this restriction. Cohorts advance in order and cannot reset provider
  authentication/quota/infrastructure stops or failed attempts. Do not use older commands or
  injected primitives to evade these boundaries. This is not production rights/retention clearance.
  See `reports/isbndb-source-use-review-2026-09-08.md` and the September 9 study plan.
  That study is complete: selective use improved 38/100 works but regressed 20 under the broad
  join. The owner's final decision drops ISBNdb from the planned source stack because its benefit
  does not justify retention/subscription dependence, superseding the report's initial targeted-keep
  recommendation. No further paid acquisition without new owner approval. The study changed no
  billing or runtime; the subsequent retirement section below governs the adapter/cache cutover.
  Do not infer hosted configuration or existing data holdings from the study.
  Its frozen set is consumed; preserve its locks and attempt markers, never reacquire it from another
  clone. See `packages/series-source-trial/reports/isbndb-value-study-results-2026-09-09.md`.
- **Edition-page evidence stays trial-only and field-specific.** `metadata:pages` requires one
  unique exact-ISBN/full-title/full-author Google search candidate, then revalidates one detail
  response and its safe ID/language. Only positive integer detail pages may join the existing exact
  Open Library edition path; search pages, work medians and printed-page fallback cannot vote.
  Agreement does not establish independent lineage or automatic eligibility. Conflicts and current
  values stay protected; unavailable is unresolved. Memory-only packets produce aggregate-only
  reports with no production/cache/model writer. Live input must exclude the hash-authenticated
  consumed study and human-reviewed development/qualification overlap. Never modify the consumed
  study runtime or attempt state to run this separate path. See `docs/tasks/google-edition-diagnostics.md`.
- **Metadata assessments do not merge identities.** `/catalog/metadata` compares exact normalized
  title/full-author and valid equivalent ISBN candidates. Only the explicit description action may
  edit shared metadata, after identity confirmation and a source/note; it never invokes the broad
  editor's manual-series intent. Assessments and deferrals keep administrator-only history, guarded
  by work/evidence fingerprint plus review revision. Never infer a safe shared-work merge or ISBN
  reassignment from a duplicate candidate. See `docs/tasks/catalog-metadata-review.md`.
- **Corpus cover recovery is bounded, resumable, and independent of classification.** The
  administrator completion pipeline never walks the whole household library in one RPC. It calls
  `admin_recover_corpus_cover_batch` in groups of at most 25, records a source fingerprint after
  every success or deferred failure, and interleaves those batches with metadata/series work. A
  failed or timed-out recovery batch is reported beside the control but must not prevent the
  classification batch from advancing. Failed rows receive a retry window so one bad source cannot
  starve the queue; changing its objective or cover fields makes it eligible immediately.
  Workflow step proxies must be called as standalone bindings, never as methods on an injected
  callback object: WDK serializes a step call's `this` receiver, and a receiver containing another
  function fails before the first checkpoint. Keep the compiler-backed Workflow integration test in
  the ordinary web test command; unit calls treat `use step` as a no-op and cannot catch this class.
- **Cover normalization has one decoded-image owner.** The `covers` Edge Function decodes source
  bytes once, records the encoded source dimensions, applies orientation, then produces the 1,600px
  full image, 720px card image, and 64px color sample by resizing the same image downward. Do not
  reintroduce repeat source decodes or full-resolution clones: the former exhausted local worker CPU
  on a measured 2,400x3,600 upload and the latter slowed the actual 800x1,200 upload boundary. Keep
  the existing no-upscale behavior, 82/78 WebP quality, metadata stripping, fail-soft color, and
  separate trace stages. See `docs/tasks/cover-pipeline-efficiency.md`.
- **Catalog cover review is explicit and shared-only.** `/catalog/covers` reads bounded pages of
  shared works; only corpus administrators can save decisions. An approval is bound to the exact
  identity/cover fingerprint and review revision. Changed records require a fresh review. Browser
  dimensions are observations, never edition certification. Replace through `set_corpus_work_cover`
  inside the review transaction; never update personal covers or bibliographic choices as a side
  effect. Administrator notes/history stay outside the offline cache. See
  `docs/reference/COVER_SOURCING_AND_STUDIO.md`.
- **Shared order reviews preserve membership provenance.** Existing-slot position corrections or
  clears require a source page and explanation through the revision-checked
  `review_corpus_series_entry_order` RPC. Store rationale only in the administrator audit, never in
  shared entry claims or the offline cache. A saved citation is historical evidence, not automatic
  source qualification; show its reviewed position separately from the current one. Only a primary
  linked slot updates the work projection, using the existing default-only reader-choice guards.
- **Structured rows own personal series membership.** `series` + live `series_entries` are the
  authority; `books.series`, `position`, and `series_count` are a compatibility projection of one
  explicit `is_primary` entry. A book may have multiple live memberships, but at most one primary;
  secondary membership/order never rewrites the primary projection. Membership provenance and
  position provenance are separate claims. Historical rows stay `origin=unknown` and non-primary
  until explicit review—opening a series page is always read-only and never creates, revives,
  orders, merges, or promotes anything. Removing a secondary leaves the primary intact; removing
  the primary clears the compatibility tuple and never guesses a replacement.
- **Missing series metadata is unknown, never evidence of a one-book series.** Shared corpus series
  discovery has its own state and recheck clock (`works.series_check_*`): a matched catalog record
  that returns no series becomes `no_series`, not a standalone assertion. Only high-confidence
  positive evidence may fill a blank; medium-confidence matches and every conflict wait in
  `work_series_suggestions` for corpus-administrator review. Personal copies still adopt reviewed
  shared series details explicitly. On reader surfaces, the count of currently known/owned entries
  is not the series length—render “of N” only from an explicit length or additional canonical slots.
- **`isBookRead` and `hasReadingHistory` disagree on DNF on purpose.** `isBookRead` feeds series
  progress, taste and stats, where an abandoned book must not count as read. `hasReadingHistory`
  adds DNF and feeds **visibility only** (`inDefaultLibrary`), so a book you started and gave up
  on stops being invisible. Do not collapse them.
- **Next read separates candidate scope from taste context.** Reader-facing `/match` is Next read.
  Build taste/series context from the full personal library hydrated with actual read logs
  (`useReaderBooks`), then select candidates with `nextReadCandidates`. Available means owned OR
  borrowed; latent format flags do not count. Rereads and stopped books are independent opt-ins;
  active reads stay on Home. Every start/resume entry point uses `beginReadingPatch` where it has
  a Book, preserving possession and completed history. Finishing appends a completed read before
  marking the current read finished; retrying only a failed status update must not append again.
  Mood search returns a bounded shortlist, so label supplemental library picks honestly and apply
  saved feedback to semantic ordering too. Appearance never supplies a Discover genre filter.
- **Discover chooses a few books beyond the personal library.** The guided page uses a chosen
  book, one or two moods, or an explicit genre; appearance never supplies intent. Corpus identity,
  canonical ISBN, and unambiguous exact title/contributors determine personal relationships.
  Reasons must be supported by actual author/genre/description evidence; semantic ordering cannot
  invent themes or ignore a selected mood. Preserve shortlist order through detail/Add navigation.
  Deliberately saved sessions belong to `discovery_sessions`, with owner RLS, bounded snapshots,
  backup/restore coverage, and account-deletion cascade. Opening a preview or saving a shortlist
  never creates a personal book. Series invitations require active personal membership and confirmed
  shared work/order evidence, suppressing removed categories, uncertain order, and private reordering.
- **Discover quality is evidence-bound.** Balance bounded query groups before the candidate cap;
  exclude any held matching copy even when personal detail navigation is ambiguous. An incomplete
  semantic batch must not outrank unscored candidates merely because it finished first. Shared works
  with multiple ISBNs do not imply a selected edition. Cover quality labels measure the image that
  actually loaded, never the size of its CSS box; reader replacement remains explicit. Alternate
  cover searches require exact ISBN or conservative title/author identity; search rank alone is not
  evidence. Preserve a working linked-image fallback when saving a reader's choice.
- **Reflect and Planner share recorded history.** Use `useReadingHistory` and the pure
  `buildReadingHistory` / `summarizeReadingHistory` model for period counts. Base book queries do
  not hydrate logs. Current DNF is not a dated attempt, a Read flag is not a synthetic session,
  and missing finish dates stay outside a selected year. Formats come from read logs, genre
  buckets deduplicate within each read, and return counts preserve earlier-period context.
  See `docs/tasks/reading-life-implementation.md` for the precision and legacy-data boundaries.
- **Personal reading progress is one deliberate whole percent.** `books.progress` remains the
  format-neutral current-place summary. Home, book details, Planner, and the landing guest library
  use the shared explicit progress editor: changing the slider, step controls, or exact field edits
  a draft; only Save writes. Failed writes keep the draft for retry, and 100% alone never logs a
  completion. `reading_now_hidden` hides an active read from Home only, not Planner. A paused reread
  with progress between 1 and 99 resumes at that place; a completed reread starts from zero. Do not
  infer page or chapter positions from the rounded percent. Exact pages require an edition-bound
  position and denominator; club chapter/page progress remains a separate spoiler coordinate. See
  `docs/tasks/reading-progress-editor.md`.
- **Personal Realtime carries signals, never library rows.** The signed-in app joins one private
  `library:<reader id>` Broadcast topic authorized against `realtime.messages`. Triggers on books,
  reads, lists, and list items emit only table and operation; the client debounces bursts and then
  refetches through ordinary RLS-checked queries. Unmount/sign-out removes the channel. This speeds
  cross-tab/device freshness but does not replace confirmed-lookup guards or create an offline write
  queue.
- **A reading plan is five fields that move together.** `plan_y/m/d` retain flexible date
  precision; `plan_position` is deliberate membership plus preference order, so non-null position
  with no date means Soon and null position with no date means unplanned. `plan_intention` is a
  private future-self note, never a reading-log note. Reorder one spaced numeric key. Removing a
  plan clears only those five fields and never reading history. Merge decides against the stored
  primary and keeps or adopts the whole object, including Soon. Raw book-row backup/restore and the
  existing IndexedDB mirror own persistence; do not add a second plan store.
- **Calendar and releases preserve uncertainty.** Put exact-date plans in the month grid and keep
  month, year, and Soon plans in separate flexible bands; never invent a day to make an item fit.
  The releases view is a bounded arrivals horizon, not a backlist dump. Keep provider status and
  source labels visible, and route every discovered release through Add for review rather than
  creating or planning a personal book automatically.
- **No aggregate rating.** Never compute or display an averaged star rating anywhere.
  Keep the reader's own rating (`rating` on the book + per-read). Others' opinions appear only
  as an opt-in list of **individual** reviews on the book screen — never a single number.
- **Mass import + mass merge.** Bulk-add (CSV today; bulk ISBN/title) and a bulk
  de-dupe flow that resolves all detected duplicate groups at once (run on import).
  Reuse the ported merge engine.

## ISBNdb retirement

**ISBNdb retirement (owner, September 9).** Production enrichment no longer has an ISBNdb HTTP
adapter; old keys/flags/CSV cannot reactivate it. Enrichment and the owner-run corpus backfill share
the `no-isbndb-v1:` cache namespace, with no fallback to historical mixed-source rows. Historical
source types remain readable, not proof of a live provider. Do not delete old cache or catalog rows
as part of this cutover: incomplete union/personal provenance prevents safe blanket cleanup.
No further paid trial acquisition without new owner approval; consumed study locks stay intact.
Billing, production deployment and any exact-target retention cleanup are separate owner actions.
See `docs/tasks/isbndb-retirement.md` for the read-only inventory and remaining gates.

## Commands

```
pnpm dev            # run web app
pnpm build          # production build (core tsc, then web tsc/vite)
pnpm test           # unit tests (Vitest, all packages)
pnpm e2e            # Playwright (includes the axe sweep — four skins x both modes)
pnpm lint           # ESLint
pnpm typecheck      # tsc --noEmit, all packages
pnpm series:trial -- --scope all --providers openlibrary,wikidata  # provider evidence trial
pnpm series:resolve -- --input <trial-report.json> --scope gold     # no-write LLM shadow trial
pnpm series:authority:acquire -- --scope gold --max 10              # no-write source scout
pnpm series:authority:qualification:freeze -- --input <private-pool.json> # seal private holdout
pnpm db:start       # local Supabase stack   (db:stop / db:reset / db:status)
pnpm db:migrate     # apply migrations + reload the PostgREST schema
pnpm db:seed        # load the dev library
pnpm deploy:migrations   # prod db push — via the deploy guard (main + clean + confirm)
pnpm deploy:functions    # prod functions deploy — via the deploy guard
```

## Shell & deploy safety

- **A migration that changes what a WRITE DOES TO USER DATA gets a human at the keyboard for the
  guard's `y/N` — never a piped `y`.** (Owner rule, 2026-08-15.) The guard's confirmation is a human
  gate; answering it from a script satisfies the letter and removes the thing it exists for. Schema
  that only adds a column, an index, or a grant may be confirmed by whoever is running the deploy;
  anything that alters the OUTCOME of an existing write path — a changed RPC body, a backfill, a
  trigger — waits for a person. A Code session has no TTY, so in practice this means **a Code session
  does not run these deploys at all**: it reports the migration as ready and holds. The precedent
  this corrects: `enrich` was deployed earlier that day with `printf 'y\n' | pnpm deploy:functions`,
  which was authorised and idempotent but is exactly the shape that stops being safe the moment the
  thing being deployed can rewrite rows.

- **Never run a raw `supabase db push` / `supabase functions deploy` against prod.** Go through the
  guard (`pnpm deploy:migrations` / `pnpm deploy:functions`) — it enforces main + clean tree + in-sync
  - a `y/N`. Prod deploys happen from `main` after merge, never a feature branch (override is a loud,
    deliberate exception). See `docs/reference/DEPLOY.md`.
- **Heredocs containing shell examples MUST be single-quoted** — `<<'EOF'`, not `<<EOF` — so backticks
  and `$(…)` inside are text, never evaluated. This applies to any heredoc feeding `gh pr create
--body`, commit messages, or reports. **Same hazard, second host: a backtick inside a JS/TS template
  literal terminates it.** Prose about code, written into a `` `...` `` string — a CSS block in
  `page.addStyleTag`, a prompt, a query — must not quote identifiers with backticks; put the prose in
  a `/** */` block outside the literal instead. (2026-08-17: a comment inside `surface-visual`'s
  style tag did exactly this and both harness runs died with `No tests found`.)
- **A deploy command must never appear as an un-quoted literal** in a PR body, commit message, or
  report. Write it fenced/inline in a single-quoted heredoc or a `--body-file`; an un-quoted
  `` `supabase functions deploy …` `` in a double-quoted string executes. (Codifies the 2026-07-14
  heredoc-eval incident, which deployed a function to prod from a PR-body backtick.)
- **No writes to the production database from a Code session — ever, including throwaway
  accounts meant for immediate deletion.** `docs/reference/DEPLOY.md`'s smoke test uses exactly that
  pattern — a self-deleting account exercising the full lifecycle against prod — but that is the
  owner's checklist to run by hand, not something a Code session does on its own. Verification
  that requires a real prod account is the owner's to run, not Code's.
- **A new RPC needs `revoke execute ... from public, anon, authenticated` and THEN the grant it
  actually wants** (`to authenticated`, or `to service_role`) **— revoking `public` alone is not
  enough, and the grant alone was never gating.** Revoke all three by name, then grant back
  deliberately; the revoke costs nothing when the role never had it.
  **Why `public` alone fails, demonstrated rather than argued.** Supabase's default privileges hand
  every NEWLY CREATED function named grants to `anon`/`authenticated`/`service_role`, and
  `revoke ... from public` does not touch a named grant. The 2026-08-15 production `proacl` check
  read this off the live database:
  · `20260809010000_series_backfill.sql` and `20260810010000_reset_seeded_user_edited.sql` revoked
  only `from public` — both came back carrying unintended `anon` AND `authenticated`.
  · `20260822010000_series_merge_decisions.sql` revoked `record_series_ruling` from `public` **and**
  `anon` by name — it came back clean.
  Same database, same platform behaviour, opposite outcomes, decided entirely by which form the
  migration used.
  **And the warning was already in the repo when both of them landed.**
  `20260806010000_rpc_body_defense.sql` says it outright: _"Revoking from `anon` BY NAME, not just
  from PUBLIC: the platform grant was a named grant, so `revoke ... from public` would not touch it.
  That is the specific mistake to avoid repeating."_ That migration is numbered — and ran — before
  both of the two that repeated it. A warning inside one migration does not reach the author of the
  next one, which is why the rule lives here instead.

  The original reasoning, still true: **the grant alone was never gating.** Postgres grants
  `EXECUTE` to `PUBLIC` on every new function by default, so `grant execute to authenticated` is
  additive, not a boundary. Observed live: `remove_series_entry` and `merge_books` were both
  reachable with the anon key before `20260801010000_revoke_public_execute.sql`, returning their
  body's own `P0001` ownership raise rather than a grant-layer refusal — meaning the `raise` was the
  _only_ thing stopping anon, and a future RPC whose first statement isn't an ownership check would
  inherit an anon-callable function with no protection at all. One function's boundary was already
  weaker than that in practice: `rate_limit_consume`, granted only to `service_role`, had no
  ownership check whatsoever and was genuinely callable by anon/authenticated with an arbitrary,
  unvalidated `p_key` — able to exhaust or spam another user's guessable rate-limit bucket. `create
or replace function` (same signature) **preserves** an existing revoke; only a genuine `drop
function` + fresh `create` resets it to the PUBLIC-execute default — verified against this
  database (a throwaway probe: revoke, then replace → unchanged; revoke, then drop+recreate → the
  revoke is gone). No migration in this repo's history has ever dropped-and-recreated a function
  (`merge_books`, six times, always via `create or replace`), so the convention only breaks if that
  changes. **Guard it at the grant layer, not the body**: a pgTAP assertion of `remove_series_entry`
  or `merge_books` refusing anon must check for SQLSTATE `42501` specifically, never a body-level
  `P0001` — a `P0001` from that assertion means `PUBLIC` regained execute and the call reached the
  ownership check anyway, which is the exact silent regression this rule exists to catch.
  **One classification mistake worth keeping visible**: `is_club_member` / `club_progress` were
  first assumed to be pure internal helpers needing no grant, since they're only called from within
  another `security definer` function's body — true for THAT call path (which runs as the function
  owner), but both are also called directly from inside four RLS POLICY expressions on
  `clubs`/`club_members`/`club_comments`, which evaluate as the QUERYING role, not the owner.
  Revoking `PUBLIC` without granting `authenticated` there broke three pgTAP files outright on the
  first run. Caught by running the suite, not by re-reading the reasoning — a function's callers
  include its RLS policies, not just its own migration file and its obvious call sites.

- **A new `public` table needs the same explicit ACL reset before its intended grants.** RLS limits
  rows after the table privilege check; it does not remove a platform-supplied table grant. The
  local stack's unset `api.auto_expose_new_tables` uses the newer non-auto-exposed default, while
  this production project retained legacy auto-exposure. `20260831010000` created `work_tropes`,
  enabled RLS, and added authenticated `SELECT` plus service-role `ALL`, but never revoked existing
  grants; production verification found anonymous access and authenticated writes while the local
  single-operation assertion stayed green. Reset `PUBLIC`, `anon`, `authenticated`, and
  `service_role`, then grant back only the exact intended capabilities. A regression must dirty the
  ACL first and assert `SELECT`/`INSERT`/`UPDATE`/`DELETE` separately for all three API roles; testing
  only the clean local default proves nothing about the repair.

- **A data-fix script is NOT a migration.** A one-time repair scoped to a single incident — row ids
  that mean nothing on another database, a backfill that must not run twice — lives in `docs/queries/`
  and is run by hand against the target, never in `supabase/migrations/`. `pnpm db:migrate` pushes
  every file in `supabase/migrations/` on every deploy, so a repair there would either re-fire on the
  next database (idempotent ones harmlessly, non-idempotent ones destructively) or sit in the deploy
  path forever as dead weight. The durable _closure_ of an incident — the schema/trigger/constraint
  that stops it recurring — _does_ belong in a migration; the incident-specific repair that produced
  the closure does not. `fix/merge_books-series-reparent` (41290d0) is the clean separation: the
  repair SQL for Iron Flame's mis-parented series slot sat in `docs/queries/iron-flame-merge.sql`
  scoped to those row ids, while the step-3c-series re-parenting that makes the next merge correct went
  into the `merge_books` body via migration. Twelve incident files already live under `docs/queries/`
  on this pattern; do not promote one into `supabase/migrations/` because it "feels like" a migration.
- **Irreversible DB operations are silent by default — make them loud.** `alter table … drop column`
  on a dependency nothing tracks (no FK, no view, no function arg) **succeeds silently**: no error,
  no warning, just a column gone. `delete from …` with no `where` empties the table the same way.
  Any migration that drops a column, drops a constraint, or deletes rows must (a) name in a comment
  _what_ it removes and _why_, and (b) where live data exists, do the durable guard _first_ and the
  destructive act _second_ — never assume a later step will catch a silent drop. `drop_plan_date`
  (658ede0) documents this directly: `plan_date` was "a string, not a tracked dependency, so
  `alter table … drop column plan_date` SUCCEEDS SILENTLY," and the migration reorders the body to
  write the replacement columns and backfill before the drop, so a silent failure of the drop would
  leave the replacement in place rather than the reader with neither. The silence is the failure mode;
  a comment and a guard ordering are the antidote.

- **The fresh-worktree `.env.local` failure class is CLOSED (2026-08-21): the committed
  `apps/web/.env` carries the local-stack demo values in every Vite mode, so a fresh worktree
  builds and tests with no env setup at all.** `.env.local` is now an optional per-machine
  override and the ONLY home for real keys (Sentry DSN, Google Books) — never commit those into
  `.env`. History, kept because the misdiagnosis pattern generalises: >=5 incidents where the
  missing gitignored file made unit tests fail in ways that read as real regressions
  (offline-session boot stuck on "Turning the page…", cache-scoping restores finding nothing) —
  10 failing tests on 2026-08-19 (#288), 17 on 2026-08-20 (#297), plus build refusals. On a
  branch that predates the committed `.env`, the old failure and the old fix (copy `.env.local`
  from the main checkout) still apply.

- **Create the branch BEFORE the first edit, never after.** `git checkout -b` costs nothing at the
  start and is the only moment it is free. Starting work on whatever branch happens to be checked
  out — usually the last PR's — means the commit lands on that PR, and splitting it out afterward
  costs a cherry-pick onto a fresh branch plus a `git reset --hard` on the polluted one to drop the
  duplicate. That reset is recoverable only because the commit already exists elsewhere; it is one
  slip away from discarding real work, and `--force`-pushing the polluted branch instead is
  forbidden. This happened TWICE in one session: the font-spec rewrite (#207) and the suite-wide
  font stub (#208) were both authored on #206's branch and both had to be extracted. Neither reached
  the remote, so no PR was corrupted — but that was luck about push timing, not the process working.
  The tell is reaching for `git checkout -b` while `git status` already shows modified files.

- **A push to a branch whose PR has ALREADY MERGED strands the commit, and no CI can see it — the
  `pre-push` hook is the only guard.** Second variant of the stranding class: not base ≠ main (the
  #252/#263/#267 shape, which #273's `gate` step covers), but **pushed-after-merge**. #300 merged at
  head `82d86b4`; the star-glyph fix `07ceacd` was pushed to that branch afterwards, so nothing
  merged it again — `main` shipped without it, the PR read "Merged", CI was green, and it surfaced
  only when the owner looked at his phone days later.
  **Why it must be local, verified rather than assumed:** GitHub fires no `pull_request` events for
  a CLOSED PR, `ci.yml`'s push trigger is `branches: [main]`, `cla.yml` is `pull_request_target`
  (same blindness) and `layout-sweep-390` is dispatch-only. Such a push produces **no CI event of
  any kind**. `.githooks/pre-push` now refuses it, names the PR, and prints the recovery (fresh branch
  off `main`, cherry-pick, new PR); override with `ALLOW_PUSH_TO_MERGED=1`. It fails OPEN with a
  loud banner when `gh` is missing/offline — a guard that blocks every push on a plane gets
  `--no-verify`'d habitually, taking the Prettier check with it.
  **Hooks are COMMITTED (`.githooks/`), not install-generated — because the husky arrangement's
  "no per-clone setup to forget" claim was false and this session proved it.** husky created its
  hook shims in `.husky/_` on `pnpm install`, and `core.hooksPath` is a RELATIVE path resolved
  per-worktree — so an uninstalled worktree had NO hooks and no warning, and two pushes from such
  worktrees ran neither guard (verified 2026-08-21). Committed hooks arm every worktree from
  checkout. The one true per-clone step (`git config core.hooksPath .githooks`) runs via
  `package.json`'s `prepare`; a clone that has NEVER run `pnpm install` has no hooks config and no
  guards — run `scripts/worktree-init.sh` (or any `pnpm install`) once. `.githooks/post-checkout`
  banners any fresh worktree that lacks `node_modules`, naming the exact command.
  **Auditing for it needs the LIVE BRANCH REF, not the PR's head.** `gh pr list --json headRefOid`
  reports the head _at merge time_, which is on `main` by definition — it structurally cannot see
  this variant. Compare `git ls-remote --heads origin` tips against `main` instead. That scan
  over-reports (a tip is also not an ancestor when the content re-landed via a later PR): 12 hits,
  11 benign, one real. Diff the touched files against `main` before calling anything stranded —
  this is the positive half of the error-characteristics rule in "Testing & verification
  discipline", which carries both directions.

- **A stacked PR that says "Merged" has not necessarily landed. Run
  `scripts/check-pr-landed.sh <branch> [base]` before calling the thread closed.** Branching from
  another PR's own unmerged head is fine and often correct — `main` has not caught up yet. What is
  not automatic is the retarget: GitHub does NOT move a stacked PR's base to `main` when its parent
  lands, so merging it afterwards merges it into a branch that has ALREADY merged once, and its
  commits become unreachable from `main`. The PR reads "Merged", CI is green, nothing errors, and
  the work is simply absent from the product.
  That is the #252 incident exactly: #252 was branched correctly from #251's head, #251 merged to
  `main`, then #252 merged into #251's _branch_ — stranding `fc834c4` where nothing on `main` could
  reach it. It was caught by running `git merge-base --is-ancestor` on a hunch, and recovered by
  cherry-picking onto a fresh branch off `main` (#256). A hunch is not a process; the script is.
  It asks the only question that cannot be fooled — is this commit an ancestor of `origin/<base>` —
  rather than believing the platform's merge status, which is the thing that misled here.

## Testing & verification discipline

Nineteen rules, each earned by a real failure — counted from the list below, not carried forward. A rule without its reason gets dropped by whoever
inherits it, so the reason stays attached.

- **When a test needs a step a user would not take, that step is a FINDING until proven otherwise.**
  A setup line that exists only to make the test pass — dismiss this overlay first, click twice, wait
  for the animation, blur before clicking — is a claim about the product: that the path a reader
  actually walks is different from the one being asserted. Sometimes it is a genuine harness
  artifact. Often it is the defect, wearing the costume of a workaround, and writing it down closes
  the case before anyone looks. **Before adding the step, state in one sentence what a reader does
  instead, and why the test cannot do that.** If the answer is "it fails if I don't", that is the
  finding.
  Earned on `feat/search-withheld-notice`: the spec blurred the search box before clicking the
  reveal, described in the report as working around an overlay that `toBeVisible()` cannot see. Both
  halves were wrong, and the measurement said so. There was no overlay — the panel is IN FLOW
  (`Frame`'s `relative` beats the `absolute` it is passed), vertical overlap measured 0.0px in four
  skin × viewport combinations. What the blur actually hid was a real defect: pressing "show" with
  the box focused blurred the input, unmounted the panel, collapsed the 77.8px it reserved, and
  jumped the line up by exactly that (top 246.75 → 169.0) mid-gesture — so mouseup landed on a
  different element than mousedown and the browser fired `click` on their common ancestor. **The
  reader's first press did nothing, and the spec was green.**
  Third instance of this shape in two days, which is why it is a rule and not a note: a guard located
  by a label that changes with the state it is testing (#305), a touch-target spec passing on another
  spec's residue, and this. Same failure each time — a convenience in the test standing in for an
  unanswered question about the product.
  **Two corollaries, both paid for here.** Playwright's `click()` does not save you: its hit-target
  check passes at mousedown and it never re-checks mouseup, so it reports success against exactly
  this build. Assert the CONSEQUENCE (the state flipped, the thing appeared), never the click. And
  when the question is "does the reader see it", `toBeVisible()` is the wrong instrument — it does
  not consider occlusion. Measure the geometry.

- **Assert the thing itself, not a proxy that would look the same if the thing were absent.** This is
  the general form several rules below are instances of, stated once at the top so it covers cases
  the specific ones don't reach. The canonical case: `fix/spine-shelf-overlay` (df8cfb4) guarded the
  track-width invariant by measuring `scrollWidth` across scroll-driven **and** tap-driven
  transitions at both content edges — **not** a `scrollLeft`-reachability test, which the
  `mobile-shelf-interaction` audit proved "reaches the ends fine while the real gesture fails" and so
  passes against the broken build and proves nothing. A proxy guard certifies a property adjacent to
  the defect (the scroll position can be set; the row is `NULL`; the bundle contains the string) while
  the defect itself (the width mutates mid-gesture; the row is invisible under RLS; the branch is dead
  code) is invisible to it. Before writing a guard, name the defect in one sentence and ask whether
  the assertion would fail if _that specific thing_ broke — if it would still pass, you are guarding a
  proxy. See the negative-assertion, bundle-grep, and dead-export rules below for three instances of
  the same failure in different domains.

- **Grepping a bundle for strings measures dead-code elimination, not rendering.** Vite
  constant-folds and eliminates unused branches, so a string's presence or absence in the built
  output tracks the bundler's optimization, not what reaches the screen. Serve the build and read
  the DOM.
- **A negative assertion must first wait for the moment the thing would appear, and must be able to
  tell absence from invisibility.** `waitFor(() => expect(...).not.toBeInTheDocument())` succeeds on
  its very first tick, before any async work has had a chance to produce what's being denied — it
  fails in the safe-looking direction, certifying an absence that was never actually tested. The same
  failure shows up in pgTAP: `is()` is null-safe equality (two `NULL`s compare equal), so
  `is(removed_at, null)` passes identically whether a row was genuinely left untouched or the row is
  invisible to the querying role under RLS and the subquery itself returned zero rows — both collapse
  to the same `NULL`. `fix/atomic-series-removal`'s first draft asserted as `authenticated` and got
  four green-for-the-wrong-reason failures from exactly this. `ok(x is null)` does not have the hole:
  moving the null check inside the expression means a hidden row's zero-row subquery never evaluates
  it at all and the outer value stays bare `NULL`, which fails `ok()` rather than passing it — verified
  directly against this database (`is(x, null)` passes on a nonexistent row; `ok(x is null)` fails on
  the same row). The more durable fix beneath the assertion-shape one: assert as a role nothing
  filters (`reset role`) and let only the action under test run as the restricted one. The same hole
  reopens comparing two things that are each supposed to exist, not just one: `feat/plan-precision-schema`
  compared `plan_*`'s CHECK constraint definitions against `pub_*`'s, to prove the sibling columns
  hadn't diverged. `is(a, b)` would have passed if BOTH constraints had vanished — `NULL` compares
  equal to `NULL` — certifying a mirror between two things that no longer exist. `ok(a = b)` doesn't
  have the hole: a missing operand makes `=` yield `NULL`, and `ok(NULL)` fails rather than passing.
  Same rule, same mechanism, wherever an assertion needs a missing operand to fail loudly.
- **A test name is a promise about what is proven.** "restoring the same file twice does not
  double the assignments" described behavior the test did not assert, and two reports
  contradicted each other for a full round because of it. Name what the assertions actually
  check, not what you hope the surrounding code does.
- **`git checkout -- <file>` is now mechanically blocked for coding agent sessions, not just
  written down — a third incident is what changed that.** Two written rules (2026-07-28, #93; and
  the paragraph this replaces) did not make it a reflex, because the failure happens inside a fast
  revert loop rather than at a moment of deliberation. Three times it destroyed real work:
  **2026-08-14** — `git checkout -- src/routes/IndieScreen.tsx` mid-run wiped six uncommitted
  `.skin-control` migrations, found only when a later carrier count came back 0; **2026-08-15**
  (`a2bdfd7`, `feat/card-surface-rulings-coverage`) — the same command destroyed the uncommitted
  `card`/`line` fixture additions, discovered when 35 tests went red and the next mutant's anchors
  stopped resolving; and a third time, later in the same session that added `safe-revert.sh` in the
  first place. `.agent-tooling/hooks/pretooluse-guard.sh`, wired via `.agent-tooling/settings.json`'s PreToolUse
  hook, now refuses the `git checkout -- ...` / `git checkout <ref> -- ...` form outright before it
  runs — no escape hatch, because `scripts/safe-revert.sh <file> [<file2> ...]` covers every case
  `git checkout --` does for a tracked file. Use it — it backs up each file's current content to
  `/tmp/mutation-revert-backups/…` and prints the path, then reverts; it deliberately does NOT try
  to tell a deliberate mutant from real work, since that judgment is precisely what failed all three
  times. Still verify each revert with `git status --porcelain` before the next mutant. The hook
  only covers coding agent sessions issuing a Bash call — a human typing the raw form directly in a
  terminal is not stopped by it, only by this paragraph.

- **`safe-revert.sh` reverts to HEAD, so it destroys UNCOMMITTED work in the file it reverts —
  commit or stash the real change before mutating a file you intend to revert.** This is the
  `git checkout --` failure class reappearing INSIDE the tool built to prevent it, which is why it
  needs its own line: the script's contract is "put this file back the way HEAD has it", and a
  reverted mutation and an unrelated uncommitted edit in the same file are indistinguishable to it
  by design. Observed 2026-08-22 on `feat/calendar-sparse-pass`: an uncommitted weekday-header
  alignment fix and an experimental numerals-centred variant were in the same file; reverting the
  variant took the fix with it, and only a pre-mutation `cp` of the file made it recoverable.
  **The recovery path is real and worth knowing rather than re-deriving in a panic**: the script
  backs the file up to `/tmp/mutation-revert-backups/<path>.<epoch>` and prints that path before it
  reverts, so the work is retrievable from there. **Diff after reverting rather than assuming** —
  `diff <your-backup> <file>` or `git status --porcelain` — because the loss is silent: the mutation
  is gone, which is what you were looking for, and the missing real work looks like nothing at all.
- **A single run of a STOCHASTIC check is not a measurement, and the harness enforces this rather
  than asking you to remember.** `surface-visual.audit.ts` records each comparison run as an
  observation and refuses to report until it has ≥2 (`MIN_OBSERVATIONS`, raise with
  `SURFACE_MIN_OBSERVATIONS`); it reports the UNION of crops that differed in any run, so a crop that
  flags once and not the next cannot be averaged away. "0 changed" is structurally unobtainable from
  one run. Twice in one week a single run was reported as settled, both times optimistic:
  `c157c1b` set an a11y budget from the worst of TWO CI runs and a third exceeded it; then #265
  declared the surface harness "0 of 570" from ONE post-fix run and called Batch 1's precondition
  met — re-running the identical tree gave 24, and `b3350c5` found the third cause that run had
  masked. The tell in hindsight: the residual was described from the start as "~4-6 of 62, a
  different set each time", which is a distribution that sometimes lands on zero.
  **Why tooling and not a fourteenth restatement** — the same argument `scripts/safe-revert.sh`
  makes above: the rule WAS already written down, in a commit message, days before it was broken
  again by the same hand. N=1 fails inside a loop (run, read the number, move on), not at a moment
  of deliberation, so there is no pause for a rule to catch. A clean single run is also the outcome
  you were hoping for, which is exactly why nothing prompts a second look — this failure mode is
  self-concealing in a way a wrong number is not. Sibling audits were checked:
  `visual-overflow.audit.ts` and `shelves-trigger.audit.ts` are single-pass reporters with no
  baseline and no run-to-run comparison, so they have no "0 changed" to obtain and need no
  equivalent.

- **Run the full gate before reporting, not the subset that looks relevant.** Vitest runs on
  esbuild, which strips types without checking them, so a type-broken test file can pass `pnpm
test` outright and only fail `tsc`. This has bitten twice, by two different tools: a broken
  mutation-testing revert once passed `pnpm lint` clean, because ESLint parses syntax but does not
  typecheck; and on `feat/plan-precision-app`, a test helper that spread over `makeBook`'s required
  `id`/`title` and a fixture that was `as`-cast rather than satisfied both passed every Vitest run
  and were only caught when `pnpm typecheck` ran. Green unit tests are not evidence the code
  typechecks — only `/gate`'s own typecheck step is.
- **Every completion report on a branch touching `apps/`, `packages/`, `supabase/`, or test
  infrastructure includes one full e2e run** at the default worker count, fresh DB, retries 0. If
  it's red, report it red — do not re-run until it's green. Docs-only branches are exempt, and
  the report should say so explicitly rather than silently omitting the run.
- **A bulk insert's column set is the UNION of every row's keys, not each row's own.** PostgREST
  sends one `INSERT` for the whole array, and the column list it builds is every key any row in
  the batch supplies — so a row that omits a key the batch is inserting gets an explicit `NULL`
  for it, not the column's default. A `NOT NULL` column then rejects the **entire batch**, and the
  error names the constraint, not the row or the omission that caused it. This has bitten twice:
  `state-pills.spec.ts` documented it once (a rejected insert read as an empty grid, until the
  swallowed error was surfaced), and `a11y.spec.ts`'s `series_entries` fixture hit it independently
  — twice over, first on `author`, then on `user_edited` once `author` was fixed — and because the
  insert was a bare, unchecked `await`, it had **never once succeeded**: `/series/A11y Saga` had
  been axe-scanned as an empty series since the route's introduction (`911dd6f`), with neither the
  linked entry nor the ghost slot ever in front of axe. `fix/supabase-error-surfacing`'s conversion
  of that `await` into `ok()` is what surfaced it — a defect that had been invisible specifically
  because nothing read the result. Give every row in a bulk insert every column the batch uses,
  explicitly, even where a value is just the column default.
- **Never call `res.json()` inside an `if (!res.ok)` branch.** The failure body is the one least
  likely to be JSON: an HTML gateway page, an empty 429, a plain-text proxy error. The parse throws
  _inside the failure handler_, the outer `catch` swallows it, and the status code — the only thing
  that decides whether to retry, back off, or give up — is destroyed on the way. What reaches the
  caller is a generic parse error indistinguishable from "the source had nothing", which is exactly
  backwards: a 403 quota refusal and an empty result set demand opposite responses. **Read the
  status first, then the body defensively** (`await r.json().catch(() => null)`). The same rule
  applies to a fall-through: `enrich`'s `fetchJson` handles 429 and 5xx by status and then parses
  everything else, so a 4xx with an HTML body still reaches `.json()` and still loses its status.
  Branching on `.ok` is not enough — every path that reaches a parse must have already captured the
  status.
- **An exported symbol whose only importers are `*.test.ts` is dead code wearing tests.** Passing
  tests on an uncalled function read as proof the feature works, and that is precisely how
  `fetchCover` survived a PR _about_ `fetchCover`: its `?default=false` guard and ISBN-direct chain
  were reviewed, tested, merged and reported as shipped while nothing had ever called it, and
  `ol-covers`' budget and 3000ms gap were dead configuration guarded by five passing tests.
  Measured on `docs/rules-and-grep-audit`: **37 exported symbols are unreachable** — no intra-file
  use, no non-test use anywhere including `e2e/`, `scripts/` and `supabase/functions/` — of which
  **26 carry tests**. Earlier instances (`bookshopId`, `VITE_LIBRO_AFFILIATE_ID`, `cacheCoverUrl`)
  were each deleted only after being mistaken for working features first. **Delete it or wire it;
  do not leave it.** Three exemptions are legitimate and should stay declared rather than inferred:
  `*.fixture.ts` files, names ending `ForTests`, and registries that ARE the spec (`ownedTables`,
  the contrast-test `*_TOKEN_FIELDS`) — the last of which needs a written reason, on the
  `ownedTables` principle that an exclusion without one is the bug.
- **Verify a deploy landed before building on it.** The claim and the act happen in different
  places — a Code session writes the migration, the owner runs it, and nothing closes the loop — so
  "it's deployed" is an assumption wearing the costume of a fact. Four times this session work was
  built on a deploy that had not happened. Check `supabase migration list --linked` (the remote
  column is the truth) or `supabase functions list` before depending on it, and say which you
  checked. This is cheap and the alternative is a branch built on a schema that does not exist.
- **Local dev DB schema can run ahead of the checked-out tree — the mirror image of the rule
  above.** `supabase migration up` / `db:migrate` applies migrations to the local Postgres instance
  independently of git; checking out `main` or any branch that hasn't merged a migration yet leaves
  the local schema ahead of the code until a `db:reset`. Observed on `chore/series-position-index`
  (2026-08-10): its pgTAP suite only meant something with the migration actually applied, so it went
  in via the incremental path (`supabase migration up`, not a full `db:reset` — no local dev data
  lost), and the local stack stayed at `20260816010000` after, ahead of `main`. Same command, same
  confusable label, opposite direction: `supabase migration list --local`'s `remote` column reports
  the LOCAL database's applied migrations, not production's. Don't read a `--local` run as evidence
  about prod's state, and don't read your local stack's schema as evidence about what's actually
  merged into the tree you're standing on.

- **Key a guard to the declaration, the measurement, or the rendered pixel — never to something
  merely correlated with it.** This is the general rule the ratchet rule below is one instance of,
  stated separately because each instance looked fine in review and each died only to mutation
  testing. In one session three guards were written and **all three first drafts were proxies**: a
  ratchet whose budget was _derived_ rather than measured (63 against a tree of 61, so the mutant
  landed inside the slack and read as "this guard has no teeth"); a ratchet keyed to a **marker
  comment**, which Prettier reflows onto the next property, so deleting the override it marked left
  the comment — and the green — in place; and a render assertion keyed to **`textContent`**, which
  `text-transform` never touches, so it would have passed identically against the broken build. Each
  certified something adjacent to the defect while the defect itself stayed invisible.
  **The CSS-invisible-to-the-DOM case deserves naming, because it is a whole family.**
  `text-transform`, `content`, `::before`/`::after`, `visibility`, `order` and `direction` all change
  what a person perceives while leaving the DOM byte-identical — so any assertion about what a reader
  SEES must read rendered output (`innerText`, Playwright's `toHaveText`, a computed style, a
  screenshot), never the node. Measured here: under `--control-transform: uppercase`, one element
  gave `textContent = 'A Court of Thorns and Roses'` and `innerText = 'A COURT OF THORNS AND ROSES'`.
  The test to apply before writing any guard: **name the defect in one sentence, then ask what the
  guard would report if that exact thing were true.** If the answer is "the same thing it reports
  now", it is keyed to a proxy — and a proxy guard is worse than none, because it also stops the next
  person from looking.

- **A ratchet's budget must be a MEASUREMENT taken from the tree, never a calculation.** A budget that
  is derived — "we had 112, this batch migrates 26, so it's 86" — is indistinguishable from a correct
  one for as long as it stays green, because slack does not fail. It only stops catching things.
  Observed on the control-radius meter (batch 4, `skinRadiusMigration.test.ts`): the derivation
  dropped a term and set the budget to 63 when the tree measured 61. Nothing said so. The mutation
  written to prove the guard had teeth — revert a migrated control — landed at 62, sailed under 63,
  and **read as "this guard has no teeth"**, which is the dangerous part: that is a conclusion a
  reviewer shrugs past and a author is tempted to explain away, when the real fault was two counts of
  slack in the number the mutant was tested against. The gap was found only by setting the budget to
  `-1`, letting the assertion fail, and reading the actual count out of the failure message. So:
  **print the count, don't infer it from green.** Take the number from the tree, then write it down;
  a budget you computed rather than observed is a guess wearing a ratchet's clothes. The same shape
  as the negative-assertion rule above — an assertion that passes for a reason other than the one you
  think is worse than no assertion, because it also stops anyone else from looking.

- **An instrument's output means nothing until you know its ERROR CHARACTERISTICS — in both
  directions. Validate it against a known case before believing it.** Two failure directions, one
  principle, kept together because splitting them is how a rule list stops being read (this repo has
  paid for split documentation twice: two `DESIGN_BACKLOG.md` copies, and three `ci.yml` comments
  each asserting the same false thing about required checks).

  **A CLEAN result from an unvalidated instrument is not evidence** — the negative may be vacuous.
  `scripts/spec-isolation-sweep.sh` reporting "0 false greens" is indistinguishable from a sweep
  that cannot detect one, and it very nearly was: run with `--project=rest` it reported the eight
  `mobile`-only specs as passing WITHOUT EXECUTING A TEST, caught only because a file that should
  take 40s finished in 3. Its zero became meaningful only after replaying a known-bad
  (`star-touch-targets.spec.ts` at `928d5d9^`) and confirming the harness fails on it. Same shape as
  the Edge-Function deploy check: a 401 from a gateway rejecting an unknown route is
  indistinguishable from a deployed function demanding a JWT, so that check is only readable
  alongside a `definitely-not-a-function` control returning 404.

  **A HIT from an over-reporting instrument is a question, not a verdict** — the positive may be
  benign. The stranded-branch scan (`git ls-remote` tips not ancestors of `main`) surfaced 12
  branches; checking the touched files showed 11 were harmless — content re-landed via a later PR
  (#293, #257, #244), already-recovered prior incidents (#252, #263, #267), or closed-not-merged
  work that was never meant to land (#190, #204). Exactly one was real (#300's `07ceacd`). Diff
  before you conclude.

  **So: before reporting a number from any guard, sweep, probe or audit, state what it would do on
  a case you already know the answer to.** If you cannot name that case, the number is not yet
  evidence — and a validated instrument's known over-reporting is a feature to document, not a bug
  to hide.

- **A command written into a comment, runbook or PR body is a CLAIM ABOUT AN INTERFACE, and an unrun
  claim is a guess. Either execute it once before committing, or mark it explicitly unverified.**
  The failure is silent at authoring time and lands entirely on whoever copies it — which is the
  person least equipped to tell a typo from a real problem, because they are usually running it to
  find something out, and a refusal reads as "the thing I was investigating is broken."
  **Two committed usage lines, both authored without being run, both wrong on their first copy:**
  · `docs/queries/backup-paging-row-counts.sql` documented `supabase db execute --linked --file …`.
  There is no `execute` subcommand — `supabase db --help` lists `query`, and `--linked`/`--file` are
  ITS flags, so the whole line had to be re-shaped, not just re-spelled.
  · `scripts/import-corpus-csv.mjs` documented `--owner-email you@example.com` (three times) while
  its own parser matches only the `--name=value` form, requiring `--owner-email=`. The
  space-separated form parses to `null` and the script exits — **and its own error message prints
  the correct `=` form**, so the file contradicted itself in two places at once and neither was
  noticed for as long as nobody typed it.
  **The sweep that found the second one is the argument for the rule.** Across `docs/queries/` (28
  files) and `scripts/`, FOUR lines are copy-pasteable invocations rather than prose references, and
  TWO of the four were wrong. The other two — `supabase migration list --linked`, and
  `psql "$PROD_DB_URL" -f … --csv -o …` — check out against `--help`. That is a hit rate, not a note
  about carelessness, so treat a command in a comment the way you would treat an assertion: it is
  not evidence until it has executed.
  **Running it is usually cheap even when the target is not.** A prod-only query can be executed
  against the LOCAL stack to prove the invocation form and that the SQL parses (`--local` instead of
  `--linked`); an arg parser can be exercised on its own in one `node -e`. Neither needs the
  database the command is ultimately for. If it genuinely cannot be run, say `UNVERIFIED` on the
  line — an honest marker costs the reader nothing and a wrong command costs them the session.

## Data-integrity & sourcing discipline

Two rules, both earned by the series-position-integrity audit (`audit/series-position-integrity`,
2026-08). They govern the moment a Code session proposes a value for a stored field — a series
ordinal, a series membership, a title canonicalization — that asserts a fact about the world rather
than a fact about the code.

- **A claim treated as ground truth must be sourced, not assumed — and that includes the owner's own
  uncorroborated guess.** "I think this book is #3 in the series" is a hypothesis, not data; treat it
  as such until a source confirms it. Default to **Wikidata** (`P179` part-of-series, `P1545` series
  ordinal) over a guess: it is CC0, carries native decimal ordinals (so `3.1` vs `3.5` is expressible
  without a custom scheme), and is auditable. Before proposing to overwrite a stored position, **paste
  the per-title QID + `P1545` literal** into the work record so the claim is checkable, not asserted.
  Bring splits (a book belongs to two series; an omnibus collects #1–#3) as a flagged question for the
  owner rather than self-resolving them — a self-resolution looks the same in the diff whether it was
  sourced or guessed, and the audit's whole point was that too many stored positions already were
  guesses wearing the costume of data. The recurring failure this names: a series ordering that
  "looked right" had drifted from every source, and nothing in the pipeline could tell, because the
  value was never traceable to one.
- **`series_entries.user_edited = true` is a hard rule: never silently overwrite a reader-set
  position.** The flag marks a position the reader deliberately set — corrected, reordered, or
  disambiguated against a source the backfill doesn't know about. A backfill or repair that rewrites
  `position` while leaving `user_edited` false (or, worse, flipping it false) destroys the reader's
  intent and is invisible in the diff because the row still "has a position." Any repair touching
  `series_entries.position` must filter `where user_edited is distinct from true` and must not touch
  the flag; one-shot repair functions (e.g. `20260810010000_reset_seeded_user_edited.sql`) are
  `revoke execute from public` + `grant to service_role` and run once. This is the data-integrity twin
  of the "assert the thing itself" testing rule: the thing to protect is the reader's set value, not
  the column's mere non-nullness.

## Definition of done (per feature)

Works against the data model; correct in **all nine skins**, light and dark; responsive;
a11y pass; logic covered by tests; uses the design tokens. Verify in the real browser UI —
several defects have been "fixed" in code paths no reader can reach.

## Decisions still needing the owner (use these defaults until told otherwise)

1. **App name — DECIDED (owner, 2026-07): Reverie is the name.** No longer a
   placeholder. Keep reading it from `APP_NAME` in `@reverie/core` (never hardcode);
   `docs/reference/TRADEMARK.md` stays as history.
2. **Household model — DECIDED (owner, 2026-08-23): linked personal libraries with a
   filterable household view.** Accounts keep separate libraries and all writes remain personal.
   V1's cross-account path is read-only and explicitly omits ratings, read state, notes,
   spice/darkness, plans/progress, favourites and personal tags. Match, Stats and Series remain
   personal-only until the owner expands their scope explicitly. Membership is owner-run rather
   than a client invite flow. Linking requires disclosure of the complete existing roster;
   unlinking removes only membership and preserves both accounts' personal data
   (`20260829010000_household_foundation.sql`).
3. **Spoiler gating — DECIDED AND SHIPPED: server-enforced via RLS.** Not a pending
   decision and not client-side. `club_comments`' `gated read` policy has enforced
   `unit <= public.club_progress(club_id)` — the `comment.unit <= myProgress` rule — since the
   original clubs migration (`20260624010200_clubs.sql:93`), hardened by
   `20260627040000_ugc_moderation.sql` to add `and not hidden`. A behind-progress reader never
   receives the row: the filter is in the database, not in the client, so it holds for any caller
   including a raw PostgREST request. Covered by `supabase/tests/spoiler_live_test.sql` (6
   assertions: a comment posted ahead of a reader stays invisible, and advancing their progress
   reveals exactly the now-eligible one). This entry previously read "v1 default: honor-based
   (client-side); server-enforced via RLS is a later upgrade" — the upgrade had in fact shipped
   before that sentence was written, and a reader following it would have built a client-side gate
   the database already enforces.
4. **Capability-code sharing** — keep it alongside real accounts (frictionless joins).
