import { expect, it } from 'vitest'
import {
  catalogEvidenceDraftKey,
  parseCatalogEvidenceDraft,
  reviewCatalogEvidenceDraft,
} from './catalogEvidence'

const at = '2026-10-20T12:00:00.000Z'
const draft = () => ({
  version: 1,
  field: 'description',
  editionId: null,
  value: 'A supported short summary.',
  identity: { title: 'Still Waters', author: 'Jane Smith', isbn: null },
  source: {
    url: 'https://publisher.example/book',
    recordId: 'book',
    locator: 'Synopsis',
    checkedAt: at,
    kind: 'publisher',
  },
  support: {
    explanation: 'I checked each statement against the synopsis.',
    scope: 'work',
    independentlyChecked: true,
  },
  sourceUse: {
    version: 1,
    basis: 'public_terms',
    url: 'https://publisher.example/terms',
    note: 'These inspected terms cover this attributed summary.',
    checkedAt: at,
    scope: 'catalog_description',
    confirmed: true,
  },
  note: 'Description reviewed; unrelated concerns remain open.',
})
it('freezes one inspected fact and its field-specific source-use receipt without granting other uses', () => {
  const input = draft(),
    parsed = parseCatalogEvidenceDraft(input)
  expect(reviewCatalogEvidenceDraft(input, at).ready).toBe(true)
  input.value = 'Changed later'
  expect(parsed.value).toBe('A supported short summary.')
  expect(parsed).not.toHaveProperty('modelInput')
  expect(parsed).not.toHaveProperty('saveAllowed')
})
it.each([
  { field: 'title' },
  { field: 'contributors' },
  { field: 'series' },
  { version: 2 },
  { personalNotes: 'private' },
  { value: '' },
  { value: ' '.repeat(30) },
  { value: 'x'.repeat(10001) },
  { editionId: '00000000-0000-4000-8000-000000000001' },
  { identity: { title: 'Still Waters', author: 'Jane Smith', isbn: '9780306406157' } },
  { support: { ...draft().support, independentlyChecked: false } },
  { support: { ...draft().support, scope: 'edition' } },
  { source: { ...draft().source, kind: 'model' } },
  { source: { ...draft().source, kind: null } },
  { source: { ...draft().source, url: 'https://person:secret@publisher.example/book' } },
  { source: { ...draft().source, url: 'https://publisher.example/book?token=secret' } },
  { source: { ...draft().source, checkedAt: '2026-02-31T12:00:00Z' } },
  { sourceUse: { ...draft().sourceUse, scope: 'catalog_edition_facts' } },
  { sourceUse: { ...draft().sourceUse, confirmed: false } },
  { sourceUse: { ...draft().sourceUse, modelInput: true } },
])('rejects unsupported, private, malformed or differently scoped assertions: %j', (patch) => {
  expect(() => parseCatalogEvidenceDraft({ ...draft(), ...patch })).toThrow()
})
it('requires current source inspection and a current permission attestation', () => {
  expect(reviewCatalogEvidenceDraft(draft(), '2026-11-20T12:00:00Z').ready).toBe(false)
  expect(reviewCatalogEvidenceDraft(draft(), '2026-10-19T12:00:00Z').ready).toBe(false)
})
it('validates complete edition dates and preserves reduced precision', () => {
  const input = {
    ...draft(),
    field: 'publication',
    editionId: '00000000-0000-4000-8000-000000000001',
    value: { y: 2024, m: null, d: null },
    identity: { ...draft().identity, isbn: '9780306406157' },
    support: { ...draft().support, scope: 'edition' },
    sourceUse: { ...draft().sourceUse, scope: 'catalog_edition_facts' },
  }
  expect(parseCatalogEvidenceDraft(input).value).toEqual({ y: 2024, m: null, d: null })
  expect(() => parseCatalogEvidenceDraft({ ...input, value: { y: 2023, m: 2, d: 29 } })).toThrow()
  expect(() => parseCatalogEvidenceDraft({ ...input, value: { y: 2024, m: null, d: 2 } })).toThrow()
  expect(() =>
    parseCatalogEvidenceDraft({ ...input, identity: { ...input.identity, isbn: '9780306406158' } }),
  ).toThrow()
})
it('compares exact JSONB receipts independent of object key order', () => {
  expect(catalogEvidenceDraftKey({ b: { y: 2, x: 1 }, a: [1, 2] })).toBe(
    catalogEvidenceDraftKey({ a: [1, 2], b: { x: 1, y: 2 } }),
  )
  expect(catalogEvidenceDraftKey({ a: [2, 1] })).not.toBe(catalogEvidenceDraftKey({ a: [1, 2] }))
})
