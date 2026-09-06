import assert from 'node:assert/strict'
import { test } from 'node:test'
import plan from '../data/authority-sample-plan.json' with { type: 'json' }
import policy from '../data/evaluation-policy.json' with { type: 'json' }
import {
  auditAuthoritySample,
  authorityCaseSelectionFrames,
  zeroEventMinimum,
} from '../src/authority-sample.mjs'
import { loadTrialCases } from '../src/cases.mjs'

const source = { kind: 'publisher', url: 'https://publisher.example/books/example' }
const membership = {
  series: 'Example Sequence',
  aliases: [],
  positions: [{ value: 1, orderType: 'publication' }],
}
const reviewedCase = (overrides = {}) => ({
  id: 'reviewed-example',
  title: 'Reviewed Example',
  authors: ['Ada Reader'],
  truth: {
    status: 'reviewed',
    standalone: false,
    memberships: [membership],
    sources: [source],
  },
  ...overrides,
})
const candidateCase = {
  id: 'candidate-example',
  title: 'Candidate Example',
  authors: ['Casey Reader'],
  truth: { status: 'candidate', standalone: null, memberships: [], sources: [] },
}
const smallPolicy = (overrides = {}) => ({
  hardGates: {
    minimumReviewedCases: 1,
    minimumReviewedPositiveCases: 1,
    minimumReviewedStandaloneCases: 0,
    ...overrides,
  },
})
const smallPlan = (strata = []) => ({
  schemaVersion: 1,
  selectionTarget: 1,
  recentPublicationYearFloor: 2021,
  authoritySourceKinds: ['author', 'author_post', 'publisher', 'publisher_catalog'],
  samplingSourceKinds: [
    'author',
    'author_post',
    'publisher',
    'publisher_catalog',
    'platform_award',
  ],
  strata,
})

test('reports the exact reviewed and sampling gaps in the current authority set', async () => {
  const audit = auditAuthoritySample(await loadTrialCases(), plan, policy)

  assert.equal(audit.valid, true)
  assert.equal(audit.ready, false)
  assert.deepEqual(audit.counts, {
    selected: 126,
    reviewed: 112,
    candidate: 14,
    reviewedPositive: 89,
    reviewedStandalone: 23,
    selectionTarget: 200,
    selectionGap: 74,
  })
  assert.deepEqual(Object.fromEntries(audit.targets.map((target) => [target.id, target.gap])), {
    reviewed_cases: 88,
    reviewed_positive_cases: 11,
    reviewed_standalone_cases: 27,
  })
  assert.deepEqual(audit.qualification.counts, {
    selected: 0,
    reviewed: 0,
    candidate: 0,
    reviewedPositive: 0,
    reviewedStandalone: 0,
  })
  assert.deepEqual(audit.qualification.zeroEventMinimums, {
    falseStandaloneCases: 598,
    evaluatedMembershipClaims: 299,
  })
  assert.deepEqual(audit.program, { reviewed: 112, target: 1200 })
  assert.deepEqual(
    audit.strata.find((stratum) => stratum.id === 'reverie_series'),
    {
      id: 'reverie_series',
      label: 'Reverie seeded series',
      minimumReviewed: 69,
      selected: 69,
      reviewed: 68,
      candidate: 1,
      gap: 1,
      met: false,
    },
  )

  assert.deepEqual(
    Object.fromEntries(
      audit.strata
        .filter(({ id }) =>
          [
            'recent_independent_or_kindle_first',
            'recent_traditional',
            'multi_series_or_connected_universe',
            'standalone_control',
          ].includes(id),
        )
        .map(({ id, reviewed, gap }) => [id, { reviewed, gap }]),
    ),
    {
      recent_independent_or_kindle_first: { reviewed: 27, gap: 23 },
      recent_traditional: { reviewed: 27, gap: 23 },
      multi_series_or_connected_universe: { reviewed: 15, gap: 5 },
      standalone_control: { reviewed: 27, gap: 23 },
    },
  )
})

test('keeps the complete 2021 Kindle Storyteller frame and direct authority truth', async () => {
  const caseSet = await loadTrialCases()
  const frame = caseSet.cases.filter(
    (testCase) => testCase.selectionFrame === 'kindle_storyteller_2021_shortlist',
  )
  const byId = new Map(frame.map((testCase) => [testCase.id, testCase]))

  assert.equal(frame.length, 5)
  assert.equal(
    frame.every((testCase) => testCase.truth.status === 'reviewed'),
    true,
  )
  assert.deepEqual(
    byId.get('kindle-storyteller-2021-escape-to-the-hummingbird-hotel')?.truth.memberships[0]
      ?.positions,
    [],
  )
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2021-stranger-at-the-villa')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [3],
  )
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2021-an-isolated-incident')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [11],
  )
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2021-the-corfe-castle-murders')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [1],
  )
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2021-a-thousand-li-the-second-sect')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [5],
  )
})

test('keeps the complete 2024 Kindle Storyteller frame and conservative authority truth', async () => {
  const caseSet = await loadTrialCases()
  const frame = caseSet.cases.filter(
    (testCase) => testCase.selectionFrame === 'kindle_storyteller_2024_shortlist',
  )
  const byId = new Map(frame.map((testCase) => [testCase.id, testCase]))

  assert.equal(frame.length, 5)
  assert.equal(byId.get('kindle-storyteller-2024-murmuration')?.truth.status, 'candidate')
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2024-stateside')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [5],
  )
  assert.deepEqual(
    byId
      .get('kindle-storyteller-2024-bitter-enemies')
      ?.truth.memberships[0]?.positions.map(({ value }) => value),
    [2],
  )
  assert.deepEqual(
    byId.get('kindle-storyteller-2024-hopes-and-dreams-on-foxglove-street')?.truth.memberships[0]
      ?.positions,
    [],
  )
  assert.deepEqual(
    byId.get('kindle-storyteller-2024-jennifer')?.truth.memberships[0]?.positions,
    [],
  )
})

test('keeps the complete Hachette horror frame without trusting its standalone heading', async () => {
  const caseSet = await loadTrialCases()
  const frame = caseSet.cases.filter((testCase) =>
    authorityCaseSelectionFrames(testCase).includes('hachette_standalone_sff_horror_2026_09_06'),
  )
  const byId = new Map(frame.map((testCase) => [testCase.id, testCase]))

  assert.equal(frame.length, 9)
  assert.equal(frame.filter((testCase) => testCase.truth.status === 'reviewed').length, 4)
  assert.equal(frame.filter((testCase) => testCase.truth.status === 'candidate').length, 5)

  const girlWithAllTheGifts = byId.get('hachette-standalone-sff-horror-the-girl-with-all-the-gifts')
  assert.equal(girlWithAllTheGifts?.truth.standalone, false)
  assert.equal(girlWithAllTheGifts?.truth.memberships[0]?.series, 'The Girl With All the Gifts')
  assert.deepEqual(girlWithAllTheGifts?.truth.memberships[0]?.positions, [])

  const reviewedStandalones = [
    'hachette-standalone-sff-horror-ghoster',
    'hachette-standalone-sff-horror-the-last-days-of-jack-sparks',
    'hachette-standalone-romantasy-a-dowry-of-blood',
  ]
  for (const id of reviewedStandalones) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.standalone, true)
    assert.deepEqual(testCase?.truth.memberships, [])
  }

  const dowry = byId.get('hachette-standalone-romantasy-a-dowry-of-blood')
  assert.deepEqual(dowry?.riskFeatures, ['connected_universe'])
  assert.equal(dowry?.truth.membershipsComplete, true)
})

test('derives exact zero-event sample minimums for the production rate bounds', () => {
  assert.equal(zeroEventMinimum(0.005, 0.95), 598)
  assert.equal(zeroEventMinimum(0.01, 0.95), 299)
  assert.throws(() => zeroEventMinimum(0, 0.95), RangeError)
  assert.throws(() => zeroEventMinimum(0.01, 1), RangeError)
})

test('keeps qualification cases isolated from development tuning gates', () => {
  const qualificationPolicy = {
    ...smallPolicy(),
    qualificationGates: {
      confidenceLevel: 0.95,
      minimumReviewedCases: 1,
      minimumReviewedPositiveCases: 1,
      minimumReviewedStandaloneCases: 598,
      minimumEvaluatedMembershipClaims: 299,
      minimumMembershipPrecision: 0.99,
      maximumFalseStandaloneRate: 0.005,
    },
  }
  const audit = auditAuthoritySample(
    {
      cases: [reviewedCase({ evaluationPartition: 'qualification' })],
      sharedSources: {},
    },
    smallPlan(),
    qualificationPolicy,
  )

  assert.equal(audit.valid, true)
  assert.equal(audit.ready, false)
  assert.equal(audit.counts.reviewed, 0)
  assert.equal(audit.qualification.counts.reviewed, 1)
  assert.equal(audit.qualification.counts.reviewedPositive, 1)
  assert.equal(audit.program.reviewed, 1)
})

test('records high-risk membership without inventing order and preserves ambiguous candidates', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))

  const reviewedMemberships = new Map([
    ['reverie-bloodline-vampires-court-of-the-vampire-queen', 'Bloodline Vampires'],
    ['reverie-bride-mate', 'Bride'],
    ['reverie-merciless-all-he-ll-ever-be', 'Merciless Series'],
    ['reverie-pucked-up-omegaverse-one-pucked-up-pack', 'Pucked Up Omegaverse'],
    ['reverie-wicked-games-enchantra', 'Wicked Games'],
  ])

  for (const [id, series] of reviewedMemberships) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.status, 'reviewed')
    assert.equal(testCase?.truth.standalone, false)
    assert.deepEqual(testCase?.truth.memberships[0]?.positions, [])
    assert.equal(testCase?.truth.memberships[0]?.series, series)
  }

  assert.equal(byId.get('reverie-dark-forces-bulletproof')?.truth.status, 'candidate')
  const sacrifice = byId.get('reverie-lords-the-sacrifice')
  assert.equal(sacrifice?.truth.status, 'reviewed')
  assert.equal(sacrifice?.truth.memberships[0]?.series, 'A Dark College Romance')
  assert.deepEqual(sacrifice?.truth.memberships[0]?.positions, [])

  const grey = byId.get('gold-grey')
  assert.equal(grey?.truth.membershipsComplete, true)
  assert.deepEqual(
    grey?.truth.memberships.map(({ series, role }) => [series, role]),
    [
      ['Fifty Shades as Told by Christian', 'primary'],
      ['Fifty Shades of Grey', 'secondary'],
    ],
  )
})

test('records exact first-party series numbers without mistaking readable standalones for non-membership', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const reviewedMemberships = new Map([
    ['reverie-gold-rush-ranch-off-to-the-races', ['Gold Rush Ranch', 1]],
    ['reverie-never-after-hooked', ['Never After', 1]],
    ['reverie-priest-priest', ['The Priest Collection', 1]],
    ['reverie-stay-a-spell-wolf-gone-wild', ['Stay A Spell', 1]],
    ['reverie-the-broken-blades-five-broken-blades', ['The Broken Blades', 1]],
  ])

  for (const [id, [series, position]] of reviewedMemberships) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.status, 'reviewed')
    assert.equal(testCase?.truth.standalone, false)
    assert.equal(testCase?.truth.memberships[0]?.series, series)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.value, position)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.orderType, 'publication')
  }
})

test('records independently confirmed series positions for the sixth Reverie seed batch', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const reviewedMemberships = new Map([
    ['reverie-beneath-the-mask-distance', ['Beneath the Mask', 1]],
    ['reverie-cruel-castaways-ruthless-rival', ['Cruel Castaways', 1]],
    ['reverie-flame-and-thorns-war-of-fire-and-fury', ['Flame and Thorns', 5]],
    ['reverie-hell-bent-my-demon-hunter', ['Hell Bent', 2]],
    ['reverie-into-darkness-game-on', ['Into Darkness', 3]],
  ])

  for (const [id, [series, position]] of reviewedMemberships) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.status, 'reviewed')
    assert.equal(testCase?.truth.standalone, false)
    assert.equal(testCase?.truth.memberships[0]?.series, series)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.value, position)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.orderType, 'publication')
    assert.ok(testCase?.truth.sources.length >= 2)
  }
})

test('corrects false standalones, connected-world noise, and the seventh batch seed position', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const reviewedMemberships = new Map([
    ['reverie-lucky-river-ranch-wyatt', ['Lucky River Ranch', 2]],
    ['reverie-lyonesse-honey-cut', ['Lyonesse', 2]],
    ['reverie-playing-for-keeps-fall-with-me', ['Playing for Keeps', 4]],
    ['reverie-rose-hill-wild-card', ['Rose Hill', 4]],
    ['reverie-sparrow-falls-secret-haven', ['Sparrow Falls', 6]],
  ])

  for (const [id, [series, position]] of reviewedMemberships) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.status, 'reviewed')
    assert.equal(testCase?.truth.standalone, false)
    assert.equal(testCase?.truth.memberships[0]?.series, series)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.value, position)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.orderType, 'publication')
    assert.ok(testCase?.truth.sources.length >= 2)
  }

  const honeyCut = byId.get('reverie-lyonesse-honey-cut')
  assert.equal(honeyCut?.truth.membershipsComplete, true)
  assert.equal(honeyCut?.truth.memberships.length, 1)
  assert.deepEqual(honeyCut?.riskFeatures, ['connected_universe'])
})

test('promotes the unambiguous seed candidates while preserving the ambiguous Dark Forces control', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))
  const reviewedMemberships = new Map([
    ['reverie-sinful-manor-keep-me', ['Sinful Manor', 1]],
    ['reverie-the-eye-of-the-goddess-a-tribute-of-fire', ['The Eye of the Goddess', 1]],
    ['reverie-the-wolves-of-ruin-dire-bound', ['The Wolves of Ruin', 1]],
  ])

  for (const [id, [series, position]] of reviewedMemberships) {
    const testCase = byId.get(id)
    assert.equal(testCase?.truth.status, 'reviewed')
    assert.equal(testCase?.truth.standalone, false)
    assert.equal(testCase?.truth.memberships[0]?.series, series)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.value, position)
    assert.equal(testCase?.truth.memberships[0]?.positions[0]?.orderType, 'publication')
    assert.ok(testCase?.truth.sources.length >= 2)
  }

  assert.equal(byId.get('reverie-sinful-manor-keep-me')?.publicationPath, 'traditional')
  assert.equal(
    byId.get('reverie-the-eye-of-the-goddess-a-tribute-of-fire')?.publicationPath,
    'traditional',
  )
  assert.equal(byId.get('reverie-the-wolves-of-ruin-dire-bound')?.publicationPath, 'independent')
  assert.equal(byId.get('reverie-dark-forces-bulletproof')?.truth.status, 'candidate')
  assert.equal(byId.get('reverie-lords-the-sacrifice')?.truth.status, 'reviewed')
})

test('promotes explicit external series evidence without inferring order or standalone status', async () => {
  const caseSet = await loadTrialCases()
  const byId = new Map(caseSet.cases.map((testCase) => [testCase.id, testCase]))

  const midsummer = byId.get('kindle-storyteller-2022-midsummer-house')
  assert.equal(midsummer?.truth.status, 'reviewed')
  assert.equal(midsummer?.truth.standalone, false)
  assert.equal(midsummer?.truth.memberships[0]?.series, 'Applemore Bay')
  assert.deepEqual(midsummer?.truth.memberships[0]?.positions, [
    { value: 3, orderType: 'publication' },
  ])
  assert.equal(midsummer?.truth.sources.length, 2)

  const pyg = byId.get('kindle-storyteller-2025-pyg')
  assert.equal(pyg?.truth.status, 'reviewed')
  assert.equal(pyg?.truth.standalone, false)
  assert.equal(pyg?.truth.membershipsComplete, true)
  assert.equal(pyg?.truth.memberships[0]?.series, 'The Leamington Bloom')
  assert.deepEqual(pyg?.truth.memberships[0]?.positions, [])
  assert.deepEqual(pyg?.riskFeatures, ['connected_universe'])

  for (const id of [
    'kindle-storyteller-2023-my-brothers-keeper',
    'kindle-storyteller-2023-a-midlife-gamble',
    'kindle-storyteller-2025-the-bed-in-the-shed',
    'hachette-standalone-romantasy-the-honey-witch',
    'hachette-standalone-romantasy-wild-and-wicked-things',
    'hachette-standalone-romantasy-the-carnivale-of-curiosities',
    'hachette-standalone-romantasy-the-princess-of-thornwood-drive',
  ]) {
    assert.equal(byId.get(id)?.truth.status, 'candidate')
  }
})

test('never counts an unreviewed candidate toward an authority gate', () => {
  const audit = auditAuthoritySample(
    { cases: [candidateCase], sharedSources: {} },
    smallPlan(),
    smallPolicy(),
  )

  assert.equal(audit.valid, true)
  assert.equal(audit.counts.selected, 1)
  assert.equal(audit.counts.reviewed, 0)
  assert.equal(audit.targets[0].gap, 1)
  assert.equal(audit.ready, false)
})

test('rejects reviewed truth without affirmative author or publisher evidence', () => {
  const standalone = reviewedCase({
    truth: { status: 'reviewed', standalone: true, memberships: [], sources: [] },
  })
  const audit = auditAuthoritySample(
    { cases: [standalone], sharedSources: {} },
    smallPlan(),
    smallPolicy({ minimumReviewedPositiveCases: 0, minimumReviewedStandaloneCases: 1 }),
  )

  assert.equal(audit.valid, false)
  assert.ok(audit.errors.some((error) => error.includes('authority source')))
})

test('accepts an explicitly shared publisher source for standalone controls', () => {
  const standalone = reviewedCase({
    stratum: 'standalone_negative',
    truth: { status: 'reviewed', standalone: true, memberships: [], sources: [] },
  })
  const audit = auditAuthoritySample(
    {
      cases: [standalone],
      sharedSources: { standalone_negative: [source] },
    },
    smallPlan([{ id: 'standalone_control', label: 'Standalone', minimumReviewed: 1 }]),
    smallPolicy({ minimumReviewedPositiveCases: 0, minimumReviewedStandaloneCases: 1 }),
  )

  assert.equal(audit.valid, true)
  assert.equal(audit.ready, true)
  assert.equal(audit.strata[0].reviewed, 1)
})

test('supports overlapping strata but requires their audit metadata', () => {
  const testCase = reviewedCase({
    publicationYear: 2025,
    publicationPath: 'independent',
    sampleSources: [source],
    riskFeatures: ['connected_universe'],
    strata: ['recent_independent_or_kindle_first', 'multi_series_or_connected_universe'],
    truth: {
      status: 'reviewed',
      standalone: false,
      memberships: [membership],
      membershipsComplete: true,
      sources: [source],
    },
  })
  const audit = auditAuthoritySample(
    { cases: [testCase], sharedSources: {} },
    smallPlan([
      { id: 'recent_independent_or_kindle_first', label: 'Independent', minimumReviewed: 1 },
      { id: 'multi_series_or_connected_universe', label: 'Complex', minimumReviewed: 1 },
    ]),
    smallPolicy(),
  )

  assert.equal(audit.valid, true)
  assert.equal(audit.ready, true)
  assert.deepEqual(
    audit.strata.map((stratum) => stratum.reviewed),
    [1, 1],
  )

  const incomplete = structuredClone(testCase)
  delete incomplete.truth.membershipsComplete
  const invalid = auditAuthoritySample(
    { cases: [incomplete], sharedSources: {} },
    smallPlan([
      { id: 'recent_independent_or_kindle_first', label: 'Independent', minimumReviewed: 1 },
      { id: 'multi_series_or_connected_universe', label: 'Complex', minimumReviewed: 1 },
    ]),
    smallPolicy(),
  )
  assert.ok(invalid.errors.some((error) => error.includes('membershipsComplete')))
})

test('keeps selection-frame provenance separate from truth authority', () => {
  const awardSource = {
    kind: 'platform_award',
    url: 'https://platform.example/complete-shortlist',
  }
  const testCase = reviewedCase({
    publicationYear: 2025,
    publicationPath: 'kindle_first',
    selectionFrame: 'complete-shortlist',
    sampleSources: [awardSource],
    strata: ['recent_independent_or_kindle_first'],
  })
  const samplePlan = {
    ...smallPlan([
      {
        id: 'recent_independent_or_kindle_first',
        label: 'Independent',
        minimumReviewed: 1,
      },
    ]),
    selectionFrames: [
      {
        id: 'complete-shortlist',
        expectedCases: 1,
        strata: ['recent_independent_or_kindle_first'],
        publicationYear: 2025,
        publicationPath: 'kindle_first',
        source: awardSource,
      },
    ],
  }
  const valid = auditAuthoritySample(
    { cases: [testCase], sharedSources: {} },
    samplePlan,
    smallPolicy(),
  )
  assert.equal(valid.valid, true)

  const platformTruth = structuredClone(testCase)
  platformTruth.truth.sources = [awardSource]
  const invalidTruth = auditAuthoritySample(
    { cases: [platformTruth], sharedSources: {} },
    samplePlan,
    smallPolicy(),
  )
  assert.ok(invalidTruth.errors.some((error) => error.includes('authority source')))

  const missingFinalist = auditAuthoritySample(
    { cases: [], sharedSources: {} },
    samplePlan,
    smallPolicy(),
  )
  assert.ok(missingFinalist.errors.some((error) => error.includes('requires 1 cases; found 0')))
})

test('supports a complete-list frame whose cases span publication years and paths', () => {
  const listSource = {
    kind: 'publisher',
    url: 'https://publisher.example/complete-list',
  }
  const standalone = reviewedCase({
    selectionFrame: 'complete-list',
    sampleSources: [listSource],
    truth: {
      status: 'reviewed',
      standalone: true,
      memberships: [],
      sources: [source],
    },
  })
  const samplePlan = {
    ...smallPlan([{ id: 'standalone_control', label: 'Standalone', minimumReviewed: 1 }]),
    selectionFrames: [
      {
        id: 'complete-list',
        expectedCases: 1,
        strata: ['standalone_control'],
        source: listSource,
      },
    ],
  }

  const audit = auditAuthoritySample(
    { cases: [standalone], sharedSources: {} },
    samplePlan,
    smallPolicy({ minimumReviewedPositiveCases: 0, minimumReviewedStandaloneCases: 1 }),
  )

  assert.equal(audit.valid, true)
  assert.equal(audit.ready, true)
})

test('requires recognized sampling provenance for a recent-publication stratum', () => {
  const testCase = reviewedCase({
    publicationYear: 2025,
    publicationPath: 'traditional',
    strata: ['recent_traditional'],
  })
  const samplePlan = smallPlan([
    { id: 'recent_traditional', label: 'Traditional', minimumReviewed: 1 },
  ])
  const invalid = auditAuthoritySample(
    { cases: [testCase], sharedSources: {} },
    samplePlan,
    smallPolicy(),
  )

  assert.ok(invalid.errors.some((error) => error.includes('sampling-provenance')))

  const valid = auditAuthoritySample(
    { cases: [{ ...testCase, sampleSources: [source] }], sharedSources: {} },
    samplePlan,
    smallPolicy(),
  )
  assert.equal(valid.valid, true)
})

test('rejects duplicate works even when their case ids differ', () => {
  const duplicate = reviewedCase({ id: 'different-id' })
  const audit = auditAuthoritySample(
    { cases: [reviewedCase(), duplicate], sharedSources: {} },
    { ...smallPlan(), selectionTarget: 2 },
    smallPolicy(),
  )

  assert.equal(audit.valid, false)
  assert.ok(audit.errors.some((error) => error.includes('duplicates work')))
})
