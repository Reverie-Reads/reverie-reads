# Photo evidence to a reviewed collection entry

October 19, 2026. Implemented as a private preparation tool and an explicitly enabled development
Add pilot. Production entry, automatic identity extraction, phone acceptance and Collector rollout
remain gated. This branch depends on unmerged document-evidence PR #648 at
`f9c01ff14f5672f0af3e8cdf69e844a3e9e7e451`, including its stacked prerequisites. Its final-head
GitHub checks were verified successful on October 19; it is still draft and open.

## Delivered stages

1. **Capture and prepare:** local JPEG, static PNG and single-image HEIC through macOS ImageIO.
   Preserve the exact original before processing. Read dimensions before decoding, apply all eight
   EXIF orientations, redraw into fresh sRGB pixels and remove metadata. No perspective correction,
   sharpening or artwork-based edition matching is performed. Explicit integer crops use normalized,
   top-left, half-open pixel coordinates without scaling. Original, normalized and crop hashes,
   encoded dimensions, orientation, coordinate transforms and tool revisions remain in private receipts.
2. **Observe:** local Vision EAN-13 detection and rectangle proposals; optional existing local Vision
   English OCR, Tesseract TSV or manual line transcription. Text/crop coordinates belong to the
   declared evidence image. A barcode is an observation; its checksum does not prove the title,
   contributor roster, format or edition. Recognition failure and successful no-barcode observation
   remain distinct. Empty OCR is retained as a failed extraction, never proof of an empty page.
3. **Inspect and correct:** `review.html` displays full normalized pixels, unresolved region proposals,
   the selected evidence crop and raw observations. It is an owner-only, static local artifact with
   no JavaScript, remote assets, forms or Save action. It is deliberately a frozen snapshot. Use the
   existing five-minute loopback document reviewer for append-only transcription corrections, then
   its reviewed-citation handoff to the existing resolver. A new crop/preparation uses a new private
   directory; earlier originals, failures and correction revisions remain intact. Old corrections
   cannot be silently transplanted to changed pixels or OCR.
4. **Review in Add:** with `VITE_PHOTO_INTAKE_PILOT=true`, the development server exposes **Review
   photos · local pilot**. Production builds remove the entry even when that variable is set.
   Cover/title/copyright uploads remain browser memory only and account-separated. Browser PNG/JPEG
   preflight runs before allocation, orientation is applied before displaying pixels, and the
   existing packaged native/ZXing barcode decoder reads the normalized image or an explicit crop.
   This browser slice has **no text OCR service**: checked transcription and identity are entered
   deliberately. The local preparation command provides the separate OCR/resolver path.
5. **Confirm:** an explicit candidate search selects nothing. **Review in Add** transfers only the
   reviewer-entered title, whole-work author names and optional checksum-valid selected ISBN into
   the existing editable draft. It does not cast resolver output into `Incoming` or `Book`, copy
   OCR into edition facts, or grant source qualification. Existing duplicate review, destination
   choice, confirmed-save/retry identity and saved-book navigation still own the first book write.
   Photo evidence stays mounted behind a disclosure during that draft. Saved books retain the
   existing CoverPicker, cover camera/upload crop and personal Cover Studio; selecting a cover is
   independent of accepting identity. Originals never become cover upload bytes implicitly.

No new source provider, image/model endpoint, database table, migration, production writer,
Collector signup or billing path is introduced. No paid/model call occurs in any stage; OCR
failure has no model fallback. The shared Luna budget is unchanged, not a separate allowance.

## Local preparation

```sh
pnpm intake:photo prepare <manifest.json> <new-private-dir>
pnpm intake:document review <new-private-dir>/evidence/manifest.json <new-private-dir>/evidence/packet.json <new-private-review-dir>
pnpm intake:document handoff <reviewed-packet-or-revision.json> <selection.json> <context.json> <new-private-handoff-dir>
```

The last command reuses the existing document resolver handoff and its strict identity, literal
role, citation, permission and edition gates. It is review-only and has no book/catalog writer.
See [document evidence](intake-document-evidence.md) for its selection/context shapes and correction
workflow. A successful OCR run is not a reviewed citation or source-use permission.

Minimal synthetic manifest; substitute inspected provenance and permission for actual photographs:

```json
{
  "version": 1,
  "targetFingerprint": "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
  "source": {
    "url": "https://example.org/self-authored-test-photo",
    "retrievedAt": "2026-10-19T18:00:00.000Z",
    "label": "Self-authored synthetic photo",
    "permissions": {
      "localReview": true,
      "catalogStorage": false,
      "modelInput": false,
      "export": false
    },
    "permissionBasis": "Self-authored fixture; local review only"
  },
  "photos": [
    {
      "id": "title",
      "kind": "title",
      "image": "title.jpg",
      "crop": null,
      "ocr": { "kind": "apple_vision" }
    }
  ]
}
```

`kind` is `cover`, `title`, `copyright` or `group`. `crop` is null (whole photo) or exactly
`{x, y, width, height}` in normalized pixels. Crop selection is explicit; rectangle detection never
selects a crop or a book. OCR settings reuse the document manifest: `apple_vision`, a
`tesseract_tsv` path, or explicit `manual_transcription` lines. Supplied TSV/manual coordinates
must describe the selected crop, not the uncropped source. Images and sidecars are explicit local
inputs; source URLs are reference text and are never fetched by these commands.

Limits: eight photos, 20 MB per original, 12,000 pixels per axis and 16 million pixels per image.
Normalized PNG and selected crops must independently fit the existing 8 MB document limit. No
automatic downscale relaxes that limit. ImageIO/Vision has a sixty-second process timeout and a
1 MB detector-output cap; document OCR retains its existing sixty-second/4 MB limit. Unsupported
types, containers exposing multiple images, corrupt and oversized local inputs fail visibly.
The browser also explicitly refuses animated and orientation-bearing PNG inputs. Originals and partial
failure receipts remain; rerunning into an existing output directory is refused. Private outputs
must be new `0700` directories outside Git; files use `0600`. ImageIO replaces output files while
encoding, so permissions are explicitly restored before reading or retaining them.

The browser keeps at most one photo per kind, not one book per photo. Replacing a capture preserves
unsent identity and requires renewed review. Unmount/account changes release object URLs and
invalidate late image/decoder work; backgrounding invalidates pending work. Reload/navigation loses
the page-session draft, as the visible notice explains. This is not durable phone capture recovery,
offline upload, background sync or a cross-device review receipt. The browser does not accept HEIC
directly; use the local normalizer. Chromium phone-layout evidence is not WebKit or physical-iPhone
acceptance.

## Group photos and Collector observations

The local detector proposes at most twelve rectangular regions. Every queue row starts unresolved;
the complete photo remains visible for missed and overlapping books. Repeated photos never establish
extra copies. Manual crops can inspect an overlooked region in a new acquisition without changing
the first run. There is no group-to-books writer or automatic batch confirmation.

The first real group comparison matched only 7/9 visible books at the frozen IoU threshold despite
producing nine proposals. Two references were missed and two proposals unmatched. This does not
clear a shelf-photo intake release. Keep deliberate segmentation review and full-photo inspection
until a larger, independently referenced shelf corpus measures misses, false regions and correction
effort. Historical directory thresholds are not book matching or segmentation qualification.

Collector-specific observations are not yet persisted or exposed by this public pilot. The next
private integration must bind each observation and source photo to the selected book **and** edition/
copy IDs; no parent-work or generic cover-field shortcut. Visible writing, numbering, damage or a
signature is only an observation. It establishes no authenticity, rarity, provenance of ownership,
market value or possession. Preserve configured inventories, deliberate separate-copy decisions,
personal corrections, chosen covers and reading history. Keep Collector signup unavailable until
its registered minimum Free journey and draft-aware navigation pass their existing gates.

## Reproducible comparison and release gates

```sh
pnpm intake:photo:compare <frozen-frame.json> <new-private-dir>
```

The runner validates a bounded reference frame, copies/hash-checks all selected originals, and
writes a create-only lock containing references, source-use/acquisition records and code hashes
**before** OCR. Expected text and reference regions never enter extraction. Each case has one
photo manifest with `apple_vision`, original SHA-256, declared dimensions, selected reference lines/
rectangles and expected hold/unobserved identity. A private result retains every failed/unobserved
case. Exact normalized line equality and rough-box IoU are separate measurements; one-to-one
rectangle matching uses the frozen 0.5 IoU threshold. Identity correctness and reviewer effort stay
unobserved when no such decision or timed human session occurred.

See the [October 19 development comparison](photo-intake-comparison-2026-10-19.md) for source
permissions, failed controls, denominators and current limitations. Future acceptance requires:

- Independent pixel references across ordinary authored, translated, edited, ISBN-less and
  multi-ISBN editions; wrong-book and wrong-edition controls remain in the denominator.
- Real phone JPEG/HEIC capture, orientation, memory/privacy limits and cancellation on supported
  physical devices, separate from desktop local ImageIO and Chromium emulation.
- Incorrect accepted identities, missed books, source-coordinate errors, edition/credit holds,
  correction actions/time and material cost, with failed and unobserved cases preserved.
- Reviewed permission scope for retained originals, display-cover derivatives, source facts and
  any later optional model input. No automatic OCR-failure fallback or additional budget.
- Existing Add/duplicate/confirmed-handoff behavior and selected-copy observations verified in
  the private Collector journey, with no loss of metadata, copy inventory or reading history.

Owner review is still required before production activation, merging or deployment.

The root `pnpm test` command runs the native photo tool checks **after** the parallel workspace
suites. `pnpm test:photo-tools` runs them explicitly. This stage keeps Swift/ImageIO/Vision process
work separate from request-pacing measurements; it does not relax their assertions, increase
timeouts or add retries. On non-macOS hosts, native cases are explicitly skipped and the manifest
validation case still runs. The browser regression suite separately enables the development flag
and exercises the real packaged decoder and mirror/rotation pixels in desktop and phone-sized
Chromium. Those tests are not physical-device or WebKit acceptance.

## Retained `/skins` navigation failure

The first complete local browser run at `1fade031` finished with 441 passed, 11 skipped and one
Grimoire/light accessibility failure: `/skins` did not reach `load` within the existing 45-second
navigation limit. Its original trace, error context and hashes are retained privately, separately
from later Playwright output. The passing CI run does not erase that local failure.

The trace's final DOM snapshot records all nine gallery materials painted, including offscreen
cards. Their last recorded paints total about 7.1 seconds, plus 2.9 seconds for the shell material;
development-module delivery was also slow. These are contributing main-thread costs, not proof that
one isolated operation accounts for the entire timeout. Deterministic controls reproduced eager
offscreen painting and duplicate painting on unchanged initial ResizeObserver deliveries.

The shared canvas lifecycle now waits for intersection before generating a material, reuses an
unchanged still, and defers hidden-tab work until return. Visible/revealed rooms retain the same
renderer, palette, pixel bound and reduced-motion behavior. A real-browser regression checks that
the final offscreen card is initially unpainted, then reveals all nine and checks actual renderer
and pixel-bound observations on desktop and phone-sized Chromium. The accessibility navigation
limit and default worker/retry settings are unchanged. The follow-up full-run and recovery results
belong in PR #649 alongside the original red result.
