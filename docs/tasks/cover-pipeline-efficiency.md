# Cover pipeline efficiency

Status: **implemented for review**, 2026-09-09. This changes the `covers` Edge Function only. It
adds no migration and does not alter cover-source policy, reader locks, storage paths, or response
fields.

## Problem

Cover ingestion decoded the same source bytes four times: once for the 1,600px full image, once for
the 720px card image, once for source dimensions, and once for dominant color. The repeated work was
noticeable on ordinary sources and could exhaust the local Edge worker's CPU allowance for a large
upload.

An initial single-decode implementation cloned the full-resolution image for each output. It reduced
decode work but increased the number of live decoded images and was slower on Reverie's actual
800x1,200 camera/upload boundary. That version was rejected.

## Implemented boundary

`normalizeImage` now owns one decoded Magick image for the whole operation:

1. capture the encoded source dimensions;
2. apply EXIF orientation;
3. write the 1,600px full derivative;
4. resize the same image downward and write the 720px card derivative;
5. resize it to 64px and calculate dominant color.

The function keeps one decoded image live and creates no full-resolution clone. Trace output separates
the source decode, preparation, both encodes, and color extraction so a future regression remains
measurable.

The existing quality and privacy rules remain intact: images are never enlarged, aspect ratio is
preserved, full and card quality remain 82 and 78, metadata is stripped before storage, color failure
is non-fatal, source dimensions keep their established meaning, and placeholder/dimension rejection
runs against the same values as before.

## Local measurements

Measurements used the local Supabase Edge runtime and the same function request path before and
after the change. Wall time includes request parsing and Storage writes, so the isolated trace is the
clearer CPU comparison for a linked source.

| Input and path                                 |     Previous implementation | Rejected clone implementation | Final single-image implementation |
| ---------------------------------------------- | --------------------------: | ----------------------------: | --------------------------------: |
| 337x500 Open Library cover, warm normalization |                     307.5ms |                       135.9ms |                           123.8ms |
| 337x500 Open Library cover, warm request       |                       0.94s |                         0.69s |                             0.70s |
| 800x1,200 upload, repeated request             |                  1.49-1.62s |                    1.63-1.80s |                        0.66-0.77s |
| 2,400x3,600 upload                             | worker CPU limit, no result |   worker CPU limit, no result |               1.16-1.83s, success |

The final normalizer reduced the measured warm normalization work by about 60%. The representative
800x1,200 upload completed about 48% faster at the conservative end of the observed ranges. Runtime
memory is not reported as a reliable per-request resident-set value by the local Edge harness; the
allocation boundary is therefore guarded directly: exactly one source decode and no Magick clone.
This retains the old peak decoded-image count while removing three decode/allocation cycles. The
clone experiment was discarded specifically because it increased that peak.

For inputs at or below the full-image boundary, stored bytes remained identical:

- the 337x500 full and card WebPs matched their prior SHA-256 hashes;
- the 800x1,200 full and card WebPs matched their prior SHA-256 hashes;
- both samples returned the same source dimensions and dominant color.

The successful 2,400x3,600 sample produced a 1,067x1,600 full image and a 480x720 card image. Its card
derivative is intentionally made by continuing downward from the bounded 1,600px pixels. This avoids
retaining or re-decoding the original large pixel buffer after the full derivative is prepared.

## Verification and release

The core boundary test reads the Deno implementation because the ordinary Vitest suite does not run
the Edge runtime. It requires one `ImageMagick.read`, no `clone`, the descending output order, metadata
stripping, and the independent trace stages. Existing cover policy and identity tests run beside it.

After merge, the owner must deploy the `covers` function from the clean private production checkout
on `main` through the guarded functions deployment. No database migration is required.
