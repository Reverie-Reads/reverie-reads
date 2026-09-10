# Decision: Monetization Boundary, Premium Tiers, and the Bookstore Product

Status: decided in session, 2026-08-03; beta sequence amended 2026-09-10. Licensing context: app going AGPL-3.0,
corpus CC0, paid features in a private module. This document records what is
free, what is paid, where the repo boundary sits, and what the bookstore
product may and may not be built from.

## The line, in one sentence

**Tracking and the thesis are free; depth, authorship, and freshness are paid —
and no paid product, consumer or B2B, ever derives from reader data the reader
did not explicitly choose to share.**

## Free tier — the thesis in action

- All shelf, series, trope, mood, and ownership tracking. The tracker is the
  front door and is never degraded to upsell.
- Basic series tracking includes one series' membership, order, gaps, progress,
  and reader editing. A reader never has to pay to keep an ordinary series
  accurate.
- The nine skins as shipped, both modes.
- Taste calibration and Match. The recommender is the thesis made executable;
  a free tier without it is a shelf tracker competing on someone else's turf.
  Free proves the thesis. Paid deepens it.
- Basic Discover.
- Goodreads import. Never charge for arrival.
- Backup export/restore at full fidelity. Never charge for leaving. The
  no-lock-in promise is load-bearing for everything else in this document.

## Premium — reader tier

Ranked by effort-to-revenue as currently understood.

1. **Skin authorship.** Adaptive skin (time-of-day / seasonal drift), palette
   workshop with the contrast registry enforcing AA live, ornament and motif
   selection, saved variants. The open repo carries the token vocabulary and
   the nine shipped skins; the private module carries composition. The token
   vocabulary the design briefs specify is also this feature's API surface.
2. **Discover and taste at depth.** Full-depth Discover, taste-over-time
   (how a palate moved across a year), per-trope taste weighting, mood-aware
   planning.
3. **Wrapped and the stats layer.** Already never-public by design; already
   emotionally premium. The year-in-reading artifacts people screenshot.
4. **Corpus freshness as a service.** The CC0 dataset is free to download —
   that is what the license means. Paid is the living integration: series
   completions surfacing on release, "book 3 is out" from the
   Wikidata/OL pipeline, continuous deep-metadata backfill. Charge for
   freshness and integration, never for the data. (MetaBrainz model.)
5. **Import/export depth.** Continuous sync and scheduled backup. The
   one-time paths stay free per the no-lock-in rule.
6. **Clubs at depth.** Club-level "read next" ranked against members'
   combined opt-in signal, spoiler-gating by reading position.
7. **Collection and provenance tools.** Editions, signed copies, lending
   records. Pure tracking depth, zero thesis exposure.
8. **Connected-series universes.** Grouping several intact series into a
   reader-owned universe; publication/chronological/custom order variants;
   universe-wide import review, progress, and gap planning. This is paid depth,
   not a toll on ordinary series tracking: every constituent series remains
   fully usable in the free app. The implementation contract is recorded in
   `docs/decisions/0007-series-universes.md`.

## Free Pro beta before payment

Reverie will validate the reader-tier portfolio with a bounded, no-payment cohort before it builds
billing. Beta readers receive service-managed Pro access without entering payment details. Beta is
not a free trial of a subscription: there is no checkout, recurring agreement, automatic charge, or
automatic conversion.

The beta exists to reduce the product. It should test representative forms of paid depth—collection,
atmosphere authorship, reading decisions, and private reflection—then keep or simplify only the
experiences readers understand, complete, and return to. Expensive recurring infrastructure does not
ship merely to make every item in the premium list testable.

Beta entitlement is a third positive proof at the private server boundary:

`has_reader_pro = active_reader_subscription OR active_beta_grant OR is_corpus_admin()`

Do not represent a beta reader by inserting a synthetic paid subscription. The grant is
service-managed, owner-scoped, auditable, revocable, and separate from corpus administration. A
grant ending never deletes a reader's books or premium-authored data. Before enrollment, the cohort
must receive a plain statement of how long access lasts and whether any retained beta benefit
continues after billing launches.

Beta measurement stays content-free. It may record that a feature was opened, completed, abandoned,
or revisited, plus performance and error state. It must not record book identity, title, author,
notes, ratings, moods, taste contents, reading history, universe membership, or generated keepsake
contents. Interviews and optional feedback carry the meaning that event counts cannot.

Billing starts only after the retained offer, pricing hypothesis, provider rights, support path,
cancellation behavior, and premium-data lapse behavior are reviewed together. The Free boundary in
this decision remains unchanged throughout the beta.

## Corpus-administrator entitlement

Every service-managed corpus administrator receives the reader-tier premium
entitlement while the administrator grant is active. This is a product-testing
and corpus-maintenance override, not a subscription row and not a billing
mutation. Revoking corpus administration revokes the override unless the reader
also has an active paid entitlement or beta grant.

The effective server-side rule is therefore:

`has_reader_pro = active_reader_subscription OR active_beta_grant OR is_corpus_admin()`

Premium writes must enforce that rule at the server boundary and fail closed if
entitlement state cannot be established. Hiding a control in the client is not
authorization. The client may use the same effective value to decide which
private-module surfaces to load, but it must not maintain an independent second
definition of who is Pro.

The rule is evaluated as independent positive proofs. A confirmed administrator
grant or beta grant is enough even if the billing provider is unavailable; a
confirmed active subscription is enough without either service-managed grant.
If no source confirms access and any required source is unavailable, the answer
is unavailable and premium writes fail closed. Confirmed false results across
all three sources mean not entitled.

## Repo boundary

The premium module lives in its own private repo. The open AGPL app must be
complete and honest without it: entitlement checks and feature seams are
acceptable; stubs that exist only to advertise a wall are not. Nothing moves
from public to private later — code that has been public cannot be recalled —
so anything in doubt starts private and opens deliberately.

Connected-series universe implementation belongs in that private module. The
open app may define a narrow host contract (session identity, effective
entitlement, book/series projections, and navigation slots), but universe
ordering, editing, import review, and premium presentation do not land here
first as a prototype. The public build remains complete when the module is
absent: ordinary series pages continue to work and no dead universe tab or
advertising-only shell is rendered.

## The bookstore product (Indie Book Store profile)

A B2B tier for independent bookstores. This is the highest-revenue candidate
and the highest-risk one, because its naive version — "see what readers are
reading" — is structurally the thing the consumer product promises never to
be. Crowns are un-aggregatable by design; reading stats are never-public.
That commitment is not a constraint on this product. It is the product's
distribution advantage: readers trust the platform enough to keep using it,
which is the only reason the signal exists at all.

### The rule

**Store-facing signal derives exclusively from readers who explicitly opted
in to sharing, and only ever at cohort level.** Opt-in, not opt-out. Nothing
below a k-anonymity threshold is ever shown (no cohort smaller than N
readers; N decided at implementation, never below 20). No individual-level
data reaches a store under any circumstance, including inference paths —
if a cohort filter combination could isolate a reader, the query refuses.
Region-level, never person-level. No re-identification path is acceptable,
including to Reverie itself operating the service.

The marketing consequence is the point: this is the only reading-trend data
built entirely from readers who chose to share it. That sentence survives
scrutiny. "Anonymized" does not.

### What a store gets, within the rule

1. **Inventory-gap analysis.** The store loads inventory (ISBN list — the
   corpus crosswalk makes this cheap). Against opted-in cohort demand in
   their region: what is being read that they do not stock; what they stock
   that shows no demand signal. This is a purchase-order generator — the
   thing a buyer actually pays for.
2. **Seasonal demand curves.** Genre / subgenre / trope-level reading
   volume across the year, regional cohort. "Romantasy peaks here in
   October" is cohort-level by construction.
3. **Series-completion signal.** Cohort counts of readers partway through a
   series whose next volume releases soon. Order-depth guidance keyed to
   the release calendar — this is where the curated series layer becomes
   B2B revenue.
4. **Trope and mood trend lines.** The taxonomy at cohort level: which
   tropes are rising in the cohort's reading. No other vendor has this
   axis, because no other vendor has the taxonomy.
5. **Store presence in the Indies layer.** Inventory-aware surfacing to
   premium readers ("this store near you stocks your next-up books").
   Connects the two businesses: each makes the other more valuable, and
   buy-links already lean Bookshop/local-first.

### What a store never gets — recorded so it cannot drift

- Any individual reader's shelves, taste, moods, crowns, or history —
  regardless of opt-in status. Opt-in shares cohort membership, not records.
- Any signal derived from readers who did not opt in. Absence of objection
  is not consent.
- Any cohort below the k-threshold, including via filter composition.
- Reviews attributed to identifiable readers. If review surfacing ships, it
  is opt-in per review and display-anonymous with no linkable profile.
- Raw data export of cohort signal. Insights render in the product; the
  underlying rows never leave.

### Sequencing constraint

Gap analysis against thin metadata embarrasses itself. The bookstore tier
requires the corpus to be real — series ordering, taxonomy coverage, ISBN
crosswalk — before it is credible. It slots after the corpus work. Design
the opt-in surface earlier, though: consent language ships with the reader
product long before the store product exists, so the cohort has time to
grow, and so consent is never retrofitted.

## Thesis boundary — why none of this violates it

The anti-consensus thesis forbids _deriving labels about books_ from
aggregate behavior and feeding them back into taste. Nothing here does that.
Cohort demand signal describes reader populations to stores; it never
re-enters the recommender, never labels a book, never influences what any
reader is shown. The recommender remains driven solely by the individual
reader's own signal. The moment store-facing aggregation leaks back into
reader-facing taste, the thesis is dead — so that wall is architectural,
not policy: the cohort tables live in the B2B module and no reader-facing
query path may reference them. Guard this with the same rigor as RLS.

## Open questions, deliberately unresolved

- k-threshold value (≥20 floor; pick at implementation with real cohort
  sizes).
- Whether review surfacing ships at all in v1 of the store product.
- Store-tier pricing shape (flat vs. sized by inventory count).
- Whether the opt-in surface offers granularity (share genre-level but not
  trope-level) or is single-switch. Single-switch is simpler and more
  honest; granularity may lift opt-in rates. Decide with the consent UX.
