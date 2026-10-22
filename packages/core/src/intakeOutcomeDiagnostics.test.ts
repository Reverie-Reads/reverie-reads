import { describe, expect, it } from 'vitest'
import type { IntakeEvidenceRequest, IntakeObservation } from './intakeEvidence'
import { resolveIntakeEvidence } from './intakeResolver'
import { intakeOutcomeDiagnostics, summarizeIntakeOutcomes } from './intakeOutcomeDiagnostics'

const fingerprint = 'a'.repeat(32)
const at = '2026-10-22T12:00:00Z'
const title = 'A Quiet Atlas'
const credit = { name: 'Avery Reader', role: 'author' as const, scope: 'whole' as const }
const isbn = '9780306406157'
const observation = (patch: Partial<IntakeObservation> = {}): IntakeObservation => ({
  id: 'source',
  targetFingerprint: fingerprint,
  status: 'ok',
  source: {
    provider: 'synthetic',
    recordId: 'record',
    url: 'https://publisher.example/book',
    retrievedAt: at,
    lineage: 'synthetic',
    kind: 'publisher',
    usage: 'eligible',
    method: 'inspected',
  },
  identity: { title, contributors: [credit], scope: 'edition', isbns: [isbn] },
  claims: [],
  ...patch,
})
const request = (observations: IntakeObservation[] = [observation()]): IntakeEvidenceRequest => ({
  version: 1,
  targetFingerprint: fingerprint,
  asOf: at,
  target: { title, contributors: [credit.name], isbn },
  existing: {},
  observations,
})
const diagnose = (r: IntakeEvidenceRequest) => intakeOutcomeDiagnostics(resolveIntakeEvidence(r))
const empty = (patch: Partial<IntakeObservation> = {}) =>
  observation({ status: 'empty', identity: undefined, ...patch })

describe('intake outcome diagnostics', () => {
  it('keeps an unattempted lookup distinct from successful empty edition and work lookups', () => {
    expect(diagnose(request([]))).toMatchObject({
      acquisitionUnobserved: true,
      editionLookupEmpty: false,
      identityOrRoleHold: false,
    })
    expect(diagnose(request([empty()]))).toMatchObject({
      editionLookupEmpty: true,
      workLookupEmpty: false,
      identityOrRoleHold: false,
    })
    const work = request([empty()])
    delete work.target.isbn
    expect(diagnose(work)).toMatchObject({ workLookupEmpty: true, editionLookupEmpty: false })
  })
  it.each(['failed', 'capped'] as const)('never calls a partial %s response empty', (status) => {
    const d = diagnose(request([empty(), empty({ id: 'other', status })]))
    expect(d.editionLookupEmpty).toBe(false)
    expect(status === 'failed' ? d.providerFailure : d.responseCapped).toBe(true)
    expect(d.identityOrRoleHold).toBe(false)
  })
  it('retains provider failure alongside a valid peer rather than hiding it in success', () => {
    const d = diagnose(request([observation(), empty({ id: 'failed', status: 'failed' })]))
    expect(d).toMatchObject({
      providerFailure: true,
      editionLookupEmpty: false,
      identityOrRoleHold: false,
    })
  })
  it('does not treat stale or changed empty observations as current absence', () => {
    for (const o of [
      empty({ targetFingerprint: 'b'.repeat(32) }),
      empty({ source: { ...empty().source, retrievedAt: '2026-09-01T00:00:00Z' } }),
    ])
      expect(diagnose(request([o]))).toMatchObject({
        staleOrChangedEvidence: true,
        editionLookupEmpty: false,
      })
  })
  it('does not count an invalid ISBN as an empty exact-edition lookup', () => {
    const r = request([empty()])
    r.target.isbn = 'invalid'
    expect(diagnose(r)).toMatchObject({ identityOrRoleHold: true, editionLookupEmpty: false })
  })
  it('keeps creator, role and responsibility holds separate from absence and missing fields', () => {
    for (const o of [
      observation({
        identity: { ...observation().identity!, contributors: [{ ...credit, role: 'editor' }] },
      }),
      observation({ responsibilityStatement: 'Edited by Avery Reader' }),
      observation({ identity: { ...observation().identity!, title: 'Another atlas' } }),
    ]) {
      const d = intakeOutcomeDiagnostics(resolveIntakeEvidence(request([o])), {
        requiredFields: ['pages'],
        reviewDecision: 'unobserved',
      })
      expect(d).toMatchObject({
        identityOrRoleHold: true,
        editionLookupEmpty: false,
        requiredFieldMissing: false,
        requiredFieldHeld: true,
        reviewDeclined: false,
      })
    }
  })
  it('recognizes a resolved work without a selected edition', () => {
    const d = diagnose(
      request([
        observation({ identity: { title, contributors: [credit], scope: 'work', isbns: [isbn] } }),
      ]),
    )
    expect(d).toMatchObject({
      selectedEditionUnresolved: true,
      editionLookupEmpty: false,
      identityOrRoleHold: false,
    })
  })
  it('only counts explicitly required fields, keeping held values separate from missing ones', () => {
    const resolved = resolveIntakeEvidence(request())
    expect(intakeOutcomeDiagnostics(resolved).requiredFieldsSpecified).toBe(false)
    expect(
      intakeOutcomeDiagnostics(resolveIntakeEvidence(request([])), {
        requiredFields: ['pages'],
        reviewDecision: 'unobserved',
      }),
    ).toMatchObject({
      requiredFieldUnobserved: true,
      requiredFieldMissing: false,
      requiredFieldHeld: false,
    })
    expect(
      intakeOutcomeDiagnostics(resolved, {
        requiredFields: ['pages'],
        reviewDecision: 'unobserved',
      }),
    ).toMatchObject({ requiredFieldMissing: true, requiredFieldHeld: false })
    const r = request()
    r.existing.pages = 321
    expect(
      intakeOutcomeDiagnostics(resolveIntakeEvidence(r), {
        requiredFields: ['pages'],
        reviewDecision: 'unobserved',
      }),
    ).toMatchObject({ requiredFieldsAvailable: true, requiredFieldMissing: false })
  })
  it('records only an explicit refusal and never turns it into a save or source failure', () => {
    const d = intakeOutcomeDiagnostics(resolveIntakeEvidence(request()), {
      requiredFields: [],
      reviewDecision: 'declined',
    })
    expect(d).toMatchObject({
      reviewDeclined: true,
      reviewDecisionUnobserved: false,
      providerFailure: false,
    })
    expect(summarizeIntakeOutcomes([d])).toMatchObject({
      cases: 1,
      deliberateAddSuccess: null,
      realReaderFailureRate: null,
      confirmedBookAbsence: null,
      confirmedEditionAbsence: null,
    })
  })
  it('retains every case in a denominator and exports only fixed counts and unobserved metrics', () => {
    const r = request()
    const before = JSON.stringify(r)
    const ds = [
      diagnose(r),
      diagnose(request([])),
      diagnose(request([empty({ status: 'failed' })])),
    ]
    const report = summarizeIntakeOutcomes(ds)
    expect(report.cases).toBe(3)
    expect(report.counts).toMatchObject({
      providerFailure: 1,
      acquisitionUnobserved: 1,
      reviewDecisionUnobserved: 3,
    })
    expect(Object.keys(report.counts).sort()).toEqual(Object.keys(ds[0]!).sort())
    const text = JSON.stringify(report)
    for (const value of [title, credit.name, isbn, fingerprint, 'publisher.example', 'record', at])
      expect(text).not.toContain(value)
    expect(JSON.stringify(r)).toBe(before)
    expect(summarizeIntakeOutcomes([]).counts.providerFailure).toBe(0)
  })
  it('rejects accidental free text, duplicate requirements and inferred acceptance', () => {
    const result = resolveIntakeEvidence(request())
    for (const context of [
      { requiredFields: [], reviewDecision: 'accepted' },
      { requiredFields: ['notes'], reviewDecision: 'unobserved' },
      { requiredFields: ['pages', 'pages'], reviewDecision: 'unobserved' },
      { requiredFields: [], reviewDecision: 'declined', note: 'private' },
    ])
      expect(() => intakeOutcomeDiagnostics(result, context as never)).toThrow(
        'Invalid intake diagnostic context',
      )
  })
})
