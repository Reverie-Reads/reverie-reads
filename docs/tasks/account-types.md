# Midniht Reader and Midniht Collector

Owner direction: September 30, 2026. This records the product contract for implementation;
the account selector and product-specific subscriptions are not implemented by this document.

## Initial entry

Offer two separate initial account types with equal prominence:

- **Midniht Reader** — organize a library, choose what to read, plan and reflect.
- **Midniht Collector** — document physical copies, source books on trips and organize a collection.

Each type has a Free version and a paid Pro version. Build Collector next. Bookstore-owner accounts
are a later product; do not show a third selectable signup option or implement retail workflows now.

Use one authenticated identity that can enable multiple product types. The initial choice opens
that product's onboarding and Home. Enabling a second product later adds a deliberate switch,
without another email/login or a duplicated library. Two Free types remain free. Paid multi-product
plans charge for the shared platform/features once plus the additional enabled paid capabilities.
Do not charge merely for changing the active screen or enabling a Free type.

## Common foundation and boundaries

Account type, active product, paid feature entitlement and workspace role are separate concepts.
Reader Pro and Collector Pro grant their own feature sets; a combined plan grants their union,
deduplicating overlapping features. Product choice is a preference, not authority. Neither Pro
type grants catalog administration, another person's records or purchasing/workspace permissions.

Reuse common bibliographic identity, search, covers, series, basic personal library and explicit
edition/copy inventory. Basic data quality, manual corrections, privacy, export, account exit and
access to existing personal records remain Free. Preserve genre-neutral vocabulary and all skins.
Collector views do not fabricate read status or reading goals. Reading history stays on the personal
book; a newly observed or shortlisted find never becomes personal possession automatically.

Personal reading data, household visibility and separately authorized sourcing workspaces preserve
their existing boundaries. Reuse of a book within one person's products does not broaden another
person's access. A deliberate acquisition-to-collection handoff must reconcile the exact physical
copy and configured inventory before writing; it cannot replay destructive legacy duplicate merging.

Collector-specific commercial workflows, evidence/review packaging and prices stay in the private
overlay. Shared account/profile/authentication/navigation contracts land upstream first through
reviewed seams. Do not copy private implementations, migrations or operational records here.

## Existing-user continuity

Existing readers keep their current Reader experience, appearance and arrangements. Offer Collector
explicitly without resetting their library, forcing new reading onboarding or reclassifying them
from possession data. Keep account choices scoped to the authenticated account, including first
entry, returning devices, failure/retry and account switching. Preserve pending capture recovery.

The current free-Pro beta remains free with no card or automatic paid conversion. Existing global
Pro checks require a feature-by-feature audit before product-scoped entitlements are introduced.
User-selectable account fields never establish premium authorization. Preserve readback/export of
premium-authored data after access ends and do not grant workspace rights through an entitlement.

## Delivery and acceptance

1. Implement initial product selection, account-scoped enabled products and remembered active
   product, preserving the existing authentication and guest-to-account handoff.
2. Register distinct Home/navigation/onboarding experiences; Collector prioritizes Collection,
   Trips, Review and Locations. Public builds remain complete when private features are absent;
   do not expose an unavailable Collector path as a working signup promise.
3. Define server-authoritative Reader Pro, Collector Pro and combined entitlements at explicit
   feature seams. Audit beta/admin testing overrides, restores, direct requests and unavailable
   proof. Selecting a product cannot unlock Pro or broaden personal/workspace access.
4. Validate a returning Reader, a new Collector, one person with both products, two accounts on
   one device and an upgrade/downgrade. Confirm no duplicate books, lost reading history, exposed
   private data or silent changes to existing arrangements.
5. Price the combined paid offer from actual overlap and incremental service costs. Validate
   retained features, provider commercial rights, operating costs and subscription lifecycle
   before billing, preserving the evidence-first beta contract.

The owner selected the product direction. This document does not grant merge/deploy authorization,
activate pricing, purchase a provider, invite users or introduce a production migration.

## Implementation blueprint for shared contracts

The owner accepted the working plan. These are proposed interfaces for focused implementation PRs,
not additions to the current data-model reference, which must continue to describe what is built.

### Profile and entry packet

Add nullable versioned `product_preferences` and server-managed
`product_preferences_revision` to profiles. Version 1 carries the unique enabled product set,
active enabled product, initial-choice completion and independent presentation documents. Only
Reader and Collector are enableable initially. No paid grants, workspace roles or billing data
belong in this user-editable document. Implement an owner-only revision-checked update RPC with
read-only identical retry; stale differing edits keep the draft and show a conflict.

Freeze legacy profile IDs at rollout instead of guessing from book counts. Existing accounts
retain Reader and all current arrangement/guidance/appearance data. New verified accounts without
a saved choice see two equal choices before product onboarding. A pre-auth choice is a bounded
session intent, deliberately confirmed for the authenticated account. Save failure retains selection
and Retry; no default choice is silently written. Record no new subscription or ownership state.

Reuse `data/profile.ts`, `routes/AuthRoute.tsx`, `routes/OnboardingRoute.tsx`,
`auth/AuthProvider.tsx` and the auth-callback/guest-handoff paths. Preserve confirmation and recovery
ordering. Do not re-run Reader onboarding for an existing account enabling Collector.

### Product registry and presentation packet

Provide inert public registration seams for product Home, navigation, onboarding/guidance and build
availability. Public-only builds are complete with Reader registered; a stored but unavailable
Collector choice is preserved and explained with an explicit Reader escape. Do not offer a broken
Collector signup path. The private product registers its implementation after the common seams land.

Use proposed `/start` for entry and retain existing Reader routes and `/sourcing` compatibility.
`RootRoute`, `AppShell`, `router.tsx` and the existing appearance gate resolve the active registered
product before showing its shell. Product/profile failure offers Retry without claiming book loss.
Direct routes remain reachable under their existing authorization and do not auto-grant a product.

Keep `profiles.arrangement` and `profiles.guidance` as Reader compatibility documents. The current
`design/arrangements.ts` parser requires Library in a three-destination dock; do not insert Collector
keys and then normalize away its layout. Collector gets independent versioned presentation state.
Custom arrangements win over defaults. Guidance changes presentation only, never access.

Switching products must honor each open draft's existing save/discard/cancel behavior. Do not erase
pending captures, sign the person out or cancel an acquired copy. Stop departing cameras/tours and
reject late callbacks using account/run identity. Different authenticated accounts keep the existing
stronger cache/session clearing boundary. Shared product data is not shared-user authorization.

### Feature proof seam packet

Extend the generic provider/proof seams in `data/proEntitlement.ts` and
`packages/core/src/proEntitlement.ts` to accept stable feature IDs and use account/feature-scoped
query keys. Preserve entitled/not_entitled/unavailable. Client proof is presentation, not a write
guard; private writers/providers repeat authoritative capability and ownership checks.

Keep legacy Reader behavior during staged caller migration. Do not turn the old global Pro result
into a union of products while Reader-only writers still consume it. The private overlay defines
the commercial feature mapping and server grants. User preference, cached proof or restored backup
cannot authorize premium writes or workspace membership.

### Backup and recovery packet

Update `data/importExport.ts`, `ownedTables.ts`, backup preflight and cache tests together. Product
preferences are portable personal presentation data; service grants and billing authority are not.
Old backups without the new field preserve the current choice. Unsupported product/presentation
documents survive readback without destructive normalization. A public build cannot silently drop
an unhandled private extension during restore. Profile restoration remains owner-scoped and cannot
grant account capabilities through arbitrary fields.

### Acceptance and release order

1. Land profile/pure contracts, migration/RPC and backup/cache continuity upstream with the feature
   inert. Read combined deployment history before numbering the migration; do not reserve a number
   from this blueprint. Keep the data-model reference current only when implementation lands.
2. Land product registration/entry and preserve public-build completeness. Private sync follows;
   Collector rollout waits for its usable minimum Free capture-to-collection journey.
3. Land the generic capability seam; private caller migration preserves legacy Reader grants and
   explicit shared-feature eligibility. Every direct writer/provider/restore has a scoped test.
4. Verify new Reader/Collector, existing customized Reader, both, helper, unavailable build,
   confirmation/OAuth/guest handoff, saved-choice failure, stale edits and account switching.
5. Verify old/new/unsupported backups, dirty editor switching, fresh-device appearance, camera
   cancellation, keyboard/reduced motion and registry-backed contrast across all skins/modes.

Implementation uses focused reviewed heads, public-first sync and normal guarded release gates.
Runtime verification must prove the user's actual journey, not only profile flags or route presence.
