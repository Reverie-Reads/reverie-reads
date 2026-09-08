# Authority qualification source intake

Status: implemented first-party publisher and independent-award lanes; qualification pool remains
private and unsealed.

## Decision

Use the Penguin Random House Enhanced API as the first traditional-publisher intake, not automated
extraction from PRH or Hachette retail pages. PRH describes the service as its public title and
author metadata API and requires a registered access key. Its Work resource groups editions under
one publisher-managed work ID and exposes exact related author, category, series, and title
resources. Its Series resource exposes publisher series codes, names, counts, numbered status, and
the related-work roster.

The intake captures a complete, bounded `PRH.US` work listing by explicit publication-date range,
paginates in stable work-ID order, and reconciles the advertised record count with both the number
of rows and unique work IDs. This makes the API query an auditable identity-selection frame rather
than a handpicked list. The qualification key and all case identities remain in ignored private
storage.

Use the four official 2025 Independent Publisher Book Awards medalist pages as a separate,
complete independent-publishing selection frame. The fixed capture covers every distinct medalist
line under General, Regional, and Ebook categories. It honors the site's declared ten-second crawl
delay and retains only title, primary-author text, publisher label, category, medal, response hash,
and frame accounting. It does not persist page HTML, images, descriptions, or third-party praise.

## Truth boundary

A structured exact-work series relation is useful publisher evidence, but it is still a review
proposal. The intake flags self-titled, generic, collection-like, unnumbered, fractional, and
multiple relationships. It records a position only when the publisher's numbered-series roster
assigns one to the exact work. PRH documents that numbered and unnumbered series have different
count and sorting semantics, including cases where several editions of one work share a number;
the tool therefore does not treat `seriesCount` as a canonical work count.

An empty related-series response is only an observation. It does not affirm that a book is
standalone. Qualification requires a human reviewer to supply a direct author or publisher source
that affirmatively establishes standalone status. Descriptions, flap copy, reviews, and praise are
not captured by this lane, preventing copied publisher text and third-party quotations from being
mistaken for first-party classification evidence.

Every approved private case requires a reviewer identifier, review timestamp, substantive review
note, and an explicit attestation that the review was blind to system output. The pool audit also
rejects any authority citation that is the case's own selection-frame URL, even when another truth
source is present.

An IPPY medal establishes neither series truth nor affirmative standalone truth. The 2025 award
year also does not prove the work's publication year, and participation in an independent-publisher
award does not automatically settle the protocol's publication-path label. Both fields therefore
remain explicit reviewer checks before a case can contribute to the relevant coverage floors.
Ambiguous contributor strings are retained with a review flag rather than split by guesswork.

## Coverage implication

The PRH lane can efficiently build traditional, publisher-evidence, current-release, backlist, and
many genre cells. It cannot by itself meet the independent / Kindle-first or author-evidence floors,
and a single publishing group would be an unacceptable population proxy. Separate complete frames
from independent-book awards, independent-publishing platforms, author bibliographies, and other
publisher catalogs remain required before the private 1,500-case pool can be sealed.

The IPPY lane adds several hundred independent and small-press candidates across broad genre and
regional categories, but it is still only an intake. It deliberately does not fabricate truth from
award category, subtitle wording, publisher label, or missing series language. Human-reviewed
author or publisher evidence remains the expensive part of constructing the qualification set.

## Live intake verification

The 2026-09-08 local capture parsed 402 distinct per-page medalist lines. Six entries were excluded
with explicit accounting—five lacked an unambiguous primary-author marker and one overlapped the
development partition—leaving 396 eligible per-frame records and 391 unique private candidates
after cross-frame deduplication. All four frame populations reconciled exactly. Every retained case
remained `truth.status: candidate`, with no series membership, standalone value, or truth citation.
The private file was written with owner-only permissions and was ignored by Git.

Sixty-six contributor strings and seventeen missing publisher labels remain visibly flagged for
human identity review. All 391 cases also require publication-year and publication-path review.
The persisted artifact contains no HTML, image, description, or praise field. These are intake
quality findings, not model results and not progress toward the final series/standalone truth mix.

## Primary documentation

- [PRH developer API home](https://developer.penguinrandomhouse.com/)
- [Enhanced PRH API overview](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api)
- [Work resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Work)
- [Series resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Series)
- [Works and ISBNs](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Works_and_ISBNs)
- [Series number semantics](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Series_numbers)
- [Common paging and filters](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Common_Parameters)
- [Domain semantics](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Domains)
- [IPPY 2025 medalists, categories 1-34](https://ippyawards.com/blog/2025-medalists)
- [IPPY 2025 medalists, categories 35-65](https://ippyawards.com/blog/2025-medalists-categories-35-65)
- [IPPY 2025 medalists, categories 66-92](https://ippyawards.com/blog/2025-medalists-categories-66-92)
- [IPPY 2025 regional and Ebook medalists](https://ippyawards.com/blog/2025-medalists-regional-ebook-categories)
- [IPPY robots policy](https://ippyawards.com/robots.txt)
