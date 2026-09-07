# ADR 0009 — Bounded authority retrieval gateway

Status: accepted for bounded trial implementation, 2026-09-05.

## Context

The authority scout uses hosted web search to find author and publisher evidence without receiving
the case truth or known authority URLs. That is a useful discovery layer, but search cannot reliably
reach a first-party series page that is linked from a consulted site and absent from the search
index. The same-origin experiment for _Pyg_ demonstrated both sides of the failure: search missed
the author's `/series` page, then a repeat incorrectly reversed a spin-off statement into series
membership without consulting that page.

Another prompt revision cannot make an unreturned page available. Letting application code fetch an
arbitrary model- or user-supplied URL would instead create an SSRF-capable crawler, a new privacy and
rights boundary, and evidence that is difficult to reproduce. The next experiment needs more recall
without granting the model general network access or relaxing the existing evidence policy.

## Decision

Build a **trial-only, single-hop authority retrieval gateway**. It is not a general crawler and it
is not a Supabase Edge Function.

The gateway may run only when the first scout request:

1. is unresolved or has no classification-eligible source;
2. consulted an exact HTTPS author or publisher URL recorded in the hosted-search manifest; and
3. resolved that URL to an origin whose automated-access profile is currently approved.

It will fetch the consulted page, deterministically choose at most one same-origin navigation link,
fetch that page, and reduce it to a small, inert evidence packet. A second strict-output model call
may interpret the packet. Existing deterministic validation and human review remain the only path
from model output to a usable proposal.

When the same reviewed origin contributed several consulted URLs, the gateway prefers a shallow
catalog-style hub such as `books`, `series`, `bibliography`, or `reading-order` over both the
homepage and a detail page. This preserves the one-hop budget for the exact-title child instead of
spending it merely reaching the site's catalog. Source-kind priority, shallow depth, and lexical
order remain deterministic tie-breakers; the model never chooses the parent.

The first implementation belongs only in `packages/series-source-trial`. It has no database client,
service-role credential, corpus writer, browser engine, JavaScript runtime for fetched content, or
production route.

The first implementation slice supplies the deterministic network, origin-profile, robots, static
HTML selection/extraction, provenance, redaction, and failure primitives under
`src/authority/retrieval/`. A second slice connects those primitives to the acquisition command
behind `--retrieval` and adds a strict, no-tools interpretation pass. The second pass receives only
the exact target, hash-bound child packet, reviewed source kind, and provenance versions. It may
replace the first proposal only when the packet contains the exact target title and author and
deterministic post-validation finds packet support for the claimed author identity, series name,
standalone language, and position. Unsupported position becomes null and unsupported membership
role becomes unknown without discarding a direct relationship. At that integration stage, no real
origin was approved by the repository.

Before validation, a membership that originally cited evidence but loses every citation because
all of its sources were deterministically demoted is removed. This permits a separately supported
membership in the same proposal to survive without laundering the risky source. An originally
uncited membership remains visible and invalid, and a series classification with no remaining
membership still fails closed.

## Retrieval contract

### Inputs

The gateway accepts only:

- the case id, title, author, and optional publication year already supplied to the scout;
- one `consultedUrl` copied exactly from that response's consulted-source manifest; and
- a versioned origin profile selected by normalized origin, never by the model.

It rejects an arbitrary URL from a user, an LLM field, a provider packet, or an ungrounded citation.
The origin profile records the canonical HTTPS origin, explicitly accepted canonical aliases,
source kind, access status, terms/robots review references, review time, expiry, and reviewer. A new
origin begins `pending`; pending, expired, blocked, authenticated, paywalled, or technically guarded
origins are not fetched.

### Network boundary

Every request, including `robots.txt` and every redirect hop, must pass the same checks:

- Parse with the WHATWG URL implementation. Permit HTTPS on the default port only. Reject embedded
  credentials and IP-literal hosts, strip fragments before comparison or logging, and reject every
  non-HTTPS scheme.
- Resolve every A and AAAA answer and reject the request if any answer is loopback, private,
  link-local, multicast, reserved, documentation, unspecified, carrier-grade NAT, or cloud metadata
  space. Pin the connection to a validated public answer while preserving TLS hostname validation;
  do not validate with one DNS result and connect through a later lookup.
- Disable automatic redirects. Follow at most two manually, re-running URL, origin-profile, and DNS
  checks at each hop. A redirect may use only a canonical alias declared in the profile; content
  navigation after canonicalization must stay on the canonical origin.
- Send a named, contactable `ReverieAuthorityScout` user agent with no cookies, authorization,
  referrer, user-specific headers, or browser state. Do not bypass CAPTCHAs, rate limits, access
  controls, or bot challenges.
- Honor RFC 9309 before every actual content request, including a redirect destination, using that
  request's origin-specific policy. A matching disallow blocks the request. A robots network error
  or 5xx fails closed. A 4xx robots response may be unavailable under the RFC, but access still
  requires an approved origin profile. Share in-flight and completed decisions across cases in the
  process and cache completed decisions for no more than 24 hours.
- Use one attempt with no automatic retry, a five-second connection/header deadline, and a
  ten-second total deadline. Limit each origin to one active request and one request per second.
- Accept only a successful HTML or plain-text response. Stop after 512 KiB of encoded bytes or
  512 KiB of decoded text, regardless of `Content-Length`; reject type mismatches, archive formats,
  XML with external entities, and decompression expansion beyond the cap.

The limits are deliberately tighter than a browser's. A normal author page that cannot fit this
contract becomes a manual-review source; it does not justify widening the network surface silently.

### Link selection and extraction

The parent document is untrusted data. Parse static markup without loading scripts, styles,
iframes, images, fonts, forms, feeds, manifests, or subresources. Resolve anchors with the same URL
parser and keep only links on the canonical origin that also pass robots policy.

Rank navigation candidates deterministically from visible anchor text, accessible label, and path:

- prefer exact title links and explicit `series`, `books`, `bibliography`, `catalog`, or
  `publications` language;
- demote store, cart, account, event, tour, press, contact, privacy, and social links;
- reject downloads, query-heavy URLs, fragments of the parent, and logout or mutation-looking paths.

Fetch only one unique highest-scoring candidate above a fixed threshold. A tie or no qualifying link
is unresolved. The model does not choose the URL, and the child page is terminal: the gateway never
follows its links.

Reduce the child to its document title, headings, list/table labels, and nearby visible prose with
source order preserved. Remove scripts, styles, templates, forms, comments, hidden or structured
active content, and control characters. Ordinary visible prose—including prompt-like prose—remains
inert evidence, never instructions. Cap the packet at 8,000 Unicode characters and mark every
omitted range.

A narrow catalog capability may treat headings as relational structure only when the current
human-reviewed origin profile explicitly grants `repeated_numbered_catalog_headings` and the
gateway binds that capability into the retrieval manifest. Even then, the terminal URL must be a
shallow, query-free recognized catalog path, at least two headings must share the same non-generic
series prefix, their integer positions and titles must be distinct, and one title must exactly equal
the target. An isolated numbered heading, a detail page, mixed prefixes, or generic singular or
plural prefixes such as `Chapter`, `Parts`, and `Volumes` remain insufficient. This recognizes
reviewed author catalogs shaped like `High King 1: The West Rises` followed by `High King 2: Under
the Dragon` without granting that page-shape interpretation to unrelated origins. At the time this
capability was introduced, no committed real origin had it.

### Model and evidence boundary

The optional second model request receives the minimal case identity, the sanitized packet, and its
gateway manifest. It uses the existing strict authority schema and may cite only the terminal child
URL present in that manifest. It cannot request another page, broaden the origin, or treat the
gateway's successful fetch as source eligibility.

All current cleaning remains in force. In particular, one non-heading extracted evidence line must
join the exact target title to each claimed bibliographic series or affirmative standalone
statement, except for the repeated-numbered catalog structure defined above. Position and
membership role survive only on that same relationship line or exact catalog entry. This blocks a
model from assembling the target identity and another book's series facts across a multi-book page.
A universe, trope, trigger warning, reading order, shared character, companion, or spin-off
statement cannot be reversed into membership. The gateway changes reachability, not authority.

Every outcome remains review-only. A timeout, block, miss, parse failure, or absent label means
unresolved, never standalone and never “not in a series.”

## Provenance and privacy

The result manifest records:

- case id and extractor/policy/profile versions;
- the finite evidence capabilities granted by the reviewed profile;
- grounded parent URL, selected anchor text and URL, canonical final URL, and redirect chain;
- retrieval time, status, declared media type, encoded/decoded byte counts, truncation state, and
  response `ETag`/`Last-Modified` when present;
- validated public connection address, robots decision and cache age, deterministic selection
  score, and SHA-256 hashes of the fetched and sanitized representations; and
- a typed terminal result such as `retrieved`, `origin_pending`, `robots_disallow`,
  `robots_unreachable`, `unsafe_url`, `unsafe_dns`, `redirect_outside_profile`, `too_large`,
  `unsupported_media`, `timeout`, `request_limit`, `no_candidate`, `ambiguous_candidate`, or
  `parse_failure`.

Raw HTML and sanitized page text are ephemeral and excluded from committed reports and ordinary
caches. Reports retain the URL, hashes, retrieval metadata, short model paraphrase, and decision so a
reviewer can re-open the public source. A future need to retain source text requires its own rights,
retention, and access-control decision.

The request contains no user id, household id, library contents, ownership, rating, reading history,
notes, moods, or matching profile. User book matching may consume a later reviewed corpus fact; it
must not send private matching context through this acquisition path.

Robots rules are an automated-access signal, not authorization. An origin profile therefore also
requires a terms/data-use review, and a technical refusal remains a refusal. A source owner can be
blocked immediately by profile without a code release.

## Cost and failure budget

For one eligible unresolved case, the gateway permits at most nine actual GETs total and one
additional model call. The ordinary canonical, no-redirect path uses one robots GET plus two content
GETs. Redirects consume the same hard budget, and touching a reviewed canonical alias requires that
origin's own robots decision. There are no recursive links or retries. The sanitized packet and
second prompt together should keep that additional call below 12,000 input tokens and the existing
1,400-output-token ceiling. Reports must separate first-pass search cost, retrieval cost, and
second-pass model cost so the feature can be disabled without obscuring spend.

The gateway is optional. Any internal error returns the typed unresolved result and leaves the
original scout proposal intact for review; it cannot make an unsafe proposal valid.

## First live-origin candidate

`https://www.pipwritesfiction.com` remains `pending`; it is evidence about the gateway, not an
activated source profile. A 2026-09-05 request with the named trial user agent found an explicit
`User-agent: *` allow rule in `/robots.txt`, a canonical redirect from the non-`www` origin, no
linked site-specific terms or privacy page, and no authentication challenge. Robots permission is
not a rights grant, so this observation does not satisfy the human source review.

The same probe measured 903,233 encoded bytes for `/` and 627,478 for `/series`; both exceed the
512 KiB limit. The safe static extraction from `/series` names The Leamington Bloom Series but does
not directly place _Pyg_ inside it. A `PYG, GOODREADS` control label and an outbound store URL are
not exact-work relational evidence. The correct result is therefore unresolved. The limit and
extractor are unchanged: a future decision to accommodate Wix-sized pages or treat accessible
control labels as evidence needs separate justification, tests, and security review.

`https://www.authorljshen.com` was `pending` during the initial probe. A bounded delegated probe
reached the public
_Ruthless Rival_ title page from `/all-books/` within the ordinary three-request path and extracted
the exact `Cruel Castaways #1` metadata, but that title URL is the case's declared selection frame.
The anti-leakage policy correctly demoted it to identity-only, so it did not count as a successful
classification. The site exposed a permissive robots rule outside `/wp-admin/` and linked a privacy
page but no site-specific terms. Those observations alone were not an affirmative rights review or
an activation.

On 2026-09-06 America/Los_Angeles, the Reverie owner approved a 30-day, no-write internal trial for
this one origin after reviewing that distinction. Profile `authorljshen-approved-trial-v1` expires
on 2026-10-07T06:40:08Z and fails closed after expiry. The approval permits only the existing
bounded static retrieval path; it is not permission from the site owner, does not broaden the
anti-leakage policy, and does not connect the retriever to Supabase, corpus writes, or production.
The contemporaneous decision record is
`packages/series-source-trial/reports/authority-origin-approval-pilot-2026-09-06.md`.

`https://www.penguin.co.uk` is `manual_only`. Its public title and series pages contain strong
bibliographic relationships, but its current terms prohibit copying, storing, downloading, or
other use of site content without prior approval and prohibit commercial use without a licence.
Reverie therefore does not automate the site through this gateway without written permission or a
supported licensed feed.

The 2026-09-07 coverage review added three explicit non-active profiles. `smdaviesauthor.com`
initially remained `pending`: its public books page exposes the repeated `High King 1` / `High King
2` catalog shape and its privacy page identifies the author-operated site. `alihazelwood.com` and
`penguinrandomhouse.com` remain `manual_only` because their linked terms prohibit robots or similar
automated extraction. Details are in
`packages/series-source-trial/reports/authority-origin-coverage-evaluation-2026-09-07.md`.

Later on 2026-09-07, the S. M. Davies technical review confirmed public-only DNS answers, valid
HTTPS, a canonical redirect from the `www` alias, a robots policy allowing the public catalog, and
a successful three-request canonical gateway path from the homepage to `/books/`. No site-specific
terms or affirmative reuse licence was found; robots availability remains only a technical signal.
The Reverie owner nevertheless approved the same narrow 30-day, no-write internal evaluation
boundary used for the first author-site pilot. Profile `smdaviesauthor-approved-trial-v1` expires on
2026-10-07T19:20:57Z and alone grants `repeated_numbered_catalog_headings`. The profile cannot
inject the origin into discovery and cannot write a classification or corpus row. The review and
decision are recorded in
`packages/series-source-trial/reports/authority-origin-approval-sm-davies-2026-09-07.md`.

## Trial acceptance gates

Implementation is not ready for a production pilot until all of these are demonstrated:

1. **Network safety:** unit/integration fixtures cover IPv4 and IPv6 special ranges, alternative IP
   encodings, credentials and ports, mixed DNS answers, DNS rebinding/connection pinning, every
   redirect hop, metadata targets, oversized/chunked/compressed bodies, MIME mismatch, slow headers,
   slow bodies, malformed markup, and subresource non-fetching. No subsequent request is sent after
   an unsafe target is identified.
2. **Access policy:** deterministic tests cover allow/disallow precedence, robots 4xx/5xx/network
   outcomes, 24-hour expiry, pending/expired/blocked origins, canonical aliases, and immediate
   operator opt-out.
3. **Evidence integrity:** every cited URL exists in the same retrieval manifest, every packet hash
   is reproducible from its fixture, raw content is absent from reports/caches, and prompt-like page
   text cannot alter the schema or cause another fetch.
4. **Accuracy:** run a paired, truth-blind evaluation on the fixed authority sample and a separately
   declared navigation-needed stratum. Membership precision and standalone safety must remain 100%,
   with no newly accepted false positive. The navigation-needed stratum must reduce unresolved
   authority misses by at least 25%; otherwise the added boundary is not justified.
5. **Efficiency:** across the fixed sample, the mean must remain at or below 1.25 model calls per
   selected case, retrieval p95 must remain below ten seconds, and the request/byte/token ceilings
   above must hold without exceptions.
6. **Review:** the implementation receives a security-focused diff review and a source-rights review,
   and the live report documents failures as well as successes. Production integration still waits
   for the existing 200-case accuracy, rights, privacy, latency, and cost gates.

## Consequences

- The scout can reach a navigation-linked first-party series page without depending on search-index
  recall.
- The model remains an interpreter of a bounded packet, not a browser or fetch authority.
- Long-tail author sites require a lightweight origin review before retrieval; some cases will stay
  unresolved rather than being fetched optimistically.
- The design adds engineering and review work, but caps it at one non-recursive hop and makes the
  failure modes observable and reversible.
- No production, Supabase, corpus, authority-gold, or user-matching behavior changes by accepting
  this ADR or implementing its trial.

## References

- [OWASP SSRF Prevention Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/Server_Side_Request_Forgery_Prevention_Cheat_Sheet.html)
- [OWASP SSRF Prevention in Node.js](https://owasp.org/www-community/pages/controls/SSRF_Prevention_in_Nodejs.html)
- [RFC 9309 — Robots Exclusion Protocol](https://www.rfc-editor.org/rfc/rfc9309.html)
- [WHATWG URL Standard](https://url.spec.whatwg.org/)
- [WHATWG Fetch Standard](https://fetch.spec.whatwg.org/)
