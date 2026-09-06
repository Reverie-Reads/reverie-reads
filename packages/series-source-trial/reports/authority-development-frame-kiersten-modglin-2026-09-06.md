# Kiersten Modglin standalone-label development frame

Date reviewed: 2026-09-06

This development frame includes all 47 titles placed under `Standalones` and `Standalones
(continued)` in Kiersten Modglin's current complete book-list PDF. It excludes the separately
labelled Arrangement and Messes sections. The frame is complete and reproducible, but its heading
is a challenge label rather than truth evidence.

## Truth-blind scout run

- Model: `gpt-5.6-luna`
- Cases and model calls: 47
- Live searches: 85
- Input tokens: 621,377
- Output tokens: 22,834
- Structurally valid outputs: 47/47
- Initially policy-safe outputs: 44/47
- Initial queue: 1 series, 39 standalone, 4 unresolved, 3 quarantined

The scout correctly found the exact author page that calls `The Nanny's Secret` an installment of
the Locke Industries Series. Its 39 standalone proposals depended almost entirely on dated or
mirrored revisions of the same author book-list taxonomy. Grounding those URLs proved that the
model consulted them; it did not make the revisions independent classification evidence.

## Human review

`The Nanny's Secret` is reviewed series-positive. The exact author page explicitly assigns it to
the Locke Industries Series. The page also uses `standalone` to describe independent readability,
which does not erase the bibliographic relationship. No position is asserted.

`Becoming Mrs. Abbott`, `The List`, and `The Missing Piece` remain candidates. Current and dated
author book lists place them under Standalones, while current third-party catalogs preserve a
numbered Carolina Killer Files relationship under their present or former titles. The author FAQ
confirms the relevant retitles but discusses reading order rather than directly affirming or
retiring that bibliographic relationship. No separate eligible first-party relationship source was
verified, so the conflict is not promoted in either direction.

The other 43 titles also remain candidates. Their exact author pages establish identity but do not
directly state standalone status, and selection-frame absence or grouping cannot close that gap.

## Deterministic correction

The validator now profiles the Modglin book-list PDFs, reading-age catalog, `/books` grouping, and
Squarespace book-list mirrors as one known-conflicting catalog taxonomy. Those pages may still
support identity, but cannot establish standalone or series classification. Exact-work author pages
on the same origin remain eligible.

Replaying the cached raw outputs after this correction required no new model calls. Policy-safe
output fell to 5/47 (10.6%): the reviewed Locke Industries claim remained correct, four proposals
remained unresolved, and all 42 catalog-dependent classification proposals were quarantined. The
candidate queue retained zero usable standalone or series proposals.

## Gold-program impact

- Selected development cases: 195/200
- Authority-reviewed development cases: 128
- Reviewed series-positive cases: 102
- Reviewed true standalone cases: 26
- Candidates awaiting authority review: 67

This frame improves false-standalone pressure and validates the cleanup boundary, but it does not
manufacture negative gold labels from an unreliable heading. Seventy-two more reviewed development
cases are still required, including 24 true standalone controls.
