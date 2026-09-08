import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  auditQualificationLock,
  auditQualificationPool,
  createQualificationLock,
  evaluateQualificationScore,
  qualificationDataset,
  selectQualificationCases,
  sha256Json,
} from '../src/authority/qualification.mjs'
import { authorityPolicyForCase } from '../src/authority/evidence.mjs'

const plan = {
  schemaVersion: 1,
  id: 'qualification-test',
  evaluationPartition: 'qualification',
  selection: {
    algorithm: 'sha256-ranked-greedy-coverage-v1',
    seed: 'fixed-test-seed',
    candidatePoolMinimum: 4,
    maximumSelectedWorksPerAuthor: 1,
    targetCases: 2,
    targetSeriesCases: 1,
    targetStandaloneCases: 1,
    requirePublicationMetadata: true,
    allowedSelectionSourceKinds: ['publisher_catalog'],
    prohibitedSelectionSourceKinds: [
      'openlibrary',
      'wikidata',
      'google_books',
      'hardcover',
      'exa',
      'model_output',
    ],
    coverageMinimums: [
      { id: 'recent_2021_plus', label: 'Recent', minimumSelected: 1 },
      { id: 'backlist_pre_2021', label: 'Backlist', minimumSelected: 1 },
    ],
  },
  truth: {
    authoritySourceKinds: ['author', 'publisher'],
  },
  runPolicy: { uses: 'single-complete-run' },
}

const reviewedCase = ({ id, title, author, standalone, publicationYear }) => ({
  id,
  title,
  authors: [author],
  evaluationPartition: 'qualification',
  publicationYear,
  publicationPath: 'traditional',
  selectionFrameIds: ['publisher-frame'],
  selectionSources: [
    {
      frameId: 'publisher-frame',
      kind: 'publisher_catalog',
      url: 'https://publisher.example/catalog',
    },
  ],
  truth: {
    status: 'reviewed',
    reviewer: 'reviewer-test',
    reviewedAt: '2026-09-07T12:30:00.000Z',
    reviewBlindToSystemOutput: true,
    reviewNote: 'Reviewed against the cited publisher authority.',
    standalone,
    memberships: standalone
      ? []
      : [{ series: `${title} Series`, aliases: [], role: 'primary', positions: [] }],
    sources: [{ kind: 'publisher', url: `https://publisher.example/books/${id}` }],
  },
})

const cases = [
  reviewedCase({
    id: 'series-a',
    title: 'Series A',
    author: 'Author A',
    standalone: false,
    publicationYear: 2024,
  }),
  reviewedCase({
    id: 'series-b',
    title: 'Series B',
    author: 'Author B',
    standalone: false,
    publicationYear: 2018,
  }),
  reviewedCase({
    id: 'standalone-a',
    title: 'Standalone A',
    author: 'Author C',
    standalone: true,
    publicationYear: 2019,
  }),
  reviewedCase({
    id: 'standalone-b',
    title: 'Standalone B',
    author: 'Author D',
    standalone: true,
    publicationYear: 2025,
  }),
]

const selectionFrames = [
  {
    id: 'publisher-frame',
    kind: 'publisher_catalog',
    url: 'https://publisher.example/catalog',
    capturedAt: '2026-09-07T12:00:00.000Z',
    complete: true,
    populationCases: 4,
    eligibleReviewedCases: 4,
    exclusions: [],
  },
]

const poolFor = (poolCases = cases) => ({ schemaVersion: 1, selectionFrames, cases: poolCases })

test('selects a deterministic balanced qualification set from a reviewed private pool', () => {
  const pool = poolFor()
  const first = selectQualificationCases(pool, plan)
  const second = selectQualificationCases({ ...pool, cases: [...cases].reverse() }, plan)

  assert.deepEqual(
    first.map(({ id }) => id),
    second.map(({ id }) => id),
  )
  assert.equal(first.length, 2)
  assert.equal(first.filter((entry) => entry.truth.standalone).length, 1)
})

test('rejects provider-selected and development-overlap cases before freezing', () => {
  const providerSelected = structuredClone(cases[0])
  providerSelected.selectionSources = [
    {
      frameId: 'publisher-frame',
      kind: 'hardcover',
      url: 'https://hardcover.app/books/1',
    },
  ]
  const audit = auditQualificationPool(poolFor([providerSelected, ...cases.slice(1)]), plan, {
    developmentCases: [cases[1]],
  })

  assert.equal(audit.valid, false)
  assert.match(audit.errors.join('\n'), /selection provenance cannot use hardcover/)
  assert.match(audit.errors.join('\n'), /already appears in the development partition/)
})

test('rejects incomplete or selectively counted identity frames', () => {
  const incompleteFrames = structuredClone(selectionFrames)
  incompleteFrames[0].complete = false
  incompleteFrames[0].populationCases = 6
  incompleteFrames[0].eligibleReviewedCases = 3
  incompleteFrames[0].exclusions = [{ reason: 'no affirmative truth', count: 1 }]
  const audit = auditQualificationPool(
    { schemaVersion: 1, selectionFrames: incompleteFrames, cases },
    plan,
  )

  assert.equal(audit.valid, false)
  assert.match(audit.errors.join('\n'), /complete=true/)
  assert.match(audit.errors.join('\n'), /exclusion counts do not reconcile/)
  assert.match(audit.errors.join('\n'), /expected 3 eligible reviewed cases; found 4/)
})

test('can enforce frame reconciliation before the full pool reaches its minimum size', () => {
  const incompleteCases = cases.slice(0, 3)
  const audit = auditQualificationPool(poolFor(incompleteCases), plan, {
    requirePoolMinimum: false,
    requireFrameReconciliation: true,
  })

  assert.equal(audit.valid, false)
  assert.doesNotMatch(audit.errors.join('\n'), /requires at least 4 cases/)
  assert.match(audit.errors.join('\n'), /expected 4 eligible reviewed cases; found 3/)
})

test('blocks each private selection source from establishing its own classification', () => {
  const policy = authorityPolicyForCase(cases[0], { selectionFrames: [] })

  assert.deepEqual(policy.classificationBlockedUrls, ['https://publisher.example/catalog'])
})

test('requires a dated blind-review attestation and separate classification evidence', () => {
  const unattested = structuredClone(cases[0])
  delete unattested.truth.reviewer
  delete unattested.truth.reviewedAt
  delete unattested.truth.reviewBlindToSystemOutput
  unattested.truth.reviewNote = ''
  unattested.truth.sources = [
    {
      kind: 'publisher',
      url: 'https://publisher.example/catalog',
    },
  ]
  const audit = auditQualificationPool(poolFor([unattested, ...cases.slice(1)]), plan)

  assert.equal(audit.valid, false)
  assert.match(audit.errors.join('\n'), /reviewed truth requires reviewer/)
  assert.match(audit.errors.join('\n'), /selection-frame URL cannot also establish/)
})

test('lock binds the private dataset, plan, and complete acquisition system', () => {
  const pool = { ...poolFor(), sharedSources: {} }
  const dataset = qualificationDataset(pool, plan, selectQualificationCases(pool, plan))
  const systemMaterial = {
    schemaVersion: 1,
    promptVersion: 'test-prompt',
    runtime: { model: 'test-model' },
    files: { 'src/example.mjs': 'file-sha' },
  }
  const systemManifest = { ...systemMaterial, sha256: sha256Json(systemMaterial) }
  const lock = createQualificationLock({
    plan,
    dataset,
    systemManifest,
    datasetFile: 'qualification-test.set.json',
  })

  assert.equal(auditQualificationLock({ lock, dataset, plan, systemManifest }).valid, true)

  const changedDataset = structuredClone(dataset)
  changedDataset.cases[0].title = 'Changed after sealing'
  const changedSystem = { ...systemManifest, sha256: 'changed' }
  const tampered = auditQualificationLock({
    lock,
    dataset: changedDataset,
    plan,
    systemManifest: changedSystem,
  })

  assert.equal(tampered.valid, false)
  assert.match(tampered.errors.join('\n'), /dataset sha256 changed/)
  assert.match(tampered.errors.join('\n'), /system manifest changed/)
})

test('requires both statistical safety and useful recall to pass qualification', () => {
  const score = {
    scope: { reviewedCases: 1000, positiveCases: 600, standaloneCases: 400 },
    capability: {
      membershipPrecision: 1,
      membershipRecall: 0.9,
      resolutionRate: 0.8,
      falseStandaloneRate: 0,
    },
    counts: {
      truePositiveClaims: 540,
      falsePositiveClaims: 0,
      falseStandaloneCases: 0,
    },
    operations: { errors: 0 },
  }
  const policy = {
    qualificationGates: {
      minimumReviewedCases: 1000,
      minimumReviewedPositiveCases: 600,
      minimumReviewedStandaloneCases: 400,
      minimumEvaluatedMembershipClaims: 299,
      minimumMembershipPrecision: 0.99,
      maximumFalseStandaloneRate: 0.005,
      maximumFalseStandaloneCases: 0,
      maximumFalsePositiveMembershipClaims: 0,
      minimumMembershipRecall: 0.85,
      minimumResolutionRate: 0.75,
    },
  }

  assert.equal(evaluateQualificationScore(score, policy).passed, true)

  const unsafe = structuredClone(score)
  unsafe.counts.falseStandaloneCases = 1
  unsafe.capability.falseStandaloneRate = 1 / 600
  const outcome = evaluateQualificationScore(unsafe, policy)
  assert.equal(outcome.passed, false)
  assert.ok(outcome.checks.some((check) => check.id === 'false_standalone_cases' && !check.passed))
})
