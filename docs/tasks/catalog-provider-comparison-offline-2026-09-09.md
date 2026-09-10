# Provider comparison: offline implementation draft

Status: **draft, not merge-ready or shipped**. Implements the first, synthetic stage of
`catalog-provider-review-design-2026-09-09.md` on public base
`21161e3971c4e451a20cad0b576af13cae6debc5` (#519).

## Implemented in this branch

- A separate, allowlisted display DTO and pure projection in `packages/core/src/providerComparison.ts`.
  It does not import or serialize frozen trial packets. Unknown envelopes, changed work/ISBN/
  fingerprint/revision, invalid timestamps, over-five-minute lifetimes, unknown or duplicate sources,
  and inconsistent joint dispositions fail closed. This pilot contract expects exactly Google Books
  then Open Library; a disabled/unavailable provider occupies its own finite status card.
- Each known source is validated separately. An invalid source loses its values and link without
  concealing a valid peer. The joint remains review-only. Exact-identity checks are **adapter
  attestations**, not identity comparison performed by this browser projection. No title or author
  text, arbitrary URL, raw error body, description, cover, or series claim enters the DTO.
- Page differences, missing values, unknown language/binding, audio, and mixed formats remain distinct.
  Cross-format page values are withheld; nothing averages values or selects a winner. Shared record
  pages are labelled as not edition-established, never used as the selected ISBN's reference truth.
- An isolated `ProviderComparison` component with required injected transport and no default
  provider connection. An explicit click is the only request entry. A ref prevents duplicate
  in-flight calls; the client cancels at 30 seconds without retry. Only projected values enter
  component state, not the input DTO or a persistent/query/mutation cache.
- Account, work, ISBN, fingerprint, revision, permission epoch, and shared-page changes key a fresh
  session. Permission loss/sign-out/offline props unmount it. Blur, page hiding, and an offline event
  discard values and require a new caller-verified permission/context epoch. Expiry clears values;
  navigation/unmount aborts pending work. Late results cannot populate another session.
- Synthetic core/component tests, registry-keyed contrast checks, and a dev-only browser fixture.
  The fixture is outside the application entry, does not call providers, and has no saved reader
  data. Its separate Vite configuration refuses builds; the application's Nitro HTML renderer is
  not modified to serve a fake-data route.

## What these checks do not establish

This is not a deployed endpoint, new source-use permission, model improvement, provider accuracy
measurement, or identity-matcher qualification. A structurally valid hash is not verified origin
or authorization, and `checks.title: true` cannot prove a book identity. The future authenticated
server must perform independent exact ISBN/full-title/full-author/language admission and attest
only checks it actually performed. It must compute and recheck the full comparison fingerprint,
uniqueness, permissions, and provider policy before releasing the DTO.

There is deliberately no production route caller, ISBN selector, permission-refresh service,
server adapter, rate limiter, policy enrollment, persistence decision, or Apply action. Do not merge
the component/export on the strength of its fixture caller. Keep this branch draft until the real
caller is wired and verified under #519's separate live-use/retention and explicit owner gates.
An application `permission` prop is not server authorization. Five minutes is a maximum accepted
lifetime, not a default license to display live data.

No catalog/production database, billing, provider credential, consumed frame, attempt marker,
resolver configuration, or retired ISBNdb path is changed. Local E2E uses the existing disposable
Supabase test stack through its shared lock; local resets do not imply production deployment.

## Verification

- Core synthetic contract tests cover valid controls, individual rejected checks, spoofed source
  fields, invalid/expired envelopes, page conflicts, incomplete authors, audio/mixed binding,
  serialization exclusion, and input immutability.
- Component tests exercise explicit requests, duplicate clicks, timeout/late response, context and
  account changes, expiry, focus/offline/sign-out revocation, retained description drafts, and absent
  calls to actual Supabase RPC/table boundaries. Error sentinels do not reach rendering, error
  reporting, console, or localStorage. The real offline-dehydration filter excludes a sentinel DTO
  alongside an admitted reader-cache positive control. This does not qualify a future endpoint's
  HTTP cache, service-worker, analytics, or server logging paths: none exists here yet.
- Browser fixture inspection: desktop and 390px mobile screenshots; no page/card horizontal
  overflow across nine skins in both modes at 390px; zero scoped WCAG A/AA axe violations in those
  18 states. Keyboard Tab reaches the source link with a visible 2px solid outline. Fixture fonts
  use the existing CSS font stacks without loading the app's remote font stylesheet.
- Full unit/Workflow, typecheck, lint, and build gate passed before the final shared-page invalidation
  guard; focused component/typecheck/lint verification is being repeated for that guard.
- One fresh-local-database, default-one-worker, zero-retry full E2E run is in progress. Record its
  result before handing off; do not rerun a failed suite to erase the first outcome.

The other active chat was notified before edits and before shared-stack use. At the pre-publication
check its public PR #520 changed only `apps/web/e2e/a11y.spec.ts`, outside this draft's paths. Its
worktree and untracked brand folder were not modified.

The following local-only fixture command was executed successfully from the repository root:

```sh
pnpm --filter @reverie/web exec vite --config e2e/fixtures/provider-comparison.config.ts --port 4364
```

Open `http://127.0.0.1:4364/e2e/fixtures/provider-comparison.html` and choose Compare selected edition.
It displays a synthetic Google observation beside a synthetic Open Library title rejection.
Neither the identifier nor the page value is a bibliographic claim about a real book.
