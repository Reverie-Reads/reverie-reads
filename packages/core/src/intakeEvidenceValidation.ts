import type { IntakeCredit, IntakeEvidenceRequest, IntakeField } from './intakeEvidence'
import { reviewIntakeCreditCollisions } from './intakeCreditReview'

export const intakeFields: IntakeField[] = [
  'title',
  'contributors',
  'description',
  'pages',
  'publication',
  'publisher',
  'language',
  'format',
  'cover',
  'series',
]
const roles = [
  'author',
  'editor',
  'translator',
  'illustrator',
  'narrator',
  'original_story',
  'playwright',
  'foreword',
  'introduction',
  'contributor',
  'unknown',
]
const formats = ['paperback', 'hardcover', 'ebook', 'audiobook', 'other']
type Obj = Record<string, unknown>
const object = (v: unknown): v is Obj =>
  !!v && typeof v === 'object' && !Array.isArray(v) && Object.getPrototypeOf(v) === Object.prototype
const keys = (v: unknown, required: string[], optional: string[] = []): v is Obj =>
  object(v) &&
  required.every((k) => Object.hasOwn(v, k)) &&
  Object.keys(v).every((k) => [...required, ...optional].includes(k))
const text = (v: unknown, max = 1000): v is string =>
  typeof v === 'string' && !!v.trim() && v.length <= max
const stringList = (v: unknown, max = 40): v is string[] =>
  Array.isArray(v) && v.length <= max && v.every((x) => text(x))
const timestamp = (v: unknown): v is string =>
  typeof v === 'string' &&
  /^\d{4}-\d\d-\d\dT\d\d:\d\d:\d\d(?:\.\d{1,3})?Z$/.test(v) &&
  Number.isFinite(Date.parse(v)) &&
  new Date(v).toISOString().slice(0, 19) === v.slice(0, 19)
const fingerprint = (v: unknown): v is string =>
  typeof v === 'string' && /^(?:[a-f0-9]{32}|[a-f0-9]{64})$/.test(v)
const oneOf = (v: unknown, choices: string[]) => typeof v === 'string' && choices.includes(v)
const https = (v: unknown): boolean => {
  if (!text(v, 2000)) return false
  try {
    const u = new URL(v)
    return u.protocol === 'https:' && !!u.hostname && !u.username && !u.password
  } catch {
    return false
  }
}

function credits(v: unknown, allowDuplicates = false): boolean {
  if (!Array.isArray(v) || !v.length || v.length > 100) return false
  const validShape = v.every((c) => {
    if (
      !keys(
        c,
        ['name', 'role', 'scope'],
        ['part', 'sourceRole', 'sourceRoleCode', 'sourceContributorId', 'basis'],
      ) ||
      !text(c.name) ||
      !oneOf(c.role, roles) ||
      !oneOf(c.scope, ['whole', 'part']) ||
      (c.scope === 'part' ? !text(c.part) : c.part !== undefined) ||
      (c.sourceRole !== undefined &&
        c.sourceRole !== null &&
        (typeof c.sourceRole !== 'string' || c.sourceRole.length > 200)) ||
      (c.sourceRoleCode !== undefined &&
        c.sourceRoleCode !== null &&
        (typeof c.sourceRoleCode !== 'string' || c.sourceRoleCode.length > 40)) ||
      (c.sourceContributorId !== undefined &&
        c.sourceContributorId !== null &&
        !text(c.sourceContributorId, 100)) ||
      (c.basis !== undefined && !oneOf(c.basis, ['work', 'edition']))
    )
      return false
    return true
  })
  // Direct and manual packets must honor the same ambiguity boundary as provider adapters.
  // Shape validation runs first; failed observations alone may retain conflicting rows for review.
  return (
    validShape &&
    (allowDuplicates || reviewIntakeCreditCollisions(v as IntakeCredit[]).length === 0)
  )
}

function publication(v: unknown): boolean {
  if (
    !keys(v, ['y', 'm', 'd']) ||
    !Number.isInteger(v.y) ||
    (v.y as number) < 1 ||
    (v.y as number) > 9999
  )
    return false
  if (v.m === null) return v.d === null
  if (!Number.isInteger(v.m) || (v.m as number) < 1 || (v.m as number) > 12) return false
  if (v.d === null) return true
  if (!Number.isInteger(v.d) || (v.d as number) < 1) return false
  const y = v.y as number
  const days = [
    31,
    y % 4 === 0 && (y % 100 !== 0 || y % 400 === 0) ? 29 : 28,
    31,
    30,
    31,
    30,
    31,
    31,
    30,
    31,
    30,
    31,
  ]
  return (v.d as number) <= days[(v.m as number) - 1]!
}

function value(field: string, v: unknown): boolean {
  switch (field) {
    case 'contributors':
      return credits(v)
    case 'pages':
      return Number.isSafeInteger(v) && (v as number) > 0 && (v as number) <= 100000
    case 'publication':
      return publication(v)
    case 'format':
      return oneOf(v, formats)
    case 'cover':
      return https(v)
    case 'series':
      return (
        keys(v, ['name', 'position', 'memberTitle', 'memberContributors', 'relationship']) &&
        text(v.name) &&
        (v.position === null ||
          (typeof v.position === 'number' && Number.isFinite(v.position) && v.position >= 0)) &&
        text(v.memberTitle) &&
        stringList(v.memberContributors) &&
        v.memberContributors.length > 0 &&
        oneOf(v.relationship, ['explicit_membership', 'search_label'])
      )
    case 'description':
      return text(v, 10000)
    default:
      return text(v)
  }
}

/** Strict allowlists keep personal records, credentials and model-added authority out of packets.
 * Invalid input fails as a whole; callers must retain their draft, never fall back to legacy merging. */
export function parseIntakeEvidence(input: unknown): IntakeEvidenceRequest {
  const fail = (): never => {
    throw new Error('Invalid intake evidence packet')
  }
  if (
    !keys(input, ['version', 'targetFingerprint', 'asOf', 'target', 'existing', 'observations']) ||
    ![1, 2].includes(input.version as number) ||
    !fingerprint(input.targetFingerprint) ||
    !timestamp(input.asOf)
  )
    return fail()
  const t = input.target
  if (
    !keys(
      t,
      [],
      [
        'title',
        'contributors',
        'isbn',
        'format',
        'language',
        ...(input.version === 2 ? ['identityAnchors', 'editionLocator'] : []),
      ],
    ) ||
    !Object.keys(t).length ||
    (t.title !== undefined && !text(t.title)) ||
    (t.contributors !== undefined && (!stringList(t.contributors) || !t.contributors.length)) ||
    (t.isbn !== undefined && !text(t.isbn, 100)) ||
    (t.format !== undefined && !oneOf(t.format, formats)) ||
    (t.language !== undefined && !text(t.language, 100))
  )
    return fail()
  const locator = (v: unknown) =>
    keys(v, ['provider', 'recordId']) && text(v.provider, 100) && text(v.recordId, 200)
  if (
    (t.editionLocator !== undefined && (!locator(t.editionLocator) || t.isbn !== undefined)) ||
    (t.identityAnchors !== undefined &&
      (!Array.isArray(t.identityAnchors) ||
        !t.identityAnchors.length ||
        t.identityAnchors.length > 40 ||
        t.identityAnchors.some(
          (a) =>
            !keys(a, ['name', 'role']) ||
            !text(a.name) ||
            !oneOf(a.role, ['author', 'editor', 'playwright', 'original_story']),
        ) ||
        t.contributors !== undefined))
  )
    return fail()
  if (
    !keys(input.existing, [], intakeFields) ||
    !Object.entries(input.existing).every(([field, v]) => value(field, v))
  )
    return fail()
  if (!Array.isArray(input.observations) || input.observations.length > 50) return fail()
  const ids = new Set<string>()
  for (const o of input.observations) {
    if (
      !keys(
        o,
        ['id', 'targetFingerprint', 'source', 'status', 'claims'],
        ['identity', 'responsibilityStatement', 'creditStatements', 'withheldCredits'],
      ) ||
      !text(o.id, 200) ||
      ids.has(o.id) ||
      !fingerprint(o.targetFingerprint) ||
      !oneOf(o.status, ['ok', 'empty', 'failed', 'capped']) ||
      (o.responsibilityStatement !== undefined && !text(o.responsibilityStatement, 1000)) ||
      (o.creditStatements !== undefined && !stringList(o.creditStatements, 32)) ||
      (o.withheldCredits !== undefined &&
        (o.status !== 'failed' || !credits(o.withheldCredits, true)))
    )
      return fail()
    ids.add(o.id)
    const s = o.source
    if (
      !keys(s, [
        'provider',
        'recordId',
        'url',
        'retrievedAt',
        'lineage',
        'kind',
        'usage',
        'method',
      ]) ||
      !text(s.provider, 100) ||
      !text(s.recordId, 200) ||
      !https(s.url) ||
      !timestamp(s.retrievedAt) ||
      (s.lineage !== null && !text(s.lineage, 200)) ||
      !oneOf(s.kind, ['publisher', 'author', 'bibliographic', 'reviewed_catalog', 'unverified']) ||
      !oneOf(s.usage, ['eligible', 'review_only']) ||
      !oneOf(s.method, ['structured', 'inspected', 'model_proposal'])
    )
      return fail()
    if (!Array.isArray(o.claims) || o.claims.length > 30) return fail()
    if (o.status !== 'ok') {
      if (
        o.identity !== undefined ||
        o.claims.length ||
        o.creditStatements !== undefined ||
        o.responsibilityStatement !== undefined
      )
        return fail()
      continue
    }
    const identity = o.identity
    if (
      !keys(
        identity,
        ['title', 'contributors', 'scope', 'isbns'],
        ['subtitle', ...(input.version === 2 ? ['editionLocator'] : [])],
      ) ||
      !text(identity.title) ||
      (identity.subtitle !== undefined && !text(identity.subtitle)) ||
      !credits(identity.contributors) ||
      !oneOf(identity.scope, ['work', 'edition']) ||
      !stringList(identity.isbns, 20)
    )
      return fail()
    if (
      identity.editionLocator !== undefined &&
      (!locator(identity.editionLocator) || identity.scope !== 'edition')
    )
      return fail()
    const claims = new Set<string>()
    for (const c of o.claims) {
      if (
        !keys(c, ['id', 'field', 'value', 'scope', 'locator']) ||
        !text(c.id, 200) ||
        claims.has(c.id) ||
        !oneOf(c.field, intakeFields) ||
        !value(c.field as string, c.value) ||
        !oneOf(c.scope, ['work', 'edition']) ||
        !text(c.locator, 2000)
      )
        return fail()
      claims.add(c.id)
    }
  }
  // Validation precedes cloning so unsupported properties cannot be silently discarded.
  return JSON.parse(JSON.stringify(input)) as IntakeEvidenceRequest
}
