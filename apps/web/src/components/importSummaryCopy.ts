import { APP_NAME } from '@reverie/core'
import type { ImportExportResult } from '../data/importLibrary'

// Pure copy builders for the post-import summary (docs/archive/task-import-quality.md §4) — kept out of the
// component file so the phrasing is unit-tested and Fast Refresh stays happy.

const plural = (n: number, one: string, many?: string) => (n === 1 ? one : (many ?? `${one}s`))
const listOf = (xs: string[], max = 3): string =>
  xs.length <= max ? xs.join(', ') : `${xs.slice(0, max).join(', ')} +${xs.length - max} more`

/** The headline sentence: what the import did, in one line. */
export function summaryHeadline(r: ImportExportResult): string {
  const parts = [`brought in ${r.added} new`, `folded ${r.merged} into what you had`]
  const joined =
    parts.length > 2
      ? `${parts.slice(0, -1).join(', ')}, and ${parts[parts.length - 1]}`
      : parts.join(', and ')
  const source = r.profile === 'reverie' ? APP_NAME : r.profile
  return `Detected your ${source} export — ${joined}.`
}

/** Plain-language notice lines, in priority order — the honest bulk-empty + placement facts. */
export function summaryNotices(r: ImportExportResult): string[] {
  const lines: string[] = []
  const e = r.extras
  if (e.tbrPlaced > 0)
    lines.push(`${e.tbrPlaced} to-read ${plural(e.tbrPlaced, 'book')} placed on your Imported TBR.`)
  const customShelves = e.shelvesCreated.filter((n) => n !== 'Imported TBR')
  if (customShelves.length > 0)
    lines.push(
      `Created ${customShelves.length} ${plural(customShelves.length, 'shelf', 'shelves')} from your Goodreads shelves: ${listOf(customShelves)}.`,
    )
  if (e.noCover > 0)
    lines.push(
      `${e.noCover} ${plural(e.noCover, 'book')} came in without a cover — we'll fetch what we can, and the rest keep an honest placeholder.`,
    )
  if (e.unplacedNotes > 0)
    lines.push(
      `${e.unplacedNotes} ${plural(e.unplacedNotes, 'review or note')} couldn't attach to a read yet — they'll land when you log a read.`,
    )
  if (r.truncatedIsbns > 0)
    lines.push(
      `${r.truncatedIsbns} ${plural(r.truncatedIsbns, 'ISBN')} may be missing a leading digit and might not match — re-export with ISBNs as text to fix.`,
    )
  // The reader supplied a curated cross-series sequence and we no longer have anywhere to put it.
  // Saying so is the point: a column that vanishes without a word is indistinguishable from a bug.
  if (r.ignoredGlobalOrder > 0)
    lines.push(
      `${r.ignoredGlobalOrder} ${plural(r.ignoredGlobalOrder, 'row')} carried a global reading order. ` +
        `${APP_NAME} doesn't use that column — series order comes from each book's position in its series.`,
    )
  if (e.tropeLikeShelves.length > 0)
    lines.push(
      `${e.tropeLikeShelves.length} of your shelves look like tropes (${listOf(e.tropeLikeShelves)}) — kept as shelves for now.`,
    )
  return lines
}
