# Private document evidence for intake

October 19, 2026. Implemented operator pilot, with a bounded synthetic comparison below. Production
source qualification, photographed-book accuracy and intake cutover remain pending.

The page/region provenance and correction-preservation patterns were informed by
[directory-pipeline](https://github.com/hadro/directory-pipeline/tree/932d733111abd168137e4f50d459c9f7508545ab).
This implementation uses the existing Midniht resolver and local OCR; no upstream code or dependency
is vendored.

## Scope

Build an operator-only local review path for deliberately supplied, orientation-normalized PNG title
and copyright-page images. This first slice excludes JPEG, PDF and animated/orientation-bearing PNG
inputs; conversion is a separate explicit preparation step. Accept a Tesseract TSV sidecar or a
manual transcription, with optional local Apple Vision OCR on macOS configured for English and
language correction disabled. Other languages and OCR engines remain unmeasured. Preserve the original image,
OCR text and coordinates; show page evidence beside proposed facts, and let a reviewer save explicit
transcription corrections as new private revisions. Bridge reviewed citations to the existing intake
resolver with `review_only` source use. Add, scanning, imports, personal records and reading history
remain unchanged. No database writer or paid/model request belongs in this slice.

Owning a book, possessing its photograph, receiving an OCR result, or selecting a bounding box does
not establish permission to retain or publish all content. Record the supplied document's origin and
the inspected basis for its permitted local processing before retaining it. Distinguish that scope
from shared facts, image display/redistribution, prose, exports and model input. Unresolved permission
remains a hold. Do not reclassify API data or an externally sourced scan as reader-owned evidence
merely because someone saved it locally.

The [reviewed edition-credit save](intake-reviewed-save-2026-10-18.md) remains a separate administrator
workflow with its own exact target, source-use receipt, selection and server checks. This document
packet is not its save payload and cannot waive its controls. See the existing
[evidence resolver](intake-evidence-resolver.md) and
[source-use handoff](intake-source-handoff-2026-10-18.md).

## Data and review boundaries

- Strict versioned packets contain only bounded image metadata, OCR observations, page/region
  citations, reviewed transcriptions, target identity and explicit review dispositions. Reject
  unknown fields and malformed dimensions, coordinates, timestamps and references.
- Image hashes bind citations to the exact bytes inspected. OCR tool/version/configuration and
  sidecar hashes describe extraction provenance, not correctness. A sidecar alone cannot prove it
  was generated from the associated page. A reviewer must inspect the actual image.
- Keep OCR output and human correction separate. A correction retains its original region/text,
  replacement, reviewer action and parent revision. Never rewrite the raw OCR to make a comparison
  look successful. A new correction invalidates dependent reviewed claims until checked again.
- Preserve source order, literal contributor names and role labels. Editors and translators cannot
  become authors through position, font size or a generic contributor list. Unknown roles, initials,
  named-part credits and work-only statements remain explicit; a partial page is not a complete roster.
- Match the selected edition, not every ISBN printed on a copyright page. Multiple format ISBNs,
  translation/original-work notices, later-printing dates and edition statements need explicit scoped
  citations. Never infer first publication from a copyright year, pages from the last visible number,
  language from OCR recognition settings, or print format from the image file type.
- Wrong-book pages, different editions, mismatched image hashes and conflicting reviewed spans stay
  held. Correction is not an override for identity, edition, permission or existing-value protection.
- The resolver bridge emits reviewed claims only with valid page citations and retains its existing
  identity, role, ambiguity and edition gates. Neither successful parsing nor a manual checkbox
  promotes a source or produces a personal/shared book patch.

## Local tooling and privacy acceptance

The implemented CLI help was verified with `pnpm intake:document --help`. Its three commands are:

```sh
pnpm intake:document prepare <manifest.json> <new-private-dir> [prior-packet-or-revision.json]
pnpm intake:document review <manifest.json> <packet-or-revision.json> <new-private-review-dir>
pnpm intake:document handoff <packet-or-revision.json> <selection.json> <context.json> <new-private-dir>
```

Paths in angle brackets are required operator-supplied inputs. Each output must be a new private
directory outside Git checkouts. `prepare` captures private image copies, `manifest.json`,
`packet.json`, extraction outputs and `acquisition.json`. Use that captured manifest for review;
editing/removing an original source file cannot silently change a frozen citation. Review prints a
temporary loopback URL. Correct or confirm individual transcriptions against the pixels, including
their original-pixel rectangles and a reason. Each successful form submission creates a new
`revision-*.json`; the original packet and earlier revisions remain unchanged. Use the latest
revision file directly in `review`, `prepare` or `handoff`.

The manifest schema is enforced by `validateDocumentManifest` in `scripts/document-evidence.mjs`:

```json
{
  "version": 1,
  "targetFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "source": {
    "url": "https://example.org/self-authored-synthetic-page",
    "retrievedAt": "2026-10-19T18:00:00.000Z",
    "label": "Self-authored synthetic title page",
    "permissions": {
      "localReview": true,
      "catalogStorage": false,
      "modelInput": false,
      "export": false
    },
    "permissionBasis": "Self-authored synthetic text and rendered page; local review only"
  },
  "pages": [
    {
      "id": "title",
      "label": "Title page",
      "image": "title.png",
      "ocr": { "kind": "apple_vision" }
    }
  ]
}
```

This is a synthetic template. Supply the current frozen target fingerprint, actual retrieval time,
source and inspected permission basis for real work; the example grants no rights to another source.
The URL is a reference and is never fetched. To use existing OCR, replace `ocr` with
`{"kind":"tesseract_tsv","path":"title.tsv"}`. A manual transcription uses
`{"kind":"manual_transcription","lines":[...]}` with the strict `DocumentEvidenceLine` shape in
`packages/core/src/documentEvidence.ts`. Each page is a separate sidecar; multi-page TSV is refused.

The handoff selection/context schemas are documented in `scripts/document-evidence-handoff.mjs`.
Selection binds the canonical document revision and frozen target, then cites contiguous confirmed
line IDs and their exact text for title, selected edition ISBN and explicit contributor statements.
Only literal title and contributor claims enter this first handoff. It does not extract description,
publisher, publication date, format, language, pages or series membership. Its finite English credit
grammar leaves unsupported statements and name-only/ambiguous roles under review; never rewrite a
transcription to fit that grammar. Context carries the frozen target and existing bibliographic
values. The resulting private `handoff.json` preserves the citations, raw text, corrections,
permissions, resolver diagnostics and existing values. It is not a saved-edition review or a write
payload.

| Stage         | Intended action                                                                     | Required output boundary                                                               |
| ------------- | ----------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| Ingest        | Validate local normalized PNG files and selected TSV/manual/local Vision extraction | Private bounded packet; no remote fetch or model call                                  |
| Review        | Open the page image and region evidence in a temporary local view                   | Loopback-only session; explicit manual corrections                                     |
| Save revision | Freeze the current reviewed transcription/citations                                 | New append-only private version bound to its parent and image hashes                   |
| Resolve       | Validate the chosen revision and pass reviewed claims to the existing resolver      | Review-only result with unresolved holds; no database mutation                         |
| Compare       | Score a separately frozen reference frame                                           | Aggregate diagnostics and explicit denominators; private source material stays private |

Importing a pre-existing OCR sidecar is not an OCR-engine run.
Local Vision must be labeled with its actual engine revision, OS, language and extraction settings.
There is no wired Luna fallback, and an OCR failure must not schedule one implicitly.

The current file/packet bounds are eight pages, 8,000,000 bytes per image, 12,000 pixels per axis,
16,000,000 pixels per page, 4,000,000 bytes per supplied TSV, 60,000 TSV rows, 6,000 total packet lines
and 6,000 corrections. The shared original/correction-text budget is 2,000,000 JavaScript string
code units; this is not a raw-file byte limit. Individual line text is bounded to 2,000 code units,
and correction reasons to 1,000. Local Vision has a sixty-second process timeout and 4,000,000-byte
output cap. The viewer lasts at most five minutes; closing its command or expiry stops serving,
while closing the browser tab alone does not stop the server.

Private directories/files use owner-only access (`0700`/`0600`). PNG validation checks structure,
chunk CRCs, bounded decompression and scanline filters; it restricts inputs to static, non-interlaced
8-bit PNG without EXIF. Reject unsupported or malformed files rather than silently skipping them.
Do not follow unapproved symlinks or use caller-supplied paths as browser routes. Originals can
contain inscriptions, names or other private information: keep them out of repository fixtures,
logs, telemetry, ordinary reports and personal/shared exports unless separately authorized.

The local viewer must serve only allowlisted packet images, bind to loopback, prevent caching, expire
its session, escape displayed text, and load no remote assets. Unlike the earlier read-only shadow
viewer, corrections require a mutation boundary: validate Host/Origin and a per-session unguessable
write token; do not enable wildcard CORS. Reject traversal, overlarge requests, stale revisions,
foreign-page citations and unauthorized file targets. Concurrent saves must not overwrite a revision.
A saved correction revision must be readable by the review and handoff commands without manual JSON
editing. Use one canonical packet fingerprint across the viewer, revision envelope and bridge, and
validate that envelope on reopening. A failed or interrupted save must preserve originals and expose the failure without inventing a
successful receipt. Keep page pixels and citation coordinates in one declared orientation/scale so
resizing or embedded orientation cannot silently move the reviewed region.

## Smallest meaningful frozen comparison

Use three independently reviewed, permission-cleared title/copyright-page pairs, with six cases:

| Page pair                 | Positive or expected hold                                                | Paired negative control                               |
| ------------------------- | ------------------------------------------------------------------------ | ----------------------------------------------------- |
| Ordinary authored edition | Exact title, creator and selected ISBN supported                         | Same title with a different creator remains held      |
| Translated edition        | Original author and explicitly credited translator retain distinct roles | Translator supplied as author remains held            |
| Editor-only collection    | Credits retained, creator identity unresolved for a roleless target      | Wrong or ambiguously mapped edition ISBN remains held |

The editor-only case is an expected hold, not a failed positive that can be repaired by relabeling an
editor. A cited copyright page may list several ISBNs; include only an edition mapping independently
established before scoring. Unknown page counts, formats or publication dates stay outside the
positive reference claims. Reference credits describe only the inspected subset, never a complete
roster. No need to force field coverage the pages do not support.

Before any bridge result is inspected, freeze image hashes, sidecar hashes, target revisions, expected
identity dispositions, independently image-read reference strings/regions, contributor roles/scopes,
included and excluded facts, scoring rules, correction protocol and implementation hash. The
reference reviewer should read the pixels without seeing extracted candidates or resolver output.
Resolve file orientation before freezing. Retain rejected candidates and the reasons for exclusion;
do not replace failures after freezing or tune the implementation to obtain a passing result.

Keep known mixed-book, wrong-edition, editor-as-author and contributor-credit regressions in a
separate development suite. Previously exposed books and consumed provider comparisons cannot count
as unseen document qualification; an existing known failure may still be a clearly labeled regression.

If only newly authored synthetic pages with explicitly cleared local rights are available, this can
prove a synthetic local workflow and fail-closed controls. It cannot establish accuracy on photographed
published books. An external-page comparison remains unmeasured until suitable permission-cleared
pages and independent references are available. Do not assume a modern title/copyright page is free
to reuse because the underlying literary work is public domain.

## Measurements and regression checks

Report these separately, retaining every frozen case in its relevant denominator:

1. Raw OCR versus the independent image transcription: exact-field agreement, missing spans,
   incorrect spans and invalid coordinates. If no OCR engine ran, identify the supplied sidecar
   and do not label these observations engine accuracy.
2. Manual review: fields corrected, fields left unresolved, rejected citations and retained
   version lineage. Corrected text is human-reviewed output, not raw OCR performance.
3. Resolver outcomes: supported positive identities, false identities/editions, held negative
   controls, unobserved cases, role/scope agreement and unsupported claims withheld. Permission
   or identity holds must not disappear because a transcription agrees with the reference.
4. Preservation: unchanged original hashes, immutable earlier revisions, no database/personal-data
   writes, no external image requests and zero automatic promotions.

Pure regressions should exercise malformed packets/TSV, missing pages, invalid/conflicting ISBNs,
zero/negative/out-of-bounds boxes, mismatched hashes, ambiguous names, duplicate or conflicting
credits, explicit author/editor/translator distinctions, named parts, absent role labels, work versus
edition scope, stale corrections and preservation of unsupported evidence. Include content that
looks like instructions; document text must remain inert data.

CLI/viewer checks should cover exact image/sidecar binding, private output permissions, traversal and
symlink refusal, oversized/invalid images, expired or forged write sessions, parent-revision races,
append failure and safe restart without overwriting earlier versions. Tests must exercise the actual
route and file-writing helpers, not only restated expectations. Focused document tests do not access
a database; the branch still requires the repository's full fresh-database browser gate.

## October 19 synthetic comparison

A separate Codex reviewer inspected six normalized synthetic page images before OCR, freezing all
13 literal lines, rough containing rectangles, four visible role statements and six controls.
The runner copied/hash-checked images and references and froze code, target/existing-value contexts,
scoring and runtime before acquisition. Run it only against separately prepared references and a new
private output directory:

```sh
pnpm exec vite-node --script scripts/document-evidence-pilot.mjs -- <independent-reference.json> <image-dir> <new-private-dir>
```

Actual local Apple Vision revision 3, macOS 26.5, `en-US`, language correction off; one extraction per
page, no retries:

| Measurement                                                                    | Result                                   |
| ------------------------------------------------------------------------------ | ---------------------------------------- |
| Complete observed pages                                                        | 6 / 6                                    |
| Raw OCR lines exactly equal independently read text                            | 13 / 13                                  |
| Exact lines contained within predeclared rough reference regions               | 13 / 13                                  |
| Consistent title/creator/ISBN controls                                         | 2 / 2                                    |
| Wrong creator, translator-as-creator, editor-only and wrong-ISBN controls held | 4 / 4                                    |
| Translator credit relabeled as author                                          | Refused separately by literal-role check |
| Handoffs retaining existing values and review-only use                         | 6 / 6                                    |
| Paid calls, database writes, source promotions                                 | 0                                        |

Resolver replay used explicitly labeled **automated synthetic-reference confirmations**, with no
text repairs. These are not real operator approvals or improvements to raw OCR accuracy. All six
overall resolver decisions remain review-only, including the two consistent identities. The
wrong-ISBN case is also editor-only; its ISBN diagnostic was checked separately and does not isolate
the reason for its overall hold. Rough containing regions are not glyph-level location ground truth.

Frame hash: `0e93fec0939c7d7682cf3b3c2178ea7677819a16fa34b2435cdd33954bec58cd`.
Reference hash: `e004df7bec80b2336e3710dfc7a65f5f1917295586fdea49924da6f5ee477151`.
Code snapshot: `7de342fccbffe3d508b39fc72753962d5fed52743b6627eacc369cde4410cc9f`.
Private originals/receipts remain under the operator's `intake-document-2026-10-19/comparison-02`
directory, outside Git. The public repository retains only synthetic generator text and aggregate
results.

The first fixture attempt was rejected before OCR because AppKit added EXIF metadata. Its original
reference/failure remain intact. The normalized replacement was inspected and frozen again; it is
the same known synthetic identities, not a new unseen sample. Desktop/375px Chromium inspection
also found and corrected a native form Origin failure caused by `no-referrer`; `same-origin` keeps
the form provenance check and suppresses cross-origin referrers. The corrected form created a new
private revision, retained its original transcription and passed the canonical envelope checks.

Focused regression coverage: 35 packet/TSV, 28 citation/role/identity, nine file/viewer round-trip and
14 frozen-pilot tests. Whole-repository checks and browser lifecycle results belong in the PR's
verification record. A successful synthetic comparison does not qualify production sources,
photographed-book accuracy, a complete corpus, personal imports or an intake cutover. The next
qualification step is a permission-cleared external-page reference set including wrapped names,
multiple edition ISBNs, multilingual credits and uncertain pages. Unsupported facts remain held.

## Final visual and CI hardening

A final dark-mode inspection found white region borders disappearing against white page pixels.
The viewer now uses both system `CanvasText` and `Canvas` strokes; actual dark Chromium inspection
confirmed visible containing rectangles without changing source pixels. A second frozen regression
after this CSS change reused the same known synthetic reference and images. It again returned
13/13 exact/located lines, 2/2 consistent identities, 4/4 held controls and no promotions or paid
calls. This is repeat regression evidence, not another unseen reference set or human approval.

Regression frame: `c9ad5c0eb0b7672a9565af8e32c18cc440e33d465fa9d125eb28078549b1342f`.
Code snapshot: `e32b7fb9225ea7a20e496d6f1c57767e81e8a472613574ff5812a00d04da7259`.
The original run/failed preflight remain retained alongside `comparison-03`.

The full local app browser run at `c2c9411` passed 438 tests with 11 skips, one worker and zero
retries in 39.9 minutes. Snapshot recovery exited successfully: all 102 protected public/auth table
row/column digests and eight publication statements match the pre-test archive, with Auth/REST
healthy and the missing-table negative control still returning 404. Subsequent changes affect only
the operator's region stroke, this documentation and CI's overall mobile-job ceiling.

On the initial PR revision, GitHub mobile completed 52 tests (five skipped) in 8.7 minutes but its
12-minute whole-job ceiling cancelled setup/reporting/cleanup after image-pull throttling. The
original cancelled log and annotation are retained; that run is not green. The mobile whole-job
ceiling is now bounded at 15 minutes, following the existing measured desktop-job policy. Test
assertion timeouts, worker count and retry settings are unchanged. The final PR revision's full CI
matrix supplies current-revision verification; its outcome must be reported separately.
