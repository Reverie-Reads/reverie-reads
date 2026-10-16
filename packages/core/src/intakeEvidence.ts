/** A review packet, never a Book patch or an authorization to write the catalog.
 * Source qualification is supplied by trusted acquisition/review code, never by a model.
 * Values are observations, not proof that a cited document entails a claim. */
export const INTAKE_EVIDENCE_VERSION = 1 as const

export type IntakeCreditRole =
  | 'author'
  | 'editor'
  | 'translator'
  | 'illustrator'
  | 'narrator'
  | 'original_story'
  | 'playwright'
  | 'foreword'
  | 'introduction'
  | 'contributor'
  | 'unknown'

export interface IntakeCredit {
  name: string
  role: IntakeCreditRole
  /** A story in an anthology is not authorship of the whole anthology. */
  scope: 'whole' | 'part'
  part?: string
}

export interface IntakeFacts {
  title: string
  contributors: IntakeCredit[]
  description: string
  pages: number
  publication: { y: number; m: number | null; d: number | null }
  publisher: string
  language: string
  format: 'paperback' | 'hardcover' | 'ebook' | 'audiobook' | 'other'
  cover: string
  series: {
    name: string
    position: number | null
    memberTitle: string
    memberContributors: string[]
    relationship: 'explicit_membership' | 'search_label'
  }
}

export type IntakeField = keyof IntakeFacts
export type IntakeClaim = {
  [F in IntakeField]: {
    id: string
    field: F
    value: IntakeFacts[F]
    scope: 'work' | 'edition'
    locator: string
  }
}[IntakeField]

export interface IntakeObservedIdentity {
  title: string
  subtitle?: string
  contributors: IntakeCredit[]
  scope: 'work' | 'edition'
  /** One selected edition, with equivalent ISBN-10/13 identifiers only. */
  isbns: string[]
}

export interface IntakeEvidenceSource {
  provider: string
  recordId: string
  url: string
  retrievedAt: string
  /** Shared upstream records use the same lineage. Unknown never implies independence. */
  lineage: string | null
  kind: 'publisher' | 'author' | 'bibliographic' | 'reviewed_catalog' | 'unverified'
  usage: 'eligible' | 'review_only'
  method: 'structured' | 'inspected' | 'model_proposal'
}

export interface IntakeObservation {
  id: string
  targetFingerprint: string
  source: IntakeEvidenceSource
  status: 'ok' | 'empty' | 'failed' | 'capped'
  identity?: IntakeObservedIdentity
  claims: IntakeClaim[]
}

export interface IntakeEvidenceRequest {
  version: 1
  /** Frozen target revision, including its existing values; caller rechecks before any save. */
  targetFingerprint: string
  asOf: string
  target: {
    title?: string
    contributors?: string[]
    isbn?: string
    format?: IntakeFacts['format']
    language?: string
  }
  existing: Partial<IntakeFacts>
  observations: IntakeObservation[]
}

export type IntakeReviewReason =
  | 'invalid_isbn'
  | 'identity_incomplete'
  | 'identity_mismatch'
  | 'existing_identity_conflict'
  | 'ambiguous_name'
  | 'competing_identities'
  | 'isbn_conflict'
  | 'edition_unresolved'
  | 'edition_conflict'
  | 'source_failed'
  | 'source_capped'
  | 'stale_evidence'
  | 'target_changed'
  | 'review_only_source'
  | 'unverified_source'
  | 'model_proposal'
  | 'insufficient_support'
  | 'wrong_scope'
  | 'unsupported_claim'
  | 'field_conflict'
  | 'existing_value'
  | 'not_applicable'
  | 'relationship_unverified'

export interface IntakeClaimDecision {
  observationId: string
  claimId: string
  field: IntakeField
  state: 'supported' | 'review'
  reasons: IntakeReviewReason[]
}

export interface IntakeFieldDecision {
  field: IntakeField
  state: 'proposed' | 'preserved' | 'review' | 'missing'
  current?: IntakeFacts[IntakeField]
  proposed?: IntakeFacts[IntakeField]
  evidence: { observationId: string; claimId: string }[]
  independentOrigins: number
  reasons: IntakeReviewReason[]
}

export interface IntakeResolution {
  version: 1
  mode: 'review_only'
  targetFingerprint: string
  /** A defensive snapshot: retains original input and rejected observations for inspection. */
  request: IntakeEvidenceRequest
  work: {
    state: 'resolved' | 'review' | 'unresolved'
    observationIds: string[]
    reasons: IntakeReviewReason[]
  }
  edition: {
    state: 'resolved' | 'review' | 'unknown'
    isbn: string | null
    reasons: IntakeReviewReason[]
  }
  acquisition: { complete: boolean; empty: number; failed: number; capped: number }
  observations: { id: string; reasons: IntakeReviewReason[] }[]
  claims: IntakeClaimDecision[]
  fields: IntakeFieldDecision[]
}
