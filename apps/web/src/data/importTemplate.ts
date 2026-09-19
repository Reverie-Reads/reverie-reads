import type * as XLSXNS from 'xlsx'
import { APP_NAME, REVERIE_TEMPLATE_COLUMNS } from '@reverie/core'

/**
 * The canonical Reverie import template (.xlsx) — built deterministically from the core column profile
 * so the downloadable file, the detector, and the importer can never drift. `buildImportTemplateWorkbook`
 * is the single source of truth: the committed asset in `public/` is its byte output, the round-trip
 * test feeds it through the real adapter, and a parity test asserts the committed bytes still match.
 *
 * Pure (takes the XLSX namespace), so it runs under the test/generator toolchain without bundling
 * SheetJS into the app — the template ships as a static download, never read at runtime.
 *
 * Regenerate after any change here: `pnpm --filter web gen:template`.
 */

type XLSXModule = typeof XLSXNS

/** The data tab the importer reads — MUST be the first sheet (the adapter takes the first table). */
export const TEMPLATE_DATA_SHEET = 'My Library'
/** A single-column guide tab; never a table, so the adapter ignores it. */
export const TEMPLATE_GUIDE_SHEET = 'How to use'

/**
 * Sample rows shown in the template — clearly example data the reader replaces. Row 2's ISBN is a
 * leading-zero ISBN-10, the case the round-trip test guards: the ISBN column must survive as text.
 * One per status so the examples double as a legend (Read / Reading / Unread).
 */
export const TEMPLATE_EXAMPLE_ROWS: readonly (readonly string[])[] = [
  // Owned column doubles as its own legend: Yes, blank (= Yes), Borrowed (a copy in hand on loan),
  // and No (wishlist). One per status too, so the examples double as a Status legend.
  ['A Court of Thorns and Roses', 'Sarah J. Maas', '9781619634442', 'Read', '5', '2025-03-04', 'fae, enemies-to-lovers', 'Yes'],
  ['The Hacienda', 'Isabel Cañas', '0593436695', 'Reading', '4', '', 'gothic, slow-burn', ''],
  ['The Fine Print', 'Lauren Asher', '9781734070583', 'Read', '4', '2025-01-12', 'billionaire, forced-proximity', 'Borrowed'],
  ['Fourth Wing', 'Rebecca Yarros', '9781649374042', 'Unread', '', '', 'dragons, romantasy', 'No'],
]

const GUIDE_LINES: readonly string[] = [
  `${APP_NAME} — import template`,
  '',
  `Fill in the “My Library” tab, one book per row, then import it in ${APP_NAME} (Settings → Import,`,
  'or during first-run setup). Save as .xlsx or .csv — both import the same way.',
  '',
  'Columns:',
  '• Title — required. The book’s title.',
  '• Author — “First Last” (or “Last, First”). Multiple authors: separate with “&”.',
  '• ISBN — ISBN-10 or ISBN-13. Kept as text so a leading zero is never lost.',
  '• Status — Read, Reading, Unread, or DNF.',
  '• Rating — your own rating, 0–5. Leave blank if unrated.',
  '• Date Read — when you finished it (YYYY-MM-DD). Optional.',
  '• Tags — comma-separated tropes / spice / vibes. Optional.',
  '• Owned — Yes, Borrowed, or No. Blank counts as Yes; Borrowed = a copy you have on loan (a book',
  '  in hand, just not yours to keep); No marks a wishlist book (want it, don’t own it yet).',
  '',
  'The rows in “My Library” are examples — delete them and add your own.',
  `Re-importing is safe: ${APP_NAME} matches and merges, it never makes duplicates.`,
]

/** Build the workbook from the core column profile. Shared by the generator and the parity test. */
export function buildImportTemplateWorkbook(XLSX: XLSXModule): XLSXNS.WorkBook {
  const header = [...REVERIE_TEMPLATE_COLUMNS]
  const data = XLSX.utils.aoa_to_sheet([header, ...TEMPLATE_EXAMPLE_ROWS.map((r) => [...r])])

  // ISBN column → text format. The cells are authored as strings (so they already round-trip as text);
  // this just labels the column so Excel shows it as text and never offers to "convert to number".
  const isbnCol = header.indexOf('ISBN')
  for (let r = 1; r <= TEMPLATE_EXAMPLE_ROWS.length; r++) {
    const cell = data[XLSX.utils.encode_cell({ r, c: isbnCol })] as XLSXNS.CellObject | undefined
    if (cell) {
      cell.t = 's'
      cell.z = '@'
    }
  }
  data['!cols'] = header.map((h) => ({
    wch: h === 'Title' || h === 'Author' || h === 'Tags' ? 28 : h === 'ISBN' ? 16 : 10,
  }))

  const guide = XLSX.utils.aoa_to_sheet(GUIDE_LINES.map((l) => [l]))
  guide['!cols'] = [{ wch: 78 }]

  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, data, TEMPLATE_DATA_SHEET) // first → the table the importer reads
  XLSX.utils.book_append_sheet(wb, guide, TEMPLATE_GUIDE_SHEET)
  return wb
}

/** The template's canonical bytes (`XLSX.write` is byte-deterministic — the parity test relies on it). */
export function importTemplateBytes(XLSX: XLSXModule): Uint8Array {
  return XLSX.write(buildImportTemplateWorkbook(XLSX), { bookType: 'xlsx', type: 'buffer' }) as Uint8Array
}
