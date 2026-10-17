import type { IntakeCredit } from './intakeEvidence'
import { parseIntakeEvidence } from './intakeEvidenceValidation'
import { normalizeIsbn } from './match'

/** A manually inspected, bibliography-only source record. Never raw provider/model output. */
export interface EditionCreditEvidence {
  version: 1
  source: {
    url: string
    kind: 'publisher' | 'author' | 'unverified'
    checkedAt: string
    locator: string
    retentionConfirmed: true
  }
  identity: {
    title: string
    authors: string[]
    isbn: string
    format: 'paperback' | 'hardcover' | 'ebook' | 'audiobook' | 'other' | null
    language: string | null
  }
  credits: IntakeCredit[]
  confirmations: { sourceChecked: boolean; identityChecked: boolean; creditsChecked: boolean }
}
export interface StoredEditionCredit {
  /** Later catalog identity edits preserve the evidence but require a fresh review. */
  reviewRequired?: true
  reviewId: string
  position: number
  credit: IntakeCredit
  source: EditionCreditEvidence['source']
  identity: EditionCreditEvidence['identity']
}
export interface EditionCreditTarget {
  title: string
  authors: string[]
  isbn: string | null
  format?: string | null
  language?: string | null
  catalogIdentityConsistent?: boolean
}
export const EDITION_CREDIT_HOLDS = {
  source_unverified: 'Check the first-party source and its attribution.',
  confirmation_missing: 'Confirm the source, identity and individual credit evidence.',
  stale_evidence: 'Inspect the source again; this observation is stale or future-dated.',
  identity_conflict: 'The title or complete creator identity differs from the catalog.',
  isbn_conflict: 'The source must identify this exact valid ISBN.',
  edition_conflict: 'The source format or language conflicts with the selected edition.',
  ambiguous_name: 'An initial-only name needs identity review.',
  catalog_identity_review: 'Resolve the catalog creator identity first.',
  role_unverified: 'The role or original credit label is not established.',
  credit_scope_unverified: 'This credit has not been observed on the selected edition.',
  existing_credit: 'This credit is already recorded; preserve its existing evidence.',
} as const
export type EditionCreditHold = keyof typeof EDITION_CREDIT_HOLDS
const key = (s: string) => s.normalize('NFKC').trim().toLowerCase().replace(/\s+/gu, ' ')
const ambiguous = (s: string) => {
  const words = s.match(/\p{L}+/gu) ?? []
  return words.length > 1 && words.slice(0, -1).every((w) => w.length === 1)
}
const creditKey = (c: IntakeCredit) =>
  JSON.stringify([key(c.name), c.role, c.scope, c.part ?? null])
const object = (x: unknown): x is Record<string, unknown> =>
  !!x && typeof x === 'object' && !Array.isArray(x) && Object.getPrototypeOf(x) === Object.prototype
const exact = (x: unknown, fields: string[]): x is Record<string, unknown> =>
  object(x) && Object.keys(x).length === fields.length && fields.every((f) => Object.hasOwn(x, f))

export function parseEditionCreditEvidence(input: unknown): EditionCreditEvidence {
  if (
    !exact(input, ['version', 'source', 'identity', 'credits', 'confirmations']) ||
    input.version !== 1 ||
    !exact(input.source, ['url', 'kind', 'checkedAt', 'locator', 'retentionConfirmed']) ||
    !exact(input.identity, ['title', 'authors', 'isbn', 'format', 'language']) ||
    !exact(input.confirmations, ['sourceChecked', 'identityChecked', 'creditsChecked']) ||
    !Object.values(input.confirmations).every((x) => typeof x === 'boolean') ||
    input.source.retentionConfirmed !== true ||
    !['publisher', 'author', 'unverified'].includes(String(input.source.kind)) ||
    !Array.isArray(input.credits) ||
    !input.credits.length ||
    input.credits.length > 32 ||
    !Array.isArray(input.identity.authors) ||
    !input.identity.authors.length ||
    input.identity.authors.length > 20 ||
    !input.identity.authors.every((a) => typeof a === 'string' && !!a.trim() && a.length <= 1000) ||
    (input.identity.format !== null &&
      !['paperback', 'hardcover', 'ebook', 'audiobook', 'other'].includes(
        String(input.identity.format),
      )) ||
    (input.identity.language !== null &&
      (typeof input.identity.language !== 'string' ||
        !input.identity.language.trim() ||
        input.identity.language.length > 100))
  )
    throw new Error(
      'Use a complete, manually inspected edition-credit record with retention confirmed.',
    )
  // Reuse the strict evidence allowlist for source URLs, timestamps, names, roles and named parts.
  parseIntakeEvidence({
    version: 1,
    targetFingerprint: '0'.repeat(32),
    asOf: input.source.checkedAt,
    target: {
      title: input.identity.title,
      contributors: input.identity.authors,
      isbn: input.identity.isbn,
    },
    existing: {},
    observations: [
      {
        id: 'manual',
        targetFingerprint: '0'.repeat(32),
        status: 'ok',
        source: {
          provider: 'manual-review',
          recordId: 'manual',
          url: input.source.url,
          retrievedAt: input.source.checkedAt,
          lineage: null,
          kind: input.source.kind,
          usage: 'review_only',
          method: 'inspected',
        },
        identity: {
          title: input.identity.title,
          contributors: input.credits,
          scope: 'edition',
          isbns: [input.identity.isbn],
        },
        claims: [
          {
            id: 'credits',
            field: 'contributors',
            scope: 'edition',
            value: input.credits,
            locator: input.source.locator,
          },
        ],
      },
    ],
  })
  return structuredClone(input) as unknown as EditionCreditEvidence
}

/** Conservative preview only; the database repeats these checks against locked current records.
 * Case/whitespace normalization only. No alias, surname, transliteration or role inference.
 * A reviewer attests source entailment; this function does not fetch a URL or grant authority. */
export function reviewEditionCredits(
  input: unknown,
  target: EditionCreditTarget,
  existing: StoredEditionCredit[] = [],
  now = new Date().toISOString(),
) {
  const evidence = parseEditionCreditEvidence(input)
  const reasons: EditionCreditHold[] = []
  if (evidence.source.kind === 'unverified') reasons.push('source_unverified')
  if (!Object.values(evidence.confirmations).every(Boolean)) reasons.push('confirmation_missing')
  const age = Date.parse(now) - Date.parse(evidence.source.checkedAt)
  if (!Number.isFinite(age) || age < 0 || age > 30 * 86400000) reasons.push('stale_evidence')
  if (target.catalogIdentityConsistent === false || !target.authors.length)
    reasons.push('catalog_identity_review')
  if (
    key(target.title) !== key(evidence.identity.title) ||
    JSON.stringify(target.authors.map(key).sort()) !==
      JSON.stringify(evidence.identity.authors.map(key).sort())
  )
    reasons.push('identity_conflict')
  if (target.authors.some(ambiguous) || evidence.identity.authors.some(ambiguous))
    reasons.push('ambiguous_name')
  const isbn = normalizeIsbn(target.isbn ?? '')
  if (!isbn || normalizeIsbn(evidence.identity.isbn) !== isbn) reasons.push('isbn_conflict')
  if (
    (target.format && evidence.identity.format && target.format !== evidence.identity.format) ||
    (target.language &&
      evidence.identity.language &&
      key(target.language) !== key(evidence.identity.language))
  )
    reasons.push('edition_conflict')
  return {
    evidence,
    completeness: 'unverified' as const,
    decisions: evidence.credits.map((credit, position) => {
      const held = [...reasons]
      if (credit.role === 'unknown' || !credit.sourceRole?.trim()) held.push('role_unverified')
      if (credit.basis !== 'edition') held.push('credit_scope_unverified')
      if (ambiguous(credit.name)) held.push('ambiguous_name')
      if (existing.some((c) => !c.reviewRequired && creditKey(c.credit) === creditKey(credit)))
        held.push('existing_credit')
      return { position, credit, reasons: [...new Set(held)], eligible: held.length === 0 }
    }),
  }
}
