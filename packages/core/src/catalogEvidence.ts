import { normalizeIsbn } from './match'
import {
  parseEditionCreditSourceUseReview,
  reviewEditionCreditSourceUse,
} from './editionCreditSourceUse'
import type { EditionCreditSourceUseReview } from './editionCreditSourceUse'

/** Deliberately hand-reviewed bibliography, not a provider packet or an IntakeResolution.
 * The receipt is a human attestation for this exact field/use, not source qualification. */
export interface CatalogEvidenceDraft {
  version: 1
  field: 'description' | 'pages' | 'publication'
  editionId: string | null
  value: string | { pages: number } | { y: number; m: number | null; d: number | null }
  identity: { title: string; author: string; isbn: string | null }
  source: {
    url: string
    recordId: string
    locator: string
    checkedAt: string
    kind: 'publisher' | 'author' | 'published_book'
  }
  support: { explanation: string; scope: 'work' | 'edition'; independentlyChecked: true }
  sourceUse: Omit<EditionCreditSourceUseReview, 'scope'> & {
    scope: 'catalog_description' | 'catalog_edition_facts'
  }
  note: string
}

const object = (v: unknown): v is Record<string, unknown> =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const exact = (v: unknown, keys: string[]): v is Record<string, unknown> =>
  object(v) && Object.keys(v).length === keys.length && keys.every((k) => Object.hasOwn(v, k))
const text = (v: unknown, max: number): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max
const time = (v: unknown) =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)
export function catalogEvidenceUrl(v: unknown): v is string {
  if (!text(v, 2000) || /\s|\\/u.test(v) || v.split('#', 1)[0]!.includes('?')) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password && !u.search
  } catch {
    return false
  }
}
export function parseCatalogEvidenceDraft(input: unknown): CatalogEvidenceDraft {
  const fail = (): never => {
    throw new Error(
      'Check the selected fact, exact identity, inspected source and source-use basis.',
    )
  }
  if (
    !exact(input, [
      'version',
      'field',
      'editionId',
      'value',
      'identity',
      'source',
      'support',
      'sourceUse',
      'note',
    ]) ||
    input.version !== 1 ||
    typeof input.field !== 'string' ||
    !['description', 'pages', 'publication'].includes(input.field) ||
    !text(input.note, 1200)
  )
    return fail()
  if (
    input.field === 'description'
      ? input.editionId !== null
      : typeof input.editionId !== 'string' ||
        !/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/i.test(input.editionId)
  )
    return fail()
  const { identity, source, support, sourceUse, value } = input
  if (
    !exact(identity, ['title', 'author', 'isbn']) ||
    !text(identity.title, 1000) ||
    !text(identity.author, 2000) ||
    (input.field === 'description'
      ? identity.isbn !== null
      : typeof identity.isbn !== 'string' || !normalizeIsbn(identity.isbn))
  )
    return fail()
  if (
    !exact(source, ['url', 'recordId', 'locator', 'checkedAt', 'kind']) ||
    !catalogEvidenceUrl(source.url) ||
    !text(source.recordId, 200) ||
    !text(source.locator, 1000) ||
    !time(source.checkedAt) ||
    typeof source.kind !== 'string' ||
    !['publisher', 'author', 'published_book'].includes(source.kind)
  )
    return fail()
  if (
    !exact(support, ['explanation', 'scope', 'independentlyChecked']) ||
    !text(support.explanation, 1200) ||
    support.independentlyChecked !== true ||
    support.scope !== (input.field === 'description' ? 'work' : 'edition')
  )
    return fail()
  if (
    !object(sourceUse) ||
    sourceUse.scope !==
      (input.field === 'description' ? 'catalog_description' : 'catalog_edition_facts')
  )
    return fail()
  parseEditionCreditSourceUseReview({ ...sourceUse, scope: 'edition_identity_and_credit_facts' })
  if (input.field === 'description') {
    if (!text(value, 10000)) return fail()
  } else if (input.field === 'pages') {
    if (
      !exact(value, ['pages']) ||
      !Number.isInteger(value.pages) ||
      (value.pages as number) < 1 ||
      (value.pages as number) > 20000
    )
      return fail()
  } else {
    if (
      !exact(value, ['y', 'm', 'd']) ||
      !Number.isInteger(value.y) ||
      (value.y as number) < 1 ||
      (value.y as number) > 9999 ||
      (value.m === null
        ? value.d !== null
        : !Number.isInteger(value.m) || (value.m as number) < 1 || (value.m as number) > 12) ||
      (value.d !== null && (!Number.isInteger(value.d) || (value.d as number) < 1))
    )
      return fail()
    if (value.d !== null) {
      const d = new Date(0)
      d.setUTCFullYear(value.y as number, (value.m as number) - 1, value.d as number)
      if (
        d.getUTCFullYear() !== value.y ||
        d.getUTCMonth() !== (value.m as number) - 1 ||
        d.getUTCDate() !== value.d
      )
        return fail()
    }
  }
  return structuredClone(input) as unknown as CatalogEvidenceDraft
}

export function reviewCatalogEvidenceDraft(input: unknown, now: string) {
  const draft = parseCatalogEvidenceDraft(input)
  const receipt = reviewEditionCreditSourceUse(
    { ...draft.sourceUse, scope: 'edition_identity_and_credit_facts' },
    now,
  )
  const age = Date.parse(now) - Date.parse(draft.source.checkedAt)
  return { draft, ready: receipt.ready && time(now) && age >= 0 && age <= 30 * 86400000 }
}

/** Order-independent equality for a JSONB receipt readback. Never grants write authority. */
export function catalogEvidenceDraftKey(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(catalogEvidenceDraftKey).join(',')}]`
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, entry]) => `${JSON.stringify(key)}:${catalogEvidenceDraftKey(entry)}`)
      .join(',')}}`
  return JSON.stringify(value)
}
