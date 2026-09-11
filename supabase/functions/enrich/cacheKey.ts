/** Durable-source cutover shared by the Edge handler and owner-run corpus backfill. Historical
 * mixed-source rows remain audit material, never reusable enrichment. No legacy-key fallback. */
export const enrichmentCacheKey = (identityKey: string): string =>
  `durable-sources-v1:${identityKey}`
