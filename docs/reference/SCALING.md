# Scaling to more users

Reverie started as a personal app; the goal now includes growing to more users. The
build is already multi-tenant (accounts + RLS), so this is mostly about **cost, rate
limits, and a sustainable revenue path** — plus settling the name. Nothing here is urgent
at single-user scale; it's the readiness list to work down as MAU grows.

## 1. Revenue path (optional, but scaffolded)

- Buy-link **attribution is a config-driven strategy**: `store` (default — local store
  keeps full profit, app earns nothing) or `affiliate` (app earns commission). Affiliate
  IDs live in config, present but unused. Flip later to offset costs — config change + an
  honest disclosure line, not a refactor. (Confirm Libro.fm's store/affiliate model
  separately; it may already route to a chosen store.)

## 2. Cost levers & rate limits (the real scale work)

- **Global, shared caches** are the main lever: the cover/metadata cache must be keyed by
  work/ISBN and shared across **all** users (not per-user), so more users → more cache
  hits → near-flat enrichment cost. Same for geocode results.
- **Proxy + cache the free third-party services before adding users** — Nominatim,
  Overpass, and map tiles all have usage policies that throttle/ban heavy direct traffic.
  The `geo` Edge Function identifies Reverie, caches shared results, rate-limits calls, and can
  change `OVERPASS_ENDPOINTS` without a web release. Store discovery first uses a fixed-query
  Nitro route with two-decimal coordinates and a seven-day Vercel CDN cache, then the Edge Function
  as its alternate network path and last-known cache. The route accepts no caller-supplied Overpass
  text and only the product's 10-, 25-, and 50-mile radii. The reader flow keeps their location and
  offers a retry plus Bookshop.org's store directory when both paths are down.
  Keep this low-cost path through the unpaid beta. Public Overpass instances are best-effort and
  their published guidance directs commercial apps toward hosted or self-hosted service, so select
  that production source before paid launch rather than treating the beta route as source clearance.
  Consider hosted/self-hosted Overpass or Google Places after measured demand clarifies the right
  operating cost. As of 2026-09,
  Google lists 5,000 free monthly Nearby Search Pro events, then $32 per 1,000 in its first paid
  tier; pricing and reuse terms require a fresh review before adoption.
- **API quotas → paid tiers:** Google Books (~1,000/day) and Open Library (per-IP) don't
  scale on the free path; budget heavier caching or paid metadata. Track the **Supabase**
  free-tier ceilings (MAU, DB size, edge invocations, storage) and set an upgrade trigger.

## 3. Community features at scale

- **Reviews (R2) and clubs get more useful with more users** — but need guardrails:
  report/block, rate-limiting, and light moderation on user-generated reviews and club
  comments.
- **Capability-code sharing** (anyone-with-link) should gain optional **expiry/revoke** at
  scale; consider whether some shares should require an account.

## 4. Name & trademark (do before there's a URL / listing / marketing)

- A growth product needs the name settled. "Reverie" has a same-class (different-field)
  mark; **Gloaming** is the cleanest cleared option; Vieux Carré / Velvet Hour /
  Magnolia Dawn are still unsearched. See `docs/reference/TRADEMARK.md`. Keep the name out of
  hardcoded strings so a change stays cheap.

## 5. Households (decision #2)

- If growth includes family/household use, revisit the deferred shared-household-library
  model (today: one library per account + shared lists/clubs).

## Not now

None of this blocks current work. Sequence it: ship Phase 5 → confirm global caches +
proxy hardening before any real user influx → settle the name → decide revenue mode when
costs actually appear.
