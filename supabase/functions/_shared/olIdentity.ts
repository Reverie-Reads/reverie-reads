// The app's identity for Open Library traffic — ONE home, because the identified tier is a property
// of the whole egress IP, not of a call site. OL's documented limits (verified live, 2026-08-03,
// openlibrary.org/developers/api): 1 req/s anonymous; 3 req/s when the User-Agent carries "(a) the
// name of your application and (b) your contact email" (their example: `MyLibraryApp
// (contact@example.org)`). One call site dropping the header re-classifies the IP's traffic, so
// every OL fetch imports THIS constant and `packages/core/src/olIdentity.test.ts` scans these
// function sources and fails on any openlibrary.org call site it does not recognise as carrying it.
//
// The contact is DELIBERATELY hardcoded, not an env fallback like geo's GEO_CONTACT: an env var
// that is unset in some deploy silently drops the email and with it the tier — while sourcePace
// keeps spending the 3/s budget the header no longer buys. The pacing table and this header must
// tell the same story, and a constant cannot drift per-environment. Owner-chosen address
// (2026-08-03): contact@reveriereads.app.
export const OL_UA = 'Midniht (midniht.app; contact@reveriereads.app)'

/** Headers for an Open Library request — the identity header plus whatever the call site needs. */
export const olHeaders = (extra?: Record<string, string>): Record<string, string> => ({
  'User-Agent': OL_UA,
  ...(extra ?? {}),
})
