import type { IntakeField, IntakeResolution } from './intakeEvidence'
import { intakeFields } from './intakeEvidenceValidation'
import { intakeIdentityReviewReasons } from './intakeResolver'

export interface IntakeDiagnosticContext {
  /** Explicit requirements for this task, never a new global requirement for Add. */
  requiredFields: IntakeField[]
  /** A human's explicit refusal. A hold, closing a screen or an unchosen result is not refusal. */
  reviewDecision: 'unobserved' | 'declined'
}

/** Fixed, overlapping case indicators. No values, identities, URLs, source labels or free text. */
export function intakeOutcomeDiagnostics(
  result: IntakeResolution,
  context: IntakeDiagnosticContext = { requiredFields: [], reviewDecision: 'unobserved' },
) {
  if (
    !context ||
    Object.keys(context).length !== 2 ||
    !Array.isArray(context.requiredFields) ||
    new Set(context.requiredFields).size !== context.requiredFields.length ||
    context.requiredFields.some((f) => !intakeFields.includes(f)) ||
    !['unobserved', 'declined'].includes(context.reviewDecision)
  )
    throw new Error('Invalid intake diagnostic context')
  const request = result.request
  const current = request.observations.filter((o) => {
    const age = Date.parse(request.asOf) - Date.parse(o.source.retrievedAt)
    return o.targetFingerprint === request.targetFingerprint && age >= 0 && age <= 30 * 86400000
  })
  const selectedEdition = !!(request.target.isbn || request.target.editionLocator)
  const allEmpty =
    current.length > 0 &&
    current.every((o) => o.status === 'empty') &&
    current.length === request.observations.length &&
    !result.work.reasons.includes('invalid_isbn')
  const identityHold =
    current.some((o) => o.status === 'ok' && intakeIdentityReviewReasons(request, o).length > 0) ||
    result.work.reasons.some((r) =>
      [
        'invalid_isbn',
        'existing_identity_conflict',
        'competing_identities',
        'isbn_conflict',
      ].includes(r),
    )
  const editionFields = ['pages', 'publication', 'publisher', 'language', 'format']
  const required = context.requiredFields.map((f) => {
    const field = result.fields.find((d) => d.field === f)!
    if (!current.length && field.current === undefined) return 'unobserved'
    const scopeResolved = editionFields.includes(f)
      ? result.edition.state === 'resolved'
      : result.work.state === 'resolved'
    if (!scopeResolved || field.state === 'review') return 'held'
    // Missing in admitted observations is not proof that the fact is absent from every source.
    return field.state === 'missing' ? 'missing' : 'available'
  })
  return {
    acquisitionUnobserved: request.observations.length === 0,
    providerFailure: current.some((o) => o.status === 'failed'),
    responseCapped: current.some((o) => o.status === 'capped'),
    staleOrChangedEvidence: current.length !== request.observations.length,
    workLookupEmpty: allEmpty && !selectedEdition,
    editionLookupEmpty: allEmpty && selectedEdition,
    identityOrRoleHold: identityHold,
    // A returned, resolved work without the selected edition is separate from an empty lookup.
    selectedEditionUnresolved:
      selectedEdition &&
      !allEmpty &&
      result.work.state === 'resolved' &&
      result.edition.state !== 'resolved',
    evidenceReviewHold:
      !allEmpty &&
      current.some((o) => o.status === 'ok') &&
      (result.work.state !== 'resolved' || result.fields.some((f) => f.state === 'review')),
    requiredFieldsSpecified: required.length > 0,
    requiredFieldMissing: required.includes('missing'),
    requiredFieldHeld: required.includes('held'),
    requiredFieldUnobserved: required.includes('unobserved'),
    requiredFieldsAvailable: required.length > 0 && required.every((v) => v === 'available'),
    reviewDeclined: context.reviewDecision === 'declined',
    reviewDecisionUnobserved: context.reviewDecision === 'unobserved',
  }
}

export type IntakeOutcomeDiagnostic = ReturnType<typeof intakeOutcomeDiagnostics>

const diagnosticKeys = [
  'acquisitionUnobserved',
  'providerFailure',
  'responseCapped',
  'staleOrChangedEvidence',
  'workLookupEmpty',
  'editionLookupEmpty',
  'identityOrRoleHold',
  'selectedEditionUnresolved',
  'evidenceReviewHold',
  'requiredFieldsSpecified',
  'requiredFieldMissing',
  'requiredFieldHeld',
  'requiredFieldUnobserved',
  'requiredFieldsAvailable',
  'reviewDeclined',
  'reviewDecisionUnobserved',
] as const satisfies readonly (keyof IntakeOutcomeDiagnostic)[]

/** Counts cases, not provider attempts. Keep the full denominator and unobserved metrics. */
export function summarizeIntakeOutcomes(cases: IntakeOutcomeDiagnostic[]) {
  const counts = Object.fromEntries(
    diagnosticKeys.map((key) => [key, cases.filter((c) => c[key]).length]),
  ) as Record<keyof IntakeOutcomeDiagnostic, number>
  return {
    cases: cases.length,
    counts,
    // This offline evidence path cannot establish absence, reader frequency or writer success.
    confirmedBookAbsence: null,
    confirmedEditionAbsence: null,
    realReaderFailureRate: null,
    deliberateAddSuccess: null,
    correctionEffort: null,
    latency: null,
    acquisitionAndReviewCost: null,
  }
}
