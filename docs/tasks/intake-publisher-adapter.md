# Publisher edition shadow adapter

October 18, 2026. This is an opt-in operator comparison, not a change to Add, scanning,
imports or catalog writers. It extends the existing Penguin Random House transport to
address the measured gap in selected-edition facts and contributor roles.

## Admission and scope

A frozen shadow frame may select `penguin_random_house` beside Open Library and Hardcover.
The provider list is hashed with the frame and must match the acquisition client before
network activity. Omitting the list preserves the existing two-source comparison. A missing
credential, failure, cap or malformed packet remains an explicit unobserved source in the
report; it is never removed from the denominator or counted as a correct rejection.

The adapter fetches only the exact ISBN title and its title-scoped contributors in `PRH.US`.
It reuses fixed-host URL construction, omits the credential from evidence and diagnostics,
refuses redirects, caps requests/response bytes, stops on access/rate failures, and reuses
one in-memory response for paired ISBN controls. Source rights and lineage remain unverified;
all observations are `review_only` even when the publisher agrees with a reference.

Title, full creator and ISBN admission remain the existing resolver's responsibility. The
adapter also validates the returned ISBN before fetching credits. Work-scoped credits cannot
become edition credits. Display strings and endpoint names cannot supply authorship.

The contextual contributor code and literal label are preserved separately in source order.
Known conflicting labels become unknown roles. Introduction and foreword are named parts;
editors, translators, narrators and unknown credits cannot establish whole-work authorship.
The documented five-person mapping is not proof of a complete roster. Duplicate normalized
credit tuples retain their literal labels only as withheld evidence, with no identity support.

Only selected-edition pages, format, language, publisher and territory-specific publication
observations enter this slice. Audio does not acquire print pages. Conflicting known formats,
territories, incomplete rosters and invalid dates remain visible. No descriptions, cover data,
series classification or reader data are acquired by the publisher adapter.

`sourceRoleCode` is an optional field in transient intake evidence. The existing persisted
edition-credit SQL shape is unchanged; this adapter cannot silently send new evidence fields
through that administrator handoff. Separate manual review remains required, and any future
code-bearing storage handoff needs an explicit lossless schema contract.

## Verification boundary

Synthetic regressions cover exact ISBN and creator mismatch, editor/translator confusion,
unknown and conflicting role codes (including prototype property names), named parts,
duplicates, capped/partial and work-scoped rosters, territory/format/date problems, bounded
transport and unchanged personal-data boundaries. Reference answers never enter acquisition.
A new frozen comparison is required before considering any intake switch; passing these tests
alone does not qualify the publisher or establish independent source agreement.

Official contract references inspected for this implementation:

- [Title resource](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/resources/Title)
- [Contributor roles](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Contributor_role)
- [Works and ISBNs](https://developer.penguinrandomhouse.com/docs/read/enhanced_prh_api/concepts/Works_and_ISBNs)

See the dated comparison report for observed coverage, failures and remaining holds, and
[intake-budget.md](intake-budget.md) for the separate residual Luna spending boundary.
