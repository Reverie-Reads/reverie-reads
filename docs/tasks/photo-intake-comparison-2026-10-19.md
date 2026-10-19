# Photo intake development comparison — October 19, 2026

This is a selected five-image development comparison, not production qualification or a random
sample. The implementation agent inspected source pixels and froze eight literal text spans and
nine book rectangles before recognition. There was no separate independent human reference
reviewer. No thresholds, reference strings, boxes or failures were changed after inspection of
the results. The initial frame was refused before extraction because timestamps used Python's
microsecond/offset serialization; only those timestamps were converted to the existing millisecond
UTC schema before the successful freeze.

Frame SHA-256: `48888a8c9f89ba35325be4de981ea56086225fc71ab89eedf0be890188ee68e6`.
Private originals, source receipts, frozen code hashes, lock, extraction packets and case-level
comparison remain outside Git under the owner's private photo-intake workspace. The source
images and raw OCR are not committed as app assets, corpus evidence or reusable catalog content.
The separate committed JPEG fixtures are self-authored colored/text geometry, not these photographs.

## Source selection and use

The owner requested externally sourced photographs, suggesting AbeBooks. Its current
[terms, revised September 26, 2025](https://www.abebooks.com/docs/legal/termsandconditions.shtml)
restrict downloading beyond caching and automated data gathering without written consent.
AbeBooks listing images were therefore excluded from acquisition and scoring. Seller access or
ownership of the underlying book was not treated as image-processing permission.

These exact Commons file pages were inspected for the image's own permission, rather than
assuming that every photograph of a public-domain book is itself freely licensed:

| Case              | Material                                                       | Credit and inspected permission                                                                                                                                                |
| ----------------- | -------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Hawkins title     | Photograph of open title/portrait spread, 775 × 546            | [Dale Mahalko; Commons public-domain declaration for the faithful 1917 page photograph](https://commons.wikimedia.org/wiki/File:1917_Hawkins_Electrical_Guide_-_Titlepage.jpg) |
| Hawkins copyright | Photograph of copyright/preface spread, 793 × 561              | [Dale Mahalko; Commons public-domain declaration for the faithful 1917 page photograph](https://commons.wikimedia.org/wiki/File:1917_Hawkins_Electrical_Guide_-_Copyright.jpg) |
| Hawkins group     | Photograph of nine separately visible books, 1341 × 1045       | [Dale Mahalko / DMahalko, per original upload log; CC BY-SA 3.0](https://commons.wikimedia.org/wiki/File:1917_Hawkins_Electrical_Guide_9_Volume_Set.jpg)                       |
| Blank group       | Edited photograph with identifying text removed, 1200 × 1200   | [Trey Jones; CC0 1.0](https://commons.wikimedia.org/wiki/File:Blank_books_stacked_on_a_table.jpg)                                                                              |
| CVS notice        | Digital edition-notice page, **not a photograph**, 2991 × 3871 | [Karl Fogel / Kfogel; CC BY-SA 4.0](https://commons.wikimedia.org/wiki/File:Open-source-development-with-cvs-v3-edition-notice-page-2991x3871.png)                             |

[CC BY-SA 3.0](https://creativecommons.org/licenses/by-sa/3.0/),
[CC0 1.0](https://creativecommons.org/publicdomain/zero/1.0/) and
[CC BY-SA 4.0](https://creativecommons.org/licenses/by-sa/4.0/) references and author credits remain
with the private acquisition receipts and normalized derivatives. Changes were orientation
normalization, fresh sRGB redraw and metadata removal only; the comparison used whole images.
No source image or derivative is redistributed by this report. Permission was scoped to private
local OCR/review; no model input, image publication, catalog storage or data-provider qualification
was claimed. The CVS page's printed software license was not used to override its image license.

The first two downloads succeeded; three initial download attempts failed and were retained.
One explicit second acquisition attempt obtained the remaining three exact files before the
reference freeze. The eight acquisition attempts and all five selected images remain recorded.
No failed source was silently replaced by a different book or photograph.

## Frozen observations and outcomes

Local Apple ImageIO and Vision ran on macOS, with the existing English `en-US` accurate OCR and
language correction disabled. No provider, paid model, source-search or database call was made
by the comparison. Tool/OS revisions and detector statuses remain in per-image receipts.

| Measurement                                                  | Observed result                        | Meaning and denominator                                                                     |
| ------------------------------------------------------------ | -------------------------------------- | ------------------------------------------------------------------------------------------- |
| Original preservation and normalized dimensions              | 5/5                                    | Exact source hashes and reference dimensions preserved; does not certify facts              |
| OCR with nonempty text                                       | 4/5                                    | Blank negative control retained as failed/empty extraction, not dropped                     |
| Selected literal spans on photographed title/copyright pages | 2/5                                    | Title 0/2; copyright 2/3; complete case-insensitive whitespace-normalized OCR-line equality |
| Selected literal spans on digital notice                     | 3/3                                    | Separate digital-page denominator; not phone-photo accuracy                                 |
| Rough OCR coordinate IoU for matching photographic spans     | 0.754, 0.663                           | Two matched spans only; other three spans have no coordinate score                          |
| Rough OCR coordinate IoU for matching digital spans          | 0.282, 0.651, 0.488                    | Approximate manually image-read reference rectangles; not pixel-perfect annotation truth    |
| Group-photo proposals                                        | 9                                      | A detector output count, not a verified count of detected books                             |
| Group references matched at frozen IoU ≥ 0.5                 | 7/9                                    | One-to-one matching; 2 missed references and 2 unmatched proposals retained                 |
| Blank negative control                                       | 0 text lines, 0 barcodes, 2 rectangles | Identifying text was absent by source design; hidden/occluded book count remains unknown    |
| Recognized barcodes                                          | 0/5                                    | No positive real-photo barcode case; barcode recall remains unobserved                      |
| Automatically accepted identities/editions                   | None implemented                       | Incorrect-identity rate is **unobserved**, not zero or 100% accuracy                        |
| Edition/contributor acceptance                               | Held for deliberate review             | Partial pages and publisher staff/editor labels cannot establish a full creator roster      |
| Human correction actions/time                                | Unobserved                             | A timed independent review session has not occurred                                         |
| Paid calls and cost                                          | 0; $0 additional                       | Shared durable budget remains $20.739314750 burden / $29.260685250 remaining                |

The title photograph includes a portrait signature and a partial author/staff statement; neither
establishes the full requested creator identity. A copyright year does not become first publication.
The digital notice includes publisher staff/editor credits; those are not whole-work authors.
No identity/credit output was promoted to a book, edition, personal inventory or shared catalog.

The group result is insufficient for automatic shelf intake: two of nine distinct visible book
references failed the predeclared region threshold even though nine rectangles were proposed.
The detector's proposed count cannot hide those misses. The selected region boxes are approximate,
axis-aligned references around perspective-distorted covers; keep the scores bounded to that
convention. No shelf-spine, dense occlusion, signed/numbered-copy, translated-edition, modern
multi-ISBN phone photograph or real barcode-positive case was observed here.

## Reuse and next verification

The implementation inspected
[directory-pipeline commit 932d733](https://github.com/hadro/directory-pipeline/tree/932d733111abd168137e4f50d459c9f7508545ab),
including its image heuristics, spread splitting/coordinate sidecars and dependency manifest.
Its [MIT license](https://github.com/hadro/directory-pipeline/blob/932d733111abd168137e4f50d459c9f7508545ab/LICENSE)
does not itself license dependencies or source collections. No upstream source code or dependency
was copied. The adopted patterns are original preservation, explicit crop offsets, localized
re-extraction and correction review. Historical-directory blank/gutter thresholds, Gemini extraction,
Surya/PyTorch, Flask, NumPy, Pillow and geocoding dependencies were not added to Midniht. Existing
ImageIO/Vision and the already packaged ZXing decoder provide the first non-LLM path.

The extraction hashes in the private lock precede a later addition of the static inspection HTML
and evidence-binding receipt; neither change alters ImageIO/Vision extraction or this frozen
comparison. Do not rerun these selected images and present that as an unseen qualification set.
Use fresh, independently referenced phone photographs and preserve this development failure set.
Identity, edition/credit, correction effort and physical-device acceptance remain release gates in
[the implementation contract](photo-collection-intake.md).
