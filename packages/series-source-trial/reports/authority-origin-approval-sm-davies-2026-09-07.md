# S. M. Davies authority-origin approval pilot

Date: 2026-09-07 America/Los_Angeles

## Decision

After the technical access review below passed, the Reverie owner approved a 30-day internal
`approved_trial` profile for `https://smdaviesauthor.com`. The profile expires at
`2026-10-07T19:20:57.000Z` and must fail closed at that instant. It grants the finite
`repeated_numbered_catalog_headings` capability because the author's catalog exposes two distinct
`High King` titles with explicit integer positions.

This is an internal risk decision for a bounded, no-write technical evaluation. It is not
permission from S. M. Davies, WordPress.com, or another site operator, and it is not an affirmative
content licence. The profile cannot inject an origin into truth-blind discovery, broaden the
selection-frame policy, write authority gold, call Supabase, or change the Reverie corpus.

## Review evidence

- The author-operated books page labels the exact works `High King 1: THE WEST RISES` and `High
  King 2: UNDER THE DRAGON`: https://smdaviesauthor.com/books/
- The linked privacy page identifies S. M. Davies as the site operator and WordPress.com as the
  designer and host: https://smdaviesauthor.com/privacypolicy/
- The site's current `robots.txt` returned HTTP 200 `text/plain` for Reverie's named user agent. Its
  wildcard group disallows `/wp-admin/`, expressly allows `/wp-admin/admin-ajax.php`, and does not
  disallow the homepage or `/books/`: https://smdaviesauthor.com/robots.txt
- The reviewed homepage navigation links the public books and privacy pages but no site-specific
  terms page. Direct checks of `/terms/` and `/terms-of-use/` returned HTTP 404.
- Reverie's named-user-agent contact URL returned HTTP 200:
  https://reveriereads.app/data-sources

Robots rules and public availability are technical access signals, not authorization or a reuse
licence. The absence of a prohibitory site-specific term is not affirmative permission. The
profile therefore remains narrow, temporary, attributable, reversible, and review-only.

## Technical boundary

The review resolved `smdaviesauthor.com` and `www.smdaviesauthor.com` only to public WordPress.com
IPv4 addresses; neither hostname returned an IPv6 address. HTTPS certificate validation succeeded.
The canonical HTTPS homepage and `/books/` returned HTTP 200. The `www` HTTPS alias redirects once
to the canonical HTTPS origin while preserving the path. HTTP also redirects to HTTPS, but the
gateway continues to reject an HTTP input before making a request.

Two live, redacted gateway probes used a temporary injected profile before the registry change:

1. The canonical homepage path used three of nine allowed requests: `robots.txt`, the homepage,
   and the deterministically selected `/books/` child. It returned HTTP 200 `text/html`, selected
   the `Books` anchor, stayed on the canonical origin, and retained only hashes and manifest data.
2. The `www` alias path used six of nine allowed requests because the gateway independently checked
   robots policy for the alias and canonical origins around the redirect. Every connection remained
   on a reviewed public address, and the final child was the same canonical `/books/` page.

The child response was 132,303 encoded bytes, below the 512 KiB ceiling, and produced a complete
sanitized packet without truncation. Neither redacted probe persisted page text or invoked a model.

## Trial case and acceptance criteria

Run only gold case `selfies-2023-fiction-the-west-rises` with fresh truth-blind authority
acquisition and optional retrieval enabled. The pilot passes only when:

1. hosted search independently consults this approved origin; otherwise retrieval remains
   unresolved and makes no attempt to construct or inject the URL;
2. the gateway remains within its request, navigation, type, size, timing, public-address, redirect,
   and robots limits;
3. the retrieved packet contains the exact title and author, and the repeated-numbered-heading rule
   accepts only the explicit `High King` relationship;
4. persisted output contains hashes and structured paraphrase, never raw page text;
5. automatic selection still requires the ordinary deterministic eligibility and source-policy
   checks; and
6. no production, Supabase, gold, or corpus write occurs.

## Observed run

Two runs separated fresh discovery from the already-reviewed retrieval and interpretation path.

### Fresh truth-blind acquisition

The current `authority-acquisition-v11-preserve-series-label` scout ran only
`selfies-2023-fiction-the-west-rises` with `--retrieval --refresh`. It received only the title,
author, and publication year. One model call made three hosted searches and consumed 18,125 input
tokens plus 532 output tokens. The output was valid, policy-safe, and unresolved.

The consulted-source manifest included third-party title and relationship results but did not
include `smdaviesauthor.com`. The gateway therefore made zero retrieval attempts, zero HTTP
requests, and zero second-pass calls. It recorded `origin_pending` and retained the first pass. This
is the required anti-injection behavior: approving the profile does not make a known gold URL
available to the scout. It also means this fresh run delivered no end-to-end recall or accuracy gain;
first-party discovery remains the bottleneck for this case.

### Manifest-grounded profile isolation

A separate isolation replay supplied only the already-observed canonical homepage as the simulated
same-run consulted URL. This is not truth-blind discovery and does not count toward accuracy. It
exists to verify the downstream capability if a future scout independently finds that homepage.

The gateway used three requests, selected the `Books` navigation anchor, and retrieved the canonical
`/books/` child. The no-tools interpreter consumed 1,533 input tokens and 235 output tokens. It
proposed `The West Rises` as `High King` position 1 with unknown membership role, citing only the
retrieved author page. Deterministic validation found the proposal valid and policy-safe, and the
retrieval pass matched the reviewed gold relationship. Persisted retrieval output contained the
manifest and hashes but no page text.

### Trial result

The public-network, TLS, alias redirect, per-origin robots, bounded navigation, size, redaction,
profile-capability, model-interpretation, and expiry boundaries passed. The isolated downstream path
produced the correct relationship, while the fresh end-to-end path correctly abstained because it
did not discover the origin. No Supabase, authority-gold, corpus, or production write occurred.

Keep the profile narrowly active through its expiry so future truth-blind runs can use it when the
origin naturally enters their consulted-source manifest. Do not broaden search by injecting the
domain or constructing its URL. Evaluate discovery improvements separately against a multi-case
holdout rather than tuning a query to this known gold source.
