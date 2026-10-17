# Intake adapter safeguards and frozen comparison — October 17

The adapter contract fixes preserve literal duplicate credits under review, keep known audiobook
formats from losing their page-count protection, and isolate malformed provider packets without
discarding valid peer observations. This comparison checks the revised path against new publisher
references. It does not qualify sources or switch Add, scanning, imports or catalog writers over.

## Frozen protocol and limits

The frame contains **six distinct print editions across six works**, each paired with one
wrong-creator control: **12 probes**, not 12 independent editions. Four editions are paperback and
two are hardcover; three works are fiction and three nonfiction. One is a Japanese-to-English
translation. The seven selected reference credits are six authors and one translator, not complete
contributor rosters. Five controls use an explicitly synthetic wrong-creator name; the sixth uses
the publisher-verified translator of Convenience Store Woman as the creator. The five synthetic
controls test obvious wrong-creator rejection, not difficult secondary-role attribution.

| Publisher reference / exact ISBN                                                                                                            | Selected format | Pages |
| ------------------------------------------------------------------------------------------------------------------------------------------- | --------------- | ----: |
| [The Fraud — 9780525558989](https://www.penguinrandomhouse.com/books/568108/the-fraud-by-zadie-smith/)                                      | Paperback       |   464 |
| [Entangled Life — 9780525510321](https://www.penguinrandomhouse.com/books/566795/entangled-life-by-merlin-sheldrake/)                       | Paperback       |   368 |
| [Educated — 9780399590504](https://images.penguinrandomhouse.com/teachers_guides/9780399590504.pdf)                                         | Hardcover       |   352 |
| [Convenience Store Woman — 9780802128256](https://groveatlantic.com/book/convenience-store-woman/)                                          | Hardcover       |   176 |
| [Piranesi — 9781635577808](https://www.bloomsbury.com/us/piranesi-9781635577808/)                                                           | Paperback       |   272 |
| [Braiding Sweetgrass — 9781571313560](https://milkweed.org/sites/default/files/books/readers_guide/World_of_Wonders_Discussion_Guide_1.pdf) | Paperback       |   408 |

The Educated publisher teacher guide joins the identity, ISBN, hardcover and page count on page 1.
The Braiding Sweetgrass entry in the publisher guide joins its identity, paperback ISBN and page
count on page 3; the publisher book page independently agrees on ISBN/pages. Neither special-edition
credits nor facts from another binding enter that reference. Convenience Store Woman uses the
hardcover section, not the paperback section with its different ISBN and page count. Its publisher
explicitly identifies Ginny Tapley Takemori as translator.

Original publisher pages/PDFs were inspected by an agent before provider acquisition. This is a
small purposive comparison, not independent human adjudication or representative qualification.
No manual-source admission arm is included. The sampler remains limited to print: the current
frame schema requires a positive page count and cannot honestly score an audiobook's null pages.
An inspected audiobook candidate was therefore excluded before freezing. External audiobook
coverage remains unmeasured; the synthetic audiobook regressions provide separate, bounded evidence.

Three candidates were excluded before freezing: James for an unresolved award-label title axis,
The Thursday Murder Club audiobook for the page-count schema limitation, and The Wild Robot after
a search unexpectedly exposed provider metadata. No post-freeze replacements were made. Initial
publisher-page errors were recorded before selecting inspected official alternatives. The Milkweed
PDF text retrieval succeeded, but its screenshot attempt timed out; no visual verification is claimed.

The combined history contains **482 entries before exact deduplication and 93 distinct target
entries afterward**, including prior target/reference variants, consumed frames, development cases,
synthetic fixtures and new exclusions. The older 120-entry manifest is one input, not a count of
120 unique exclusions. The [public lock](intake-adapter-lock-2026-10-17.json) binds the frame, code
and combined exclusion manifest. It was frozen against code `f67f51b` at **2026-10-17 22:11:08 UTC**.
Reference answers do not enter acquisition or resolution. The permanent single-use attempt remains
consumed; prior frames are unchanged and cannot be reacquired.

## Results

The one acquisition used **17 Open Library requests** (six edition redirects and 11 successful
responses) and **six successful Hardcover requests**. Neither source stopped. All requests succeeded
at the transport layer; the admission failures below are separate from network availability. Paired
controls reused each edition's captured response rather than acquiring it again.

| Identity result                                                 | Open Library | Hardcover |
| --------------------------------------------------------------- | -----------: | --------: |
| Correct-creator candidates matching the reference, out of six   |            2 |         2 |
| Correct-creator identities held with an observation, out of six |            3 |         2 |
| Correct-creator identities unobserved, out of six               |            1 |         2 |
| Wrong-creator controls held, out of six                         |            5 |         4 |
| Wrong-creator controls unobserved, out of six                   |            1 |         2 |
| False identity matches across 12 probes                         |            0 |         0 |

Zero false identity matches is not a perfect-accuracy claim. An unobserved control does not count
as a correct rejection. Candidate identity agreement is also separate from source-qualified work or
edition resolution: both adapters remain review-only with unknown upstream lineage.

| Edition field result, out of 12 opportunities (pages and format for six positive probes) | Open Library | Hardcover |
| ---------------------------------------------------------------------------------------- | -----------: | --------: |
| Agreements                                                                               |            4 |         2 |
| Disagreements                                                                            |            0 |         2 |
| Missing or identity-withheld                                                             |            8 |         8 |

Both Hardcover disagreements are page counts and remain under review. Its format observations agree
on the two matching identities, while unknown-format diagnostics remain visible. Open Library has
one malformed edition identity; Hardcover has two edition/parent-title conflicts. Other positive
holds retain title and/or contributor mismatch diagnostics. These codes do not establish why a
title differs or authorize treating it as harmless formatting. The provider values were not retained,
so this report neither reconstructs them nor claims to resolve those holds.

The verified translator control is held on both sources. Hardcover reports `secondary_role_only`;
Open Library reports a contributor mismatch. The latter is not proof that it observed the translator
with a correct role. No general translation-accuracy claim follows from this single control.

| Seven selected reference credits                | Open Library | Hardcover |
| ----------------------------------------------- | -----------: | --------: |
| Name/role/part agrees on an edition observation |            2 |         0 |
| Name/role/part agrees, work basis only          |            0 |         3 |
| Identity withheld                               |            5 |         4 |

The two Open Library edition observations are authors. Hardcover's three agreements remain
work-scope observations and cannot certify edition credits. Neither source certifies a complete
roster or acquires automatic credit authority. Private reports retain diagnostic codes, counts and
scores, not provider payload values, names, raw role labels or source records. Publisher reference
facts are separately documented above; they are not provider payloads.

The run produced **zero qualified work resolutions, zero qualified edition resolutions, zero proposed
fields, zero writes and zero model calls**. `cutoverReady` remains `false`. All source-use, lineage,
identity, edition and unsupported-fact review requirements remain in force.

## Verification and decision

Four new regression cases failed before the adapter fixes. Afterward, 190 targeted tests passed
across adapters, resolver, review, viewer, replay, shadow and edition-credit suites. The full unit
gate passed **3,388 core tests, 1,346 web tests, 498 source-trial tests and two Workflow tests**, plus
the root recovery/completion and environment checks. Synthetic tests exercise unknown-first known
audio formats, conflicting formats, duplicate literal roles, malformed packets, valid-peer
preservation and the inability of withheld credits to supply identity or claims.

The full fresh-database browser gate on `f67f51b` completed with **438 passed, 11 configured skips
and zero failures in 56.4 minutes**, at the repository's default one worker with zero retries.
Typecheck, lint, normal build and formatting also passed. Earlier failed runs remain retained in
the [browser environment verification record](browser-environment-stability.md). This is local
Chromium and mobile-emulation evidence, not production, WebKit or physical-device acceptance.
Remote CI remains unverified because the required connector requested a GitHub account connection.

The new comparison supports retaining the safeguards, not widening matching or promoting provider
facts. Page conflicts, title holds, unknown formats and source qualification remain unresolved.
Continue with field-specific verified-source review and broader evaluation, including honest
non-print scoring, before any intake cutover. Personal library data and reading history are outside
this provider comparison; it performs no database access or mutation.
