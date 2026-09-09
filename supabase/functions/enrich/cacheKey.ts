/** Retired-provider cutover shared by the Edge handler and the owner-run corpus backfill.
 * Old cache rows remain audit material, not reusable enrichment. No legacy-key fallback. */
export const enrichmentCacheKey = (identityKey: string): string => `no-isbndb-v1:${identityKey}`
