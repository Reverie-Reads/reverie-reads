# Authority origin coverage evaluation

Date: 2026-09-07 America/Los_Angeles

## Decision

Record three additional first-party origins without activating any of them. S. M. Davies is the
only plausible next bounded author-site trial in this slice and remains `pending` until its
technical access review is complete and the Reverie owner separately approves a time-boxed internal
trial. Ali Hazelwood and Penguin Random House are `manual_only` because their linked terms prohibit
automated access or data extraction.

This change also makes the deterministic interpreter understand one narrow author-catalog shape:
two or more headings such as `High King 1: The West Rises` and `High King 2: Under the Dragon` on a
shallow catalog page. That interpretation is available only when the current reviewed origin
profile grants a finite capability that is bound into the gateway manifest. No real origin has that
capability in this patch. It does not accept an isolated numbered heading, a detail page, mixed
series prefixes, or generic section prefixes. The change is trial-only, review-only, and activates
no network request by itself.

## S. M. Davies

Registry status: `pending`.

- The author-operated books page identifies `High King 1: THE WEST RISES` and `High King 2: UNDER
  THE DRAGON`: https://smdaviesauthor.com/books/
- The linked privacy page identifies S. M. Davies as the site operator and WordPress.com as the
  designer and host: https://smdaviesauthor.com/privacypolicy/
- No site-specific terms or affirmative automation/reuse permission was found in the reviewed
  navigation.
- The browser safety layer blocked a direct `robots.txt` view, so the review did not bypass that
  control and the gateway-specific robots and redirect review remains incomplete.

The exact books page was not present in the fresh v11 scout manifest for `The West Rises`, so an
approved profile would not have changed that recorded run. A later truth-blind scout must discover
the origin independently before the gateway can use it; the profile must never inject the URL.

## Ali Hazelwood

Registry status: `manual_only`.

The author's linked terms permit personal, noncommercial use and explicitly prohibit using robots,
spiders, or other automatic processes to access the site, including for monitoring or copying
material. Reverie must not run the automated gateway against this origin without written
permission. Source: https://alihazelwood.com/terms-of-use/

The public `Mate` page remains useful for human review, but its companion language does not by
itself establish the reviewed `Bride` bibliographic series. The manual-only decision therefore
does not reduce an otherwise automatic source path.

## Penguin Random House US

Registry status: `manual_only`.

The terms linked from `penguinrandomhouse.com` apply to that site and prohibit collection or use of
product listings and descriptions through data mining, robots, or similar extraction tools. The
gateway must not automate this origin without express permission or a supported licensed feed.
Source: https://www.penguinrandomhouse.com/terms/

This blocks using the publisher's `Bride & Mate` merchandise page as an automated workaround. That
page may remain a human-reviewed citation, but a merchandising description is already
classification-risky and the access terms independently prevent automated retrieval.

## Catalog safeguard

The added rule is deterministic and narrower than accepting headings generally. It requires:

1. the current approved origin profile to grant `repeated_numbered_catalog_headings`, with an exact
   capability match in the retrieval manifest;
2. the terminal child URL to be one shallow, query-free catalog path already recognized by the
   parent selector;
3. at least two headings with the same normalized, non-generic prefix;
4. at least two distinct positive integer positions and distinct titles;
5. one heading whose title exactly equals the target; and
6. the proposed series name to equal the repeated prefix.

Position survives only when it equals the integer in that exact target heading. Role still clears
to `unknown` unless explicitly stated. Existing target-author identity, hash, source-profile,
manifest-grounding, selection-frame, and ordinary validation checks remain unchanged.

An initial security pass showed that making this structural rule global to every approved origin
would accept an unrelated prefix such as `Top 1` / `Top 2`. The final implementation therefore
makes the rule an allowlisted per-origin capability, rejects unknown capabilities, binds the exact
capability set to the retrieval manifest, and rechecks it before provider evidence is emitted.
Synthetic regressions cover the intended `High King` pattern and reject a missing capability, an
isolated heading, mixed prefixes, a nested detail URL, and generic `Chapter` headings. No live
retrieval was run because the only newly plausible origin remains pending.

## Boundary and next gate

No Supabase request, corpus write, authority-gold edit, production deploy, new active origin, or
model call occurred. The profile registry now makes known access decisions explicit instead of
leaving these origins indistinguishable from unreviewed sites.

The next gate is to complete the technical robots and redirect review for `smdaviesauthor.com`.
Only if that review passes should the owner decide whether to approve a short, no-write internal
trial and explicitly grant the catalog-heading capability. Any approved run must still begin with
truth-blind hosted search and may use the gateway only if that same run consulted the origin.
Failure to discover it remains unresolved; approval is not permission to inject or construct the
URL.
