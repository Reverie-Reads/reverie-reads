/** Accent, punctuation and word-order tolerant search over bibliographic display text.
 * Matching never changes a series identity or merges similarly named records. */
const fold = (value: string) =>
  value
    .normalize('NFKD')
    .replace(/\p{M}/gu, '')
    .toLocaleLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()
export function matchesSeriesSearch(query: string, values: readonly string[]): boolean {
  const text = fold(values.join(' '))
  return fold(query)
    .split(/\s+/)
    .filter(Boolean)
    .every((word) => text.includes(word))
}
