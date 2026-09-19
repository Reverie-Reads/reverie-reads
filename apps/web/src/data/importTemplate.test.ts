import { readFileSync, writeFileSync } from 'fs'
import { describe, expect, it } from 'vitest'
import * as XLSX from 'xlsx'
import {
  parseImport,
  possessionPatch,
  possessionState,
  REVERIE_TEMPLATE_COLUMNS,
} from '@reverie/core'
import {
  buildImportTemplateWorkbook,
  importTemplateBytes,
  TEMPLATE_DATA_SHEET,
  TEMPLATE_EXAMPLE_ROWS,
} from './importTemplate'
import { xlsxToCsv } from './xlsxAdapter'

// The downloadable .xlsx template is GENERATED from the core column profile — it must never drift from
// the detector that reads a filled-in copy. This locks the loop: the committed asset is byte-identical
// to the generator's output (a schema change that isn't regenerated fails the gate), the generator's
// header is exactly REVERIE_TEMPLATE_COLUMNS, and the bytes round-trip through the real XLSX adapter +
// detector to the `reverie` profile — with a leading-zero ISBN-10 surviving as text.
//
// Regenerate the committed asset: `pnpm --filter web gen:template` (sets UPDATE_TEMPLATE, rewrites it).

// Vitest runs with the package root (apps/web) as cwd.
const ASSET = `${process.cwd()}/public/Midniht_Import_Template.xlsx`
// Old bookmarks still download a valid, current template without changing its import schema.
const LEGACY_ASSET = `${process.cwd()}/public/Reverie_Import_Template.xlsx`

const bytesEqual = (a: Uint8Array, b: Uint8Array): boolean =>
  a.length === b.length && a.every((v, i) => v === b[i])

describe('Midniht import template (generated from the core profile)', () => {
  it('committed asset is byte-for-byte the generator output', () => {
    const bytes = importTemplateBytes(XLSX)
    if (process.env.UPDATE_TEMPLATE) {
      writeFileSync(ASSET, bytes)
      writeFileSync(LEGACY_ASSET, bytes)
      return // regeneration run (gen:template) — write, don't assert
    }
    const committed = readFileSync(ASSET)
    expect(
      bytesEqual(committed, bytes),
      'public/Midniht_Import_Template.xlsx is stale — run `pnpm --filter web gen:template`',
    ).toBe(true)
    expect(bytesEqual(readFileSync(LEGACY_ASSET), bytes)).toBe(true)
  })

  it('first sheet header is exactly the canonical column profile', () => {
    const wb = buildImportTemplateWorkbook(XLSX)
    expect(wb.SheetNames[0]).toBe(TEMPLATE_DATA_SHEET)
    const ws = wb.Sheets[TEMPLATE_DATA_SHEET]!
    const header = (XLSX.utils.sheet_to_json(ws, { header: 1, blankrows: false })[0] as string[]) ?? []
    expect(header).toEqual([...REVERIE_TEMPLATE_COLUMNS])
  })

  it('round-trips through the adapter + detector to the reverie profile', async () => {
    const csv = await xlsxToCsv(importTemplateBytes(XLSX))
    const { profile, rows } = parseImport(csv)

    expect(profile.name).toBe('reverie')
    expect(rows).toHaveLength(TEMPLATE_EXAMPLE_ROWS.length)

    // The leading-zero ISBN-10 survives as text (no dropped zero, no scientific notation).
    const hacienda = rows.find((r) => r.incoming.title === 'The Hacienda')
    expect(hacienda?.incoming.isbn).toBe('0593436695')

    // Each column maps: ISBN-13, rating, status, read date, tags.
    const acotar = rows.find((r) => r.incoming.title === 'A Court of Thorns and Roses')
    expect(acotar?.incoming.isbn).toBe('9781619634442')
    expect(acotar?.incoming.rating).toBe(5)
    expect(acotar?.incoming.readStatus).toBe('Read')
    expect(acotar?.incoming.reads?.[0]?.date).toBe('2025-03-04')
    expect(acotar?.incoming.tags?.length ?? 0).toBeGreaterThan(0)

    // "Unread" must not be read as "Read" (it contains the substring); "Reading" is distinct.
    const fourthWing = rows.find((r) => r.incoming.title === 'Fourth Wing')
    expect(fourthWing?.incoming.readStatus).toBe('Unread')
    expect(hacienda?.incoming.readStatus).toBe('Reading')

    // Possession (docs/archive/task-manual-merge.md §3, remodelled by task-shelf-model): the template's
    // Owned column carries borrowed end to end — Yes → owned, blank → owned, Borrowed → borrowed,
    // No → wishlist. One spreadsheet cell is one WORD, so the assertion is on the word AND on the
    // flags it expands to: a cell reading "Borrowed" must produce borrowed=true, not ownership=owned.
    const finePrint = rows.find((r) => r.incoming.title === 'The Fine Print')
    const word = (r: (typeof rows)[number] | undefined) =>
      r && possessionState({ ...possessionPatch('unset'), ...r.incoming })

    expect(word(acotar)).toBe('owned')
    expect(word(hacienda)).toBe('owned') // blank counts as owned
    expect(word(fourthWing)).toBe('wishlist')
    expect(word(finePrint)).toBe('borrowed')

    expect(acotar?.incoming.ownership).toBe('owned')
    expect(fourthWing?.incoming).toMatchObject({ ownership: 'unowned', wishlist: true })
    expect(finePrint?.incoming).toMatchObject({ ownership: 'unowned', borrowed: true })
    expect(finePrint?.incoming.readStatus).toBe('Read')
  })

  it('committed asset on disk parses to the reverie profile', async () => {
    const csv = await xlsxToCsv(readFileSync(ASSET))
    expect(parseImport(csv).profile.name).toBe('reverie')
  })
})
