/** Only explicit Hardcover BOOK references may locate a fallback. Corpus UUIDs, series IDs,
 * edition references and other providers are never coerced into book IDs. The Edge function
 * independently revalidates the returned book's exact title/full author. */
export function hardcoverSeriesLookupTarget(title: string, author: string, workId?: string) {
  const match = /^hardcover:(?:book:)?([1-9]\d*)$/.exec(workId ?? '')
  const id = match ? Number(match[1]) : NaN
  if (
    !Number.isInteger(id) ||
    id > 2147483647 ||
    !title.trim() ||
    title.length > 500 ||
    !author.trim() ||
    author.length > 300
  )
    return undefined
  return { hardcoverBookId: id, title: title.trim() }
}
