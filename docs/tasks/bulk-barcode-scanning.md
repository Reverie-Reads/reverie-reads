# Shared bulk barcode capture

The common capture layer serves Reader Add and the separate Bookseller design study. It reads
barcodes; it never assigns possession, creates inventory, queries a metadata provider, values a
book or writes a library row. The same validated capture list can support different review flows.

## Reader flow

Open **Add a book → Scan books**. Start the camera explicitly, or focus **ISBN or connected scanner
input** for typed ISBNs and keyboard-wedge scanners that send Enter. Scan continuously, then select
**Review** for an ISBN. The existing explicit search/result selection/Add save flow remains in charge
of metadata, duplicates, household consent and copies. A confirmed-save continuation returns to the
remaining captures. Search failures and empty results keep the capture. Manual entry from an ISBN
retains that ISBN without treating it as a title.

Captured barcodes are page-session state, account-separated in Add. Closing the scanner preserves
them in this page; leaving/reloading does not. Export produces a versioned JSON list of capture IDs,
canonical ISBNs, method and timestamp. It is not a library backup, an image export or a cloud sync.
There is no automatic bulk Add-all save. The older paste-list bulk importer is unchanged.

## Identity and camera rules

- Accept checksum-valid ISBN-10 / ISBN-13; normalize equivalence through existing core logic.
  Ignore price supplements, ordinary retail UPC/EAN products, URLs and invalid checksums.
- A held barcode counts once. A one-second empty view rearms the camera observation; any already
  captured ISBN still needs explicit Another copy / Ignore repeat. Another copy receives its own
  capture ID, never an automatic inventory quantity update. Multiple visible ISBNs require one book.
- Bound a batch at 200 captures. Lookup is deliberately outside the camera loop. No-ISBN books
  go to manual identification, without fabricated barcodes.
- Prefer a capability-checked native EAN-13 detector. Fall back to lazy-loaded, locally bundled
  ZXing JS when native support is absent or unusable at initialization. No CDN script or server
  image upload. Native runtime frame errors pause after three failures; typing remains available.
- Use the rear camera when offered. Permission denial/disconnection leaves the batch available.
  Pause, close, unmount, backgrounding and page exit stop tracks and invalidate pending work.
  A late permission response must release its stream; a late frame cannot append to a newer session.
- A secure origin is required for camera access (HTTPS, or trusted localhost during development).
  A phone opening an ordinary LAN HTTP preview will need an HTTPS test origin.

References: [native compatibility](https://developer.mozilla.org/en-US/docs/Web/API/BarcodeDetector)
and [ZXing browser library](https://github.com/zxing-js/browser). ZXing browser 0.1.5 is MIT;
its decoder dependency is Apache-2.0. Dependencies are pinned in the workspace lockfile.

## Bookseller integration

The study reuses BarcodeBatch and its decoder. Reviewing a capture opens the existing field
assessment; a field decision consumes that capture into the local trip, without creating stock.
Potentially valuable remains a separate, optional research flag. Sample scans stay explicitly labeled
for demonstrations. The prototype's existing candidate titles are fixed fixtures, not live lookups.

## Validation and remaining gates

Core guards cover ISBN equivalence, held-frame suppression, ambiguous frames, explicit copy
confirmation, limits and all nine room palettes. Component/hook tests cover input, review dispatch,
copy decisions, late permission/frame cancellation and permission denial. Browser verification must
exercise actual barcode pixels through the fallback as well as simulated native results.

Before a volunteer field pilot: test real iOS/Android focus, light, camera rotation and permissions;
provide durable account/workspace-scoped draft and image storage; prove phone/computer recovery and
owner review/budget permissions. A local synthetic-video decode proves decoding integration, not
real-camera performance. Production release additionally needs the repository's full fresh-database
browser suite. No migration or production deployment is part of this change.
