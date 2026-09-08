# Authority qualification source intake

Status: implemented first-party publisher lane; qualification pool remains private and unsealed.

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

## Coverage implication

The PRH lane can efficiently build traditional, publisher-evidence, current-release, backlist, and
many genre cells. It cannot by itself meet the independent / Kindle-first or author-evidence floors,
and a single publishing group would be an unacceptable population proxy. Separate complete frames
from independent-book awards, independent-publishing platforms, author bibliographies, and other
publisher catalogs remain required before the private 1,500-case pool can be sealed.

## Primary documentation

- [PRH developer API home](https://developer.penguinrandomhouse.com/)
- [Enhanced PRH API overview](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api)
- [Work resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Work)
- [Series resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Series)
- [Works and ISBNs](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Works_and_ISBNs)
- [Series number semantics](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Series_numbers)
- [Common paging and filters](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Common_Parameters)
- [Domain semantics](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Domains)
