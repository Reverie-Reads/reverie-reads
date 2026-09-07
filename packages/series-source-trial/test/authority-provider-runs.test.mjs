import assert from 'node:assert/strict'
import { test } from 'node:test'
import { authorityProviderRuns } from '../src/authority/provider-runs.mjs'
import { buildEvidencePacket, validateResolution } from '../src/resolver/evidence.mjs'

const caseId = 'second-book'
const sourceUrl = 'https://author.example/books/second-book'
const target = {
  schemaVersion: 1,
  caseId,
  target: {
    title: 'Second Book',
    authors: ['Ada Reader'],
    publicationYear: 2026,
  },
}
const output = {
  caseId,
  identity: { matched: true, confidence: 'high', evidenceUrls: [sourceUrl] },
  classification: 'series',
  memberships: [
    {
      series: 'The Sequence',
      position: 2,
      role: 'primary',
      evidenceUrls: [sourceUrl],
    },
  ],
  authoritySources: [
    {
      url: sourceUrl,
      kind: 'author',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary:
        'The author places Second Book second in the explicitly named The Sequence series.',
    },
  ],
  uncertainties: [],
  note: 'Direct author evidence.',
}

const validation = {
  valid: true,
  policySafe: true,
  reviewOnly: true,
  errors: [],
  policyViolations: [],
}

const selectedRetrieval = {
  selectedPass: 'retrieval',
  selectedSourceManifest: { kind: 'retrieval', urls: [sourceUrl] },
  retrieval: {
    status: 'retrieved',
    reviewOnly: true,
    manifest: {
      caseId,
      childFinalUrl: sourceUrl,
      profileVersion: 'author-example-v1',
      sourceKind: 'author',
      sanitizedSha256: 'a'.repeat(64),
    },
  },
}

const retrievalOptions = {
  profiles: [
    {
      schemaVersion: 1,
      profileVersion: 'author-example-v1',
      canonicalOrigin: 'https://author.example',
      canonicalAliases: [],
      sourceKind: 'author',
      status: 'approved_trial',
      termsReviewedAt: '2026-09-01T00:00:00.000Z',
      expiresAt: '2026-12-01T00:00:00.000Z',
      reviewedBy: 'test-reviewer',
      reviewReference: 'test-fixture',
    },
  ],
  now: new Date('2026-09-06T00:00:00.000Z'),
}

const retrievalInterpretation = (selectedOutput = output) => ({
  status: 'completed',
  sourceManifestUrls: [sourceUrl],
  output: selectedOutput,
  validation,
})

const reportWith = (result) => ({
  schemaVersion: 1,
  targets: [target],
  results: [result],
})

const resultWith = (extra = {}) => ({
  caseId,
  status: 'completed',
  output,
  validation,
  ...extra,
})

const testCase = { id: caseId, title: 'Second Book', authors: ['Ada Reader'] }

const accepted = {
  caseId,
  decision: 'accept_membership',
  identity: {
    matched: true,
    confidence: 'high',
    evidenceIds: ['authority-retrieval:identity'],
  },
  memberships: [
    {
      series: 'The Sequence',
      position: 2,
      orderType: 'unspecified',
      role: 'primary',
      confidence: 'high',
      evidenceIds: ['authority-retrieval:membership:0'],
    },
  ],
  reviewReasons: [],
  note: 'Reviewed retrieval supports the exact relationship.',
}

test('keeps a policy-safe first-pass scout relationship review-only', () => {
  const runs = authorityProviderRuns(reportWith(resultWith()))

  assert.equal(runs.length, 1)
  assert.equal(runs[0].provider, 'authority-scout')
  const packet = buildEvidencePacket(testCase, runs)
  assert.equal(packet.membershipEvidence[0].quality.membershipEligible, false)
  assert.ok(packet.membershipEvidence[0].quality.riskFlags.includes('membership_source_disallowed'))

  const proposal = structuredClone(accepted)
  proposal.identity.evidenceIds = ['authority-scout:identity']
  proposal.memberships[0].evidenceIds = ['authority-scout:membership:0']
  assert.equal(validateResolution(packet, proposal).policySafe, false)
})

test('admits only a matching policy-safe retrieval interpretation as automatic evidence', () => {
  const runs = authorityProviderRuns(
    reportWith(
      resultWith({
        ...selectedRetrieval,
        retrievalInterpretation: retrievalInterpretation(),
      }),
    ),
    retrievalOptions,
  )

  assert.equal(runs.length, 1)
  assert.equal(runs[0].provider, 'authority-retrieval')
  const packet = buildEvidencePacket(testCase, runs)
  const evidence = packet.membershipEvidence[0]
  assert.equal(evidence.quality.membershipEligible, true)
  assert.equal(evidence.quality.positionEligible, true)
  assert.equal(evidence.sourceKind, 'author')
  assert.match(evidence.evidenceSummary, /explicitly named The Sequence series/)
  assert.equal(validateResolution(packet, accepted).policySafe, true)
})

test('rejects a retrieval whose persisted interpretation does not match the selected output', () => {
  const mismatched = structuredClone(output)
  mismatched.memberships[0].series = 'A Different Sequence'
  const runs = authorityProviderRuns(
    reportWith(
      resultWith({
        ...selectedRetrieval,
        retrievalInterpretation: retrievalInterpretation(mismatched),
      }),
    ),
    retrievalOptions,
  )

  assert.deepEqual(runs, [])
})

test('rejects retrieved authority sources outside the selected child manifest', () => {
  const runs = authorityProviderRuns(
    reportWith(
      resultWith({
        ...selectedRetrieval,
        selectedSourceManifest: {
          kind: 'retrieval',
          urls: ['https://author.example/books/a-different-book'],
        },
        retrievalInterpretation: retrievalInterpretation(),
      }),
    ),
    retrievalOptions,
  )

  assert.deepEqual(runs, [])
})

test('rejects retrieval evidence without the persisted reviewed-origin manifest', () => {
  const incompleteRetrieval = structuredClone(selectedRetrieval)
  delete incompleteRetrieval.retrieval.manifest.profileVersion
  const runs = authorityProviderRuns(
    reportWith(
      resultWith({
        ...incompleteRetrieval,
        retrievalInterpretation: retrievalInterpretation(),
      }),
    ),
    retrievalOptions,
  )

  assert.deepEqual(runs, [])
})

test('rejects retrieval evidence when the recorded origin profile is not currently approved', () => {
  const runs = authorityProviderRuns(
    reportWith(
      resultWith({
        ...selectedRetrieval,
        retrievalInterpretation: retrievalInterpretation(),
      }),
    ),
  )

  assert.deepEqual(runs, [])
})

test('does not turn a first-pass standalone classification into negative series evidence', () => {
  const standalone = structuredClone(output)
  standalone.classification = 'standalone'
  standalone.memberships = []
  standalone.authoritySources[0].supports = ['identity', 'standalone']
  const [run] = authorityProviderRuns(reportWith(resultWith({ output: standalone })))

  assert.equal(run.provider, 'authority-scout')
  assert.equal(run.results[0].workMatch.matched, true)
  assert.deepEqual(run.results[0].seriesClaims, [])
})

test('requires a complete authority-acquisition report', () => {
  assert.throws(() => authorityProviderRuns({}), /complete authority-acquisition JSON report/)
  assert.throws(
    () => authorityProviderRuns({ targets: [target], results: [] }),
    /target\/result ids differ/,
  )
  assert.throws(
    () =>
      authorityProviderRuns({
        targets: [target],
        results: [resultWith(), { ...resultWith(), caseId: 'unknown-book' }],
      }),
    /unknown results unknown-book/,
  )
  assert.throws(
    () => authorityProviderRuns({ targets: [target], results: [resultWith(), resultWith()] }),
    /duplicate result ids/,
  )
})
