# App startup recovery

A returning phone browser and installed Midniht app showed a black screen, including `/guide`, while private browsing worked. Fresh production landing and sign-in screens rendered and current assets returned the correct MIME types. A missing `/assets/*.js` request, however, returned HTTP 200 `text/html` with an immutable cache header. The previous worker accepted any successful asset response and retained it cache-first. This establishes a reproducible cache-poisoning defect; the affected phone's cache has not been inspected, so its precise failure remains inferred.

## Repair

- The worker validates JavaScript, CSS and SVG response types before caching or using cached entries. Invalid entries are removed and revalidated against the network. Valid assets remain available offline.
- Version 4 retires only Midniht/Reverie shell caches. Unrelated caches, IndexedDB, local storage, session storage and authentication remain untouched.
- A failed navigation response cannot replace a good offline shell.
- Recovery lives in the HTML document, independently of the application module and stylesheet. It appears for an entry-script load failure or a 15-second empty-root startup. A mounted app dismisses it. Only the reader's explicit “Reload app files” action refreshes shell caches and unregisters this origin's `/sw.js` worker before reloading. It never signs out or clears reader data.

The emergency screen uses system colors and type so it remains readable without application CSS. The existing React error boundary continues handling errors after mount.

## Validation and rollout

Unit tests cover poisoned/valid assets, offline use, failed navigation, cache ownership, stalled and failed entry scripts, mounted-screen preservation, reader-triggered recovery, and storage errors. Browser checks reproduce an HTML entry-module response at 320, 390 and 1280 px, then exercise recovery, preserved storage and unrelated caches, and the actual landing page.

The first focused browser run passed both phone sizes; the desktop assertion ran before the reload finished (its failure snapshot already showed the landing page). The corrected test waits for the reload's load event; all three replacement cases passed. Initial failure evidence is retained outside the checkout.

Complete source gates and the required fresh-database browser suite are recorded in the PR. Public merge must be synchronized into the private deployment repository before release. No migration or Edge Function deployment is needed. After the private release, verify reopening the affected phone's ordinary browser and installed app; local browser evidence is not physical-device acceptance.

The requested household card-spacing/cover-outline audit is paused, not cancelled. It remains separate from this startup repair.
