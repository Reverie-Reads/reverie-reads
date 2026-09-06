# Authority origin evaluation — 2026-09-05

## Outcome

The fixed 99-case acquisition sample remains safe but is not ready for production. After cleaning,
77 of 99 cases resolve correctly: 100% resolved accuracy, 100% membership precision, 91.0% series
recall, and zero false standalone or false series classifications. The previous replay resolved 76
cases with 89.7% series recall. Both runs used the same cached first-pass responses; the one-case
gain comes from deterministic cleanup, not a new model answer.

No real retrieval origin is active. This report does not approve a source, write authority gold,
change Supabase, update the corpus, or connect the scout to user matching.

## Fixed-sample replay

| Measure | Before cleanup | After cleanup |
| --- | ---: | ---: |
| Reviewed cases | 99 | 99 |
| Valid output | 93.9% | 94.9% |
| Policy-safe output | 85.9% | 86.9% |
| URL grounding | 100% | 100% |
| Resolved | 76.8% | 77.8% |
| Resolved accuracy | 100% | 100% |
| Effective accuracy | 76.8% | 77.8% |
| Series precision | 100% | 100% |
| Series recall | 89.7% | 91.0% |
| False standalone / false series | 0 / 0 | 0 / 0 |

The original full run made 51 model calls, reused 48 cached cases, issued 148 hosted-search calls,
and consumed 1,386,899 input plus 52,677 output tokens. The cleanup replay made no network or model
calls and reused all 99 raw responses.

The recovered case was _Accomplice to the Villain_. The model supplied a supported author-page
membership in `Assistant to the Villain` and a conflicting publisher-name membership whose URL was
the case's selection-frame source. Cleaning correctly demoted that source to identity-only. It now
also removes only the membership that depended on the demoted source, allowing the independently
supported claim to validate. An initially uncited claim remains invalid, and a series output with
no supported membership remains unresolved.

## L.J. Shen author site

Candidate origin: [authorljshen.com](https://www.authorljshen.com/). Registry status: `pending`.

A delegated live probe used an in-memory, short-lived profile only; the committed profile stayed
inactive. The gateway selected `/all-books/` over the homepage and title detail URL, then chose the
exact _Ruthless Rival_ child from its link title. The ordinary path used exactly three GETs: robots,
parent, and child. Every request connected to the validated public address `192.124.249.40` and
remained on the profiled origin.

The child returned HTTP 200 `text/html`, 143,455 encoded bytes and 143,445 decoded characters, with
no truncation. The redacted manifest retained gateway/policy/profile/extractor versions, URLs,
request counts, the selected anchor and score, public connection address, hashes, media type, and
byte counts. It did not retain HTML or the sanitized evidence packet.

The second strict, no-tools model call used 1,039 input and 240 output tokens and took 2.827 seconds.
It correctly proposed `Cruel Castaways`, position 1, from the extracted title/series metadata.
Deterministic policy then rejected the classification because the terminal title URL is also this
case's declared selection-frame URL. That is the intended truth-blind anti-leakage result, not a
retrieval failure. It remains useful evidence that catalog-parent selection, image-link title
fallback, inline labelled-metadata extraction, `#1` position parsing, and redaction work together.

The live robots file allowed ordinary public paths while excluding `/wp-admin/`. The site linked a
privacy page but no site-specific terms were found. Robots permission is not a data-use grant, so
the origin remains pending until a human owner completes and records the rights review.

## Penguin UK

Candidate origin: [penguin.co.uk](https://www.penguin.co.uk/). Registry status: `manual_only`.

Penguin's public
[_Accomplice to the Villain_ page](https://www.penguin.co.uk/books/459774/accomplice-to-the-villain-by-maehrer-hannah-nicole/9781804993408)
and [series page](https://www.penguin.co.uk/series/ATTV/assistant-to-the-villain) expose strong,
exact-work series metadata. However, its current
[terms and conditions](https://www.penguin.co.uk/about/useful-links/terms-conditions) reserve the
site content and prohibit copying, storing, downloading, or other use without prior written
approval; commercial use requires a licence. Public accessibility and robots behavior do not
override that contract. The gateway must not automate this origin without written permission or a
supported licensed feed.

## Code changes exercised

- Prefer a shallow consulted catalog hub over the same origin's homepage or detail page, preserving
  the one-child budget for exact-title navigation.
- Recognize an image-only anchor's `title` attribute only when visible text and `aria-label` are
  absent.
- Preserve adjacent, strongly labelled bibliographic metadata as one inert evidence line without
  retaining surrounding page text.
- Accept `#N` as an explicit integer position only on the same exact-work relationship line.
- Discard a membership only when it originally cited evidence and every cited source was then
  deterministically demoted; never hide an initially malformed or uncited claim.
- Version the changed extractor as `authority-evidence-extractor-v2`.

## Decision

Merge the deterministic cleanup and retrieval robustness changes, but keep both live sites out of
automated acquisition. The next live gate should use a source whose rights are affirmatively usable
and whose independently discovered terminal page is not part of that case's selection frame. The
fixed navigation-needed stratum still must show at least a 25% reduction in unresolved misses before
the gateway can justify a production pilot.
