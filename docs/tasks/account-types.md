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
