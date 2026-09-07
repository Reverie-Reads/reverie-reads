# L.J. Shen authority-origin approval pilot

Date: 2026-09-06 America/Los_Angeles (approval recorded 2026-09-07 UTC)

## Decision

The Reverie owner approved a 30-day internal `approved_trial` profile for
`https://www.authorljshen.com`. The profile expires at `2026-10-07T06:40:08.000Z` and must fail
closed after that instant. This is an internal risk decision for a bounded technical evaluation,
not permission from L.J. Shen or the site's operator.

The approval covers only the existing no-write authority retrieval gateway. It permits one parent
page and at most one deterministic same-origin child after robots, public-address, redirect,
content-type, size, and profile checks. The trial sends no cookies or authentication, loads no
JavaScript or subresources, retains no raw page text, and has no Supabase, corpus, or production
write path.

## Review evidence

- Hachette's official L.J. Shen author profile links `authorljshen.com` as the author's website:
  https://www.hachette.co.uk/contributor/l-j-shen/
- The public robots policy allows paths outside `/wp-admin/` and points to the site's sitemap:
  https://www.authorljshen.com/robots.txt
- The public catalog page responded successfully and exposes book and series navigation:
  https://www.authorljshen.com/all-books/
- The site exposes a privacy policy but no separate site-specific terms page was found in the
  reviewed navigation: https://www.authorljshen.com/privacy-policy/
- The retriever's named-user-agent contact URL responded successfully:
  https://reveriereads.app/data-sources

Robots permission and public availability are technical access signals, not an express content
license. The profile therefore remains narrow, temporary, attributable, reversible, and subject to
the same deterministic evidence and anti-leakage rules as every other origin.

## Trial case and acceptance criteria

Run only gold case `reverie-cruel-castaways-ruthless-rival` with fresh authority acquisition and
optional retrieval enabled. The trial passes the safety boundary when:

1. the reviewed origin is eligible before expiry and becomes `origin_pending` at expiry;
2. the gateway stays within its request, navigation, type, size, and timing limits;
3. persisted output contains hashes and structured paraphrase, never raw page text;
4. the exact-title selection-frame rule still prevents the retrieved page from becoming independent
   classification evidence for this case; and
5. no production or Supabase write occurs.

This approval does not authorize a broader batch or another origin. Record the observed run below
before merging the profile.

## Observed run

Two complementary runs separated discovery behavior from the newly approved retrieval profile.

### Fresh integrated acquisition

The current `authority-acquisition-v7-attribution-preserving-evidence` scout ran the exact gold case
with `--retrieval --refresh`. It made one model call and four hosted web-search calls, consuming
22,233 input tokens and 505 output tokens. It found the correct third-party relationship but did not
consult `authorljshen.com`; the profile therefore could not supply a manifest-grounded parent URL.
The gateway correctly recorded `origin_pending` with zero retrieval attempts, zero HTTP requests,
and zero second-pass calls. The first-pass output remained unresolved and invalid because its
matched identity had no authority evidence.

This is a discovery miss, not a profile or network-gateway failure. It shows that approving an
origin does not inject that origin into the truth-blind scout and does not guarantee the scout will
find it on any one run.

### Manifest-grounded profile isolation

A replay used the earlier truth-blind
`authority-acquisition-v3-explicit-bibliographic-memberships` scout artifact for the same case. Its
consulted-source manifest included the official catalog and exact-title URLs. The replay retained
the case's exact title page as blocked selection-frame evidence so the activation test could not
convert the known source into independent corroboration.

At `2026-09-07T06:48:40.510Z`, the gateway selected `/all-books/`, fetched `robots.txt`, the catalog,
and the deterministic `Ruthless Rival` child, and completed with:

- 3 of 9 allowed HTTP requests;
- 143,455 encoded bytes from the child response;
- HTTP 200 `text/html`, no redirect outside the approved profile, and no truncation;
- one second-pass model call using 1,119 input and 241 output tokens; and
- no persisted `evidenceText` field.

The second pass correctly proposed _Ruthless Rival_ as `Cruel Castaways #1`. Deterministic cleaning
then demoted the blocked exact-title source to identity-only, removed the unsupported automatic
membership, and kept `selectedPass: first`. The resulting interpretation was invalid and
policy-unsafe for automatic selection. This is the expected anti-leakage outcome: the activated
profile can perform bounded retrieval, but neither the model nor the profile can override source
eligibility.

### Trial result

The profile activation, expiry boundary, network limits, manifest binding, content redaction, and
selection-frame quarantine behaved as designed. No Supabase, corpus, or production write occurred.
The trial does not yet establish an accuracy gain because the fresh scout failed to discover the
approved origin; source discovery remains the limiting capability to evaluate next.
