import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authorityAcquisitionCacheMaterial,
  authorityPolicyForCase,
  authorityPolicyForRetrievedSource,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  scoreAuthorityAcquisition,
  shouldRepairAuthorityAcquisition,
  validateAuthorityAcquisition,
} from '../src/authority/evidence.mjs'
import {
  acquireAuthorityEvidence,
  repairAuthorityEvidence,
  responseWebEvidence,
} from '../src/authority/openai.mjs'
import {
  discoveredAuthorityDomains,
  shouldSelectFocusedAuthoritySearch,
} from '../src/authority/focused-search.mjs'
import {
  AUTHORITY_ACQUISITION_PROMPT_VERSION,
  authorityAcquisitionInstructions,
} from '../src/authority/schema.mjs'

const publisherUrl = 'https://publisher.example/books/second-book'
const testCase = {
  id: 'book',
  title: 'Second Book',
  authors: ['Ada Reader'],
  publicationYear: 2025,
  truth: {
    status: 'reviewed',
    standalone: false,
    memberships: [
      {
        series: 'The Sequence',
        aliases: [],
        positions: [{ value: 2, orderType: 'publication' }],
      },
    ],
    sources: [{ kind: 'publisher', url: publisherUrl }],
  },
}
const seriesOutput = {
  caseId: 'book',
  identity: { matched: true, confidence: 'high', evidenceUrls: [publisherUrl] },
  classification: 'series',
  memberships: [
    {
      series: 'The Sequence',
      position: 2,
      role: 'primary',
      evidenceUrls: [publisherUrl],
    },
  ],
  authoritySources: [
    {
      url: publisherUrl,
      kind: 'publisher',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary: 'The publisher identifies the exact work as the second Sequence novel.',
    },
  ],
  uncertainties: [],
  note: 'Publisher evidence supplies identity, membership, and position.',
}

test('instructs the scout to distinguish direct numbered sequences from lone numerals', () => {
  assert.equal(AUTHORITY_ACQUISITION_PROMPT_VERSION, 'authority-acquisition-v14-observed-identity')
  assert.match(authorityAcquisitionInstructions, /directly compares the exact target/)
  assert.match(authorityAcquisitionInstructions, /lone numeral, a numbered edition/)
  assert.match(authorityAcquisitionInstructions, /establishes reading independence only/)
  assert.match(authorityAcquisitionInstructions, /attributed statements remain third-party/)
  assert.match(authorityAcquisitionInstructions, /Never\s+paraphrase away the attribution/)
  assert.match(
    authorityAcquisitionInstructions,
    /finding a first-party origin as a separate objective/,
  )
  assert.match(authorityAcquisitionInstructions, /Do not batch all fallback queries/)
  assert.match(authorityAcquisitionInstructions, /site:<discovered-host>/)
  assert.match(authorityAcquisitionInstructions, /same-origin follow-up takes priority/)
  assert.match(authorityAcquisitionInstructions, /do not spend another search/)
  assert.match(authorityAcquisitionInstructions, /Never guess, synthesize, or construct a URL/)
  assert.match(authorityAcquisitionInstructions, /Copy every proposed URL exactly/)
  assert.match(
    authorityAcquisitionInstructions,
    /bibliographic series label stated in the relationship itself/,
  )
  assert.match(authorityAcquisitionInstructions, /Do not\s+substitute a page, collection, box-set/)
  assert.match(authorityAcquisitionInstructions, /Preserve articles and named-form words/)
  assert.match(authorityAcquisitionInstructions, /source's complete series label exactly/)
})

test('repairs only the observed series-without-membership structural failure', () => {
  assert.equal(
    shouldRepairAuthorityAcquisition({
      valid: false,
      errors: ['series classification requires a membership'],
      policyViolations: [],
    }),
    true,
  )
  assert.equal(
    shouldRepairAuthorityAcquisition({
      valid: false,
      errors: ['identity evidence URL is not a grounded identity authority source'],
      policyViolations: [],
    }),
    false,
  )
  assert.equal(
    shouldRepairAuthorityAcquisition({
      valid: false,
      errors: ['series classification requires a membership'],
      policyViolations: ['membership 0 lacks classification-eligible authority evidence'],
    }),
    false,
  )
})

test('builds a truth-blind target with only identity hints', () => {
  const target = buildAuthorityTarget(testCase)

  assert.equal('truth' in target, false)
  assert.deepEqual(target, {
    schemaVersion: 1,
    caseId: 'book',
    target: {
      title: 'Second Book',
      authors: ['Ada Reader'],
      publicationYear: 2025,
    },
  })
  assert.deepEqual(authorityAcquisitionCacheMaterial(target).target.authors, ['ada reader'])
})

test('accepts only consulted authority URLs that support each proposed field', () => {
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), seriesOutput, [
    publisherUrl,
  ])

  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, true)
  assert.equal(validation.reviewOnly, true)
  assert.equal(validation.citedUrlCount, 3)
  assert.equal(validation.groundedUrlCount, 3)
})

test('keeps reviewed origin kind deterministic for retrieved evidence', () => {
  const modelRelabelled = structuredClone(seriesOutput)
  modelRelabelled.authoritySources[0].kind = 'author'
  const policy = authorityPolicyForRetrievedSource(
    {},
    {
      url: publisherUrl,
      sourceKind: 'publisher',
    },
  )

  const rawValidation = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    modelRelabelled,
    [publisherUrl],
    policy,
  )
  assert.equal(rawValidation.valid, false)
  assert.ok(rawValidation.errors.some((error) => error.includes('reviewed origin profile')))

  const cleaned = canonicalizeAuthorityAcquisition(modelRelabelled, [publisherUrl], policy)
  assert.equal(cleaned.authoritySources[0].kind, 'publisher')
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [publisherUrl], policy)
      .policySafe,
    true,
  )
})

test('rejects an authority URL the search response did not consult', () => {
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), seriesOutput, [
    'https://publisher.example/books/a-different-book',
  ])

  assert.equal(validation.valid, false)
  assert.equal(validation.policySafe, false)
  assert.ok(validation.errors.some((error) => error.includes('consulted-source manifest')))
})

test('canonicalizes citations to the declared source manifest without inventing support', () => {
  const noisy = structuredClone(seriesOutput)
  noisy.identity.evidenceUrls.push('https://publisher.example/about')
  noisy.memberships[0].evidenceUrls.push('https://publisher.example/bibliography')
  const canonical = canonicalizeAuthorityAcquisition(noisy)

  assert.deepEqual(canonical.identity.evidenceUrls, [publisherUrl])
  assert.deepEqual(canonical.memberships[0].evidenceUrls, [publisherUrl])
  assert.equal(canonical.memberships[0].position, 2)

  const noPosition = structuredClone(seriesOutput)
  noPosition.authoritySources[0].supports = ['identity', 'series_membership']
  assert.equal(canonicalizeAuthorityAcquisition(noPosition).memberships[0].position, null)

  const variantOnly = structuredClone(seriesOutput)
  variantOnly.identity.evidenceUrls = ['https://publisher.example/books/second-book?edition=2']
  assert.deepEqual(canonicalizeAuthorityAcquisition(variantOnly).identity.evidenceUrls, [
    publisherUrl,
  ])

  const discoveryOnly = {
    ...structuredClone(seriesOutput),
    classification: 'unresolved',
    memberships: [],
    authoritySources: [],
  }
  discoveryOnly.identity.evidenceUrls = []
  const unresolved = canonicalizeAuthorityAcquisition(discoveryOnly, [])
  assert.deepEqual(unresolved.identity, {
    matched: false,
    confidence: 'none',
    evidenceUrls: [],
  })
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), unresolved, []).valid,
    true,
  )
})

test('drops unconsulted redundant sources but never salvages an unsupported claim', () => {
  const inventedUrl = 'https://publisher.example/books/invented-deep-link'
  const redundant = structuredClone(seriesOutput)
  redundant.authoritySources.push({
    url: inventedUrl,
    kind: 'publisher',
    supports: ['identity'],
    evidenceSummary: 'A redundant identity page.',
  })
  redundant.identity.evidenceUrls.push(inventedUrl)

  const cleaned = canonicalizeAuthorityAcquisition(redundant, [publisherUrl])
  assert.deepEqual(
    cleaned.authoritySources.map((source) => source.url),
    [publisherUrl],
  )
  assert.deepEqual(cleaned.identity.evidenceUrls, [publisherUrl])
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [publisherUrl]).valid,
    true,
  )

  const unsupported = structuredClone(seriesOutput)
  unsupported.authoritySources[0].url = inventedUrl
  unsupported.identity.evidenceUrls = [inventedUrl]
  unsupported.memberships[0].evidenceUrls = [inventedUrl]
  const rejected = canonicalizeAuthorityAcquisition(unsupported, [publisherUrl])
  assert.equal(rejected.authoritySources.length, 0)
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), rejected, [publisherUrl]).valid,
    false,
  )
})

test('drops a demoted membership without discarding an independently supported claim', () => {
  const blockedUrl = 'https://publisher.example/books/conflicting-name'
  const mixed = structuredClone(seriesOutput)
  mixed.memberships.push({
    series: 'Conflicting Sequence',
    position: 2,
    role: 'unknown',
    evidenceUrls: [blockedUrl],
  })
  mixed.authoritySources.push({
    url: blockedUrl,
    kind: 'publisher',
    supports: ['identity', 'series_membership', 'position'],
    evidenceSummary: 'The selection-frame page proposes a conflicting series name.',
  })
  const policy = authorityPolicyForCase({ sampleSources: [{ url: blockedUrl }] })
  for (const source of mixed.authoritySources) {
    source.observedIdentity = {
      title: 'Second Book',
      authors: ['Ada Reader'],
      workKind: 'single_work',
    }
    source.originAssessment = 'claimed_first_party'
  }
  mixed.authoritySources[0].relationshipClaims = [
    { name: 'The Sequence', kind: 'book_series', position: 2 },
  ]
  mixed.authoritySources[1].relationshipClaims = [
    { name: 'Conflicting Sequence', kind: 'book_series', position: 2 },
  ]

  const cleaned = canonicalizeAuthorityAcquisition(mixed, [publisherUrl, blockedUrl], policy)
  const validation = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    cleaned,
    [publisherUrl, blockedUrl],
    policy,
  )

  assert.deepEqual(
    cleaned.memberships.map((membership) => membership.series),
    ['The Sequence'],
  )
  assert.deepEqual(cleaned.authoritySources[1].supports, ['identity'])
  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, true)
})

test('keeps an originally unsupported membership visible to validation', () => {
  const unsupported = structuredClone(seriesOutput)
  unsupported.memberships[0].evidenceUrls = []

  const cleaned = canonicalizeAuthorityAcquisition(unsupported, [publisherUrl])
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [
    publisherUrl,
  ])

  assert.equal(cleaned.memberships.length, 1)
  assert.equal(validation.valid, false)
  assert.ok(validation.errors.includes('membership 0 requires authority evidence'))
})

test('leaves malformed source entries for validation instead of throwing during cleanup', () => {
  const malformed = structuredClone(seriesOutput)
  malformed.authoritySources.push(null, { url: 'https://publisher.example/books/no-supports' })

  const cleaned = canonicalizeAuthorityAcquisition(malformed)
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [
    publisherUrl,
  ])

  assert.equal(validation.valid, false)
  assert.ok(validation.errors.includes('authority source 1 must be an object'))
})

test('requires affirmative authority evidence before calling a work standalone', () => {
  const output = {
    ...structuredClone(seriesOutput),
    classification: 'standalone',
    memberships: [],
  }
  output.authoritySources[0].supports = ['identity']
  output.identity.evidenceUrls = [publisherUrl]

  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    publisherUrl,
  ])

  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, false)
  assert.ok(validation.policyViolations.some((error) => error.includes('affirmative authority')))
})

test('does not let an irrelevant reading-independence tag quarantine a series claim', () => {
  const output = structuredClone(seriesOutput)
  output.authoritySources[0].supports.push('standalone')
  output.authoritySources[0].evidenceSummary =
    'The publisher identifies the series and says the volume is independently readable.'

  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    publisherUrl,
  ])

  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, true)
})

test('does not accept reading-independence language as standalone classification evidence', () => {
  const output = structuredClone(seriesOutput)
  output.classification = 'standalone'
  output.memberships = []
  output.authoritySources[0].supports = ['identity', 'standalone']
  output.authoritySources[0].evidenceSummary =
    'The author identifies the exact prequel and says it works as a standalone title.'

  const directValidation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    publisherUrl,
  ])
  assert.equal(directValidation.valid, true)
  assert.equal(directValidation.policySafe, false)
  assert.ok(
    directValidation.policyViolations.some((error) =>
      error.includes('reading_independence_not_classification'),
    ),
  )

  const cleaned = canonicalizeAuthorityAcquisition(output, [publisherUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  const cleanedValidation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [
    publisherUrl,
  ])
  assert.equal(cleanedValidation.valid, true)
  assert.equal(cleanedValidation.policySafe, false)
  assert.ok(
    cleanedValidation.policyViolations.some((error) => error.includes('affirmative authority')),
  )
})

test('does not launder attributed praise on a first-party page into classification evidence', () => {
  const standalone = structuredClone(seriesOutput)
  standalone.classification = 'standalone'
  standalone.memberships = []
  standalone.authoritySources[0].supports = ['identity', 'standalone']
  standalone.authoritySources[0].evidenceSummary =
    'The publisher product page quotes a review calling the exact work a standalone fantasy novel.'

  const rawValidation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), standalone, [
    publisherUrl,
  ])
  assert.equal(rawValidation.valid, true)
  assert.equal(rawValidation.policySafe, false)
  assert.ok(
    rawValidation.policyViolations.some((error) => error.includes('third_party_attribution')),
  )

  const cleaned = canonicalizeAuthorityAcquisition(standalone, [publisherUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [publisherUrl])
      .policySafe,
    false,
  )

  const membership = structuredClone(seriesOutput)
  membership.authoritySources[0].evidenceSummary =
    'The publisher product page quotes a review calling the exact work the second Sequence novel.'

  const rawMembershipValidation = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    membership,
    [publisherUrl],
  )
  assert.equal(rawMembershipValidation.valid, true)
  assert.equal(rawMembershipValidation.policySafe, false)
  assert.ok(
    rawMembershipValidation.policyViolations.some((error) =>
      error.includes('third_party_attribution'),
    ),
  )

  const cleanedMembership = canonicalizeAuthorityAcquisition(membership, [publisherUrl])
  assert.deepEqual(cleanedMembership.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleanedMembership.memberships, [])
})

test('keeps selection frames and known marketing taxonomies out of truth evidence', () => {
  const output = structuredClone(seriesOutput)
  output.classification = 'standalone'
  output.memberships = []
  output.authoritySources[0].supports = ['identity', 'standalone']
  output.authoritySources[0].evidenceSummary = 'The list calls this a standalone novel.'
  output.authoritySources[0].relationshipClaims = []
  output.authoritySources[0].observedIdentity = {
    title: 'Second Book',
    authors: ['Ada Reader'],
    workKind: 'single_work',
  }
  output.authoritySources[0].originAssessment = 'claimed_first_party'
  const policy = authorityPolicyForCase({ sampleSources: [{ url: publisherUrl }] })

  const selectionOnly = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    output,
    [publisherUrl],
    policy,
  )
  assert.equal(selectionOnly.valid, true)
  assert.equal(selectionOnly.policySafe, false)
  assert.ok(selectionOnly.policyViolations.some((error) => error.includes('selection provenance')))

  const hachette = structuredClone(output)
  const hachetteUrl = 'https://www.hachettebookgroup.com/book-list/best-books-for-romantasy-fans/'
  hachette.identity.evidenceUrls = [hachetteUrl]
  hachette.authoritySources[0].url = hachetteUrl
  const marketing = validateAuthorityAcquisition(buildAuthorityTarget(testCase), hachette, [
    hachetteUrl,
  ])
  assert.equal(marketing.valid, true)
  assert.equal(marketing.policySafe, false)
  assert.ok(
    marketing.policyViolations.some((error) => error.includes('known_marketing_taxonomy_conflict')),
  )

  const linkHub = structuredClone(output)
  const linkHubUrl = 'https://linktr.ee/example-author'
  linkHub.identity.evidenceUrls = [linkHubUrl]
  linkHub.authoritySources[0].url = linkHubUrl
  const discoveryOnly = validateAuthorityAcquisition(buildAuthorityTarget(testCase), linkHub, [
    linkHubUrl,
  ])
  assert.equal(discoveryOnly.valid, true)
  assert.equal(discoveryOnly.policySafe, false)
  assert.ok(
    discoveryOnly.policyViolations.some((error) => error.includes('known_discovery_only_host')),
  )

  const associationProfile = structuredClone(seriesOutput)
  const associationUrl = 'https://thecwa.co.uk/find-an-author/example-author/'
  associationProfile.identity.evidenceUrls = [associationUrl]
  associationProfile.memberships[0].evidenceUrls = [associationUrl]
  associationProfile.authoritySources[0].url = associationUrl
  associationProfile.authoritySources[0].kind = 'author'
  const associationValidation = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    associationProfile,
    [associationUrl],
  )
  assert.equal(associationValidation.valid, true)
  assert.equal(associationValidation.policySafe, false)
  assert.ok(
    associationValidation.policyViolations.some((error) =>
      error.includes('known_discovery_only_host'),
    ),
  )
  const cleanedAssociation = canonicalizeAuthorityAcquisition(associationProfile, [associationUrl])
  assert.deepEqual(cleanedAssociation.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleanedAssociation.memberships, [])
})

test('keeps unverified hosted author profiles out of classification evidence', () => {
  const profileUrl = 'https://mybookcave.com/profile/ada-reader/'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [profileUrl]
  output.memberships[0].evidenceUrls = [profileUrl]
  output.authoritySources = [
    {
      url: profileUrl,
      kind: 'author',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary: 'The hosted profile calls the exact title Sequence book two.',
    },
  ]

  const raw = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [profileUrl])
  assert.equal(raw.valid, true)
  assert.equal(raw.policySafe, false)
  assert.ok(raw.policyViolations.some((error) => error.includes('known_discovery_only_host')))

  const cleaned = canonicalizeAuthorityAcquisition(output, [profileUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships, [])
})

test('quarantines the known Violet Wars catalog relationship conflict', () => {
  const catalogUrl = 'https://www.hachettebookgroup.com/titles/rich-larson/ymir/9780316416573/'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [catalogUrl]
  output.memberships[0].series = 'The Violet Wars'
  output.memberships[0].position = null
  output.memberships[0].evidenceUrls = [catalogUrl]
  output.authoritySources = [
    {
      url: catalogUrl,
      kind: 'publisher',
      supports: ['identity', 'series_membership'],
      evidenceSummary:
        'Hachette identifies Ymir by Rich Larson and lists its series as The Violet Wars.',
    },
  ]

  const raw = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [catalogUrl])
  assert.equal(raw.valid, true)
  assert.equal(raw.policySafe, false)
  assert.ok(
    raw.policyViolations.some((error) => error.includes('known_catalog_relationship_conflict')),
  )

  const cleaned = canonicalizeAuthorityAcquisition(output, [catalogUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships, [])
})

test('quarantines untranslated series labels for an original-language target', () => {
  const translatedUrl = 'https://publisher.example/translated/second-book'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [translatedUrl]
  output.memberships[0].series = 'Sekvence'
  output.memberships[0].position = null
  output.memberships[0].evidenceUrls = [translatedUrl]
  output.authoritySources = [
    {
      url: translatedUrl,
      kind: 'publisher_catalog',
      supports: ['identity', 'series_membership'],
      evidenceSummary:
        'The catalog matches the original title and places the translated work in the named series Sekvence.',
    },
  ]

  const raw = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [translatedUrl])
  assert.equal(raw.valid, true)
  assert.equal(raw.policySafe, false)
  assert.ok(raw.policyViolations.some((error) => error.includes('unmapped_localized_taxonomy')))

  const cleaned = canonicalizeAuthorityAcquisition(output, [translatedUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships, [])
})

test('quarantines a storefront title that inverts the work and relationship names', () => {
  const storefrontUrl = 'https://publisher.example/products/first-installment'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [storefrontUrl]
  output.memberships[0].series = 'Second Book'
  output.memberships[0].position = 1
  output.memberships[0].evidenceUrls = [storefrontUrl]
  output.authoritySources = [
    {
      url: storefrontUrl,
      kind: 'publisher',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary:
        'The publisher identifies the exact work as First Installment: Second Book #1.',
    },
  ]

  const raw = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [storefrontUrl])
  assert.equal(raw.valid, true)
  assert.equal(raw.policySafe, false)
  assert.ok(raw.policyViolations.some((error) => error.includes('title_relationship_ambiguity')))

  const cleaned = canonicalizeAuthorityAcquisition(output, [storefrontUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships, [])
})

test('blocks only the actual selection-frame URL when a sample plan is available', () => {
  const frameUrl = 'https://awards.example/shortlist'
  const authorUrl = 'https://author.example/books/exact-work'
  const policy = authorityPolicyForCase(
    {
      selectionFrame: 'award-frame',
      sampleSources: [
        { kind: 'platform_award', url: frameUrl },
        { kind: 'author', url: authorUrl },
      ],
    },
    {
      selectionFrames: [{ id: 'award-frame', source: { kind: 'platform_award', url: frameUrl } }],
    },
  )

  assert.deepEqual(policy.classificationBlockedUrls, [frameUrl])
})

test('quarantines revisions of a known-conflicting author catalog without blocking exact pages', () => {
  const catalogUrls = [
    'https://www.kierstenmodglinauthor.com/uploads/5/7/1/7/57171133/new_3_25_kiersten_modglin_booklist.pdf',
    'https://www.kierstenmodglinauthor.com/uploads/5/7/1/7/57171133/new_3_25_kiersten_modglin_reading_age_guide.pdf',
    'https://static1.squarespace.com/static/690cdade4570e05ae301c1a5/t/69f42aeba18c541ebe4fff12/1777609451082/53%2BKIERSTEN%2BMODGLIN%2BBOOKLIST.pdf',
    'https://www.kierstenmodglinauthor.com/books',
  ]

  for (const catalogUrl of catalogUrls) {
    const output = structuredClone(seriesOutput)
    output.classification = 'standalone'
    output.memberships = []
    output.identity.evidenceUrls = [catalogUrl]
    output.authoritySources = [
      {
        url: catalogUrl,
        kind: 'author',
        supports: ['identity', 'standalone'],
        evidenceSummary: 'The author catalog places the title under Standalones.',
      },
    ]

    const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
      catalogUrl,
    ])
    assert.equal(validation.valid, true)
    assert.equal(validation.policySafe, false)
    assert.ok(
      validation.policyViolations.some((error) =>
        error.includes('known_author_catalog_taxonomy_conflict'),
      ),
    )

    const cleaned = canonicalizeAuthorityAcquisition(output, [catalogUrl])
    assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  }

  const exactUrl = 'https://www.kierstenmodglinauthor.com/thenannyssecret'
  const exactPage = structuredClone(seriesOutput)
  exactPage.identity.evidenceUrls = [exactUrl]
  exactPage.memberships[0].series = 'Locke Industries Series'
  exactPage.memberships[0].position = null
  exactPage.memberships[0].evidenceUrls = [exactUrl]
  exactPage.authoritySources = [
    {
      url: exactUrl,
      kind: 'author',
      supports: ['identity', 'series_membership'],
      evidenceSummary:
        "The author identifies The Nanny's Secret as an installment of the Locke Industries Series.",
    },
  ]

  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), exactPage, [exactUrl]).policySafe,
    true,
  )
})

test('demotes blocked sources to identity without withholding independent membership evidence', () => {
  const authorUrl = 'https://author.example/books/second-book'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls.push(authorUrl)
  output.memberships[0].evidenceUrls.push(authorUrl)
  output.authoritySources.push({
    url: authorUrl,
    kind: 'author',
    supports: ['identity', 'series_membership', 'position'],
    evidenceSummary: 'The author identifies the exact work as Sequence book two.',
  })
  const policy = authorityPolicyForCase({ sampleSources: [{ url: publisherUrl }] })
  const cleaned = canonicalizeAuthorityAcquisition(output, [publisherUrl, authorUrl], policy)
  for (const source of cleaned.authoritySources) {
    source.observedIdentity = {
      title: 'Second Book',
      authors: ['Ada Reader'],
      workKind: 'single_work',
    }
    source.originAssessment = 'claimed_first_party'
    source.relationshipClaims = [{ name: 'The Sequence', kind: 'book_series', position: 2 }]
  }

  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships[0].evidenceUrls, [authorUrl])
  const validation = validateAuthorityAcquisition(
    buildAuthorityTarget(testCase),
    cleaned,
    [publisherUrl, authorUrl],
    policy,
  )
  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, true)
})

test('quarantines series claims inferred only from a spin-off relationship', () => {
  const authorUrl = 'https://author.example/'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [authorUrl]
  output.memberships[0].series = 'The Leamington Bloom Series'
  output.memberships[0].position = null
  output.memberships[0].evidenceUrls = [authorUrl]
  output.authoritySources = [
    {
      url: authorUrl,
      kind: 'author',
      supports: ['identity', 'series_membership'],
      evidenceSummary:
        'The author identifies Pyg and says Chameleon is a spin-off from Pyg while linking The Leamington Bloom Series.',
    },
  ]

  const rawValidation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    authorUrl,
  ])
  assert.equal(rawValidation.valid, true)
  assert.equal(rawValidation.policySafe, false)
  assert.ok(
    rawValidation.policyViolations.some((error) =>
      error.includes('indirect_relationship_inference'),
    ),
  )

  const cleaned = canonicalizeAuthorityAcquisition(output, [authorUrl])
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
  assert.deepEqual(cleaned.memberships, [])
  assert.equal(
    validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [authorUrl]).valid,
    false,
  )
})

test('keeps membership when independent direct evidence survives a risky context source', () => {
  const authorUrl = 'https://author.example/spin-off'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls.push(authorUrl)
  output.memberships[0].evidenceUrls.push(authorUrl)
  output.authoritySources.push({
    url: authorUrl,
    kind: 'author',
    supports: ['identity', 'series_membership', 'position'],
    evidenceSummary:
      'The author identifies the exact work and describes a companion spin-off in the same setting.',
  })

  const cleaned = canonicalizeAuthorityAcquisition(output, [publisherUrl, authorUrl])
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), cleaned, [
    publisherUrl,
    authorUrl,
  ])

  assert.deepEqual(cleaned.authoritySources[1].supports, ['identity'])
  assert.deepEqual(cleaned.memberships[0].evidenceUrls, [publisherUrl])
  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, true)
})

test('quarantines an unlabelled trigger-warning heading as series evidence', () => {
  const authorUrl = 'https://author.example/triggers/second-book'
  const output = structuredClone(seriesOutput)
  output.identity.evidenceUrls = [authorUrl]
  output.memberships[0].series = 'A Dark College Romance'
  output.memberships[0].position = null
  output.memberships[0].evidenceUrls = [authorUrl]
  output.authoritySources = [
    {
      url: authorUrl,
      kind: 'author',
      supports: ['identity', 'series_membership'],
      evidenceSummary:
        'The author trigger-warning page places the exact work under A Dark College Romance alongside related titles.',
    },
  ]

  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    authorUrl,
  ])
  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, false)
  assert.ok(
    validation.policyViolations.some((error) => error.includes('non_bibliographic_taxonomy')),
  )
})

test('quarantines a self-titled publisher grouping without exact-work membership corroboration', () => {
  const catalogUrl = 'https://publisher.example/series/only-book'
  const selfTitled = structuredClone(seriesOutput)
  selfTitled.memberships[0].series = 'Second Book Series'
  selfTitled.memberships[0].position = null
  selfTitled.memberships[0].evidenceUrls = [catalogUrl]
  selfTitled.authoritySources[0].supports = ['identity']
  selfTitled.authoritySources.push({
    url: catalogUrl,
    kind: 'publisher_catalog',
    supports: ['series_membership'],
    evidenceSummary: 'The publisher catalog groups the exact work under a self-titled series.',
  })

  const quarantined = validateAuthorityAcquisition(buildAuthorityTarget(testCase), selfTitled, [
    publisherUrl,
    catalogUrl,
  ])
  assert.equal(quarantined.valid, true)
  assert.equal(quarantined.policySafe, false)
  assert.ok(quarantined.policyViolations.some((error) => error.includes('self-titled series')))

  selfTitled.memberships[0].evidenceUrls.push(publisherUrl)
  selfTitled.authoritySources[0].supports.push('series_membership')
  const corroborated = validateAuthorityAcquisition(buildAuthorityTarget(testCase), selfTitled, [
    publisherUrl,
    catalogUrl,
  ])
  assert.equal(corroborated.valid, true)
  assert.equal(corroborated.policySafe, true)
})

test('sends a bounded, stateless web-search request and captures all consulted URLs', async () => {
  const target = buildAuthorityTarget(testCase)
  let requestBody
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(
      JSON.stringify({
        id: 'response-1',
        model: 'test-model',
        output: [
          {
            type: 'web_search_call',
            action: {
              type: 'search',
              queries: ['"Second Book" "Ada Reader" official'],
              sources: [
                { type: 'url', url: publisherUrl },
                { type: 'url', url: 'https://discovery.example/result' },
              ],
            },
          },
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(seriesOutput),
                annotations: [{ type: 'url_citation', url: publisherUrl, title: 'Second Book' }],
              },
            ],
          },
        ],
        usage: { input_tokens: 200, output_tokens: 80 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const result = await acquireAuthorityEvidence(target, {
    apiKey: 'test-key',
    model: 'test-model',
    maxToolCalls: 99,
    searchContextSize: 'high',
    fetchImpl,
  })

  assert.equal(requestBody.store, false)
  assert.deepEqual(requestBody.tools, [
    {
      type: 'web_search',
      external_web_access: true,
      search_context_size: 'high',
    },
  ])
  assert.equal(requestBody.tool_choice, 'required')
  assert.equal(requestBody.max_tool_calls, 6)
  assert.deepEqual(requestBody.include, ['web_search_call.action.sources'])
  assert.equal(requestBody.text.format.type, 'json_schema')
  assert.equal(requestBody.text.format.strict, true)
  assert.match(requestBody.instructions, /Never return a series classification with an empty/)
  assert.match(
    requestBody.text.format.schema.properties.memberships.description,
    /Must be non-empty when classification is series/,
  )
  assert.equal(requestBody.input.includes('"truth"'), false)
  assert.deepEqual(result.consultedUrls, [publisherUrl, 'https://discovery.example/result'])
  assert.deepEqual(result.searchedQueries, ['"Second Book" "Ada Reader" official'])
  assert.equal(result.webSearchCalls, 1)
  assert.deepEqual(result.output, seriesOutput)
})

test('marks only transient API failures as resumable infrastructure errors', async () => {
  const target = buildAuthorityTarget(testCase)
  const rejectedWith = async (fetchImpl) => {
    try {
      await acquireAuthorityEvidence(target, {
        apiKey: 'test-key',
        fetchImpl,
      })
      assert.fail('expected authority acquisition to reject')
    } catch (error) {
      return error
    }
  }
  const transient = await rejectedWith(async () => new Response('unavailable', { status: 503 }))
  assert.equal(transient.infrastructureFailure, true)
  assert.equal(transient.httpStatus, 503)

  const invalid = await rejectedWith(async () => new Response('bad request', { status: 400 }))
  assert.equal(invalid.infrastructureFailure, false)
  assert.equal(invalid.httpStatus, 400)

  const network = await rejectedWith(async () => {
    throw new TypeError('fetch failed')
  })
  assert.equal(network.infrastructureFailure, true)
})

test('captures and deduplicates scalar and batched search-query telemetry', () => {
  const evidence = responseWebEvidence({
    output: [
      { type: 'web_search_call', action: { query: 'exact title official', sources: [] } },
      {
        type: 'web_search_call',
        action: {
          queries: ['exact title official', 'site:author.example exact title'],
          sources: [],
        },
      },
    ],
  })

  assert.deepEqual(evidence.searchedQueries, [
    'exact title official',
    'site:author.example exact title',
  ])
  assert.equal(evidence.webSearchCalls, 2)
})

test('focuses only on grounded authority origins and excludes discovery-only hosts', () => {
  const firstPass = {
    status: 'completed',
    consultedUrls: [publisherUrl, 'https://thecwa.co.uk/member/ada-reader'],
    output: {
      classification: 'unresolved',
      authoritySources: [
        { url: publisherUrl, supports: ['identity'] },
        { url: 'https://thecwa.co.uk/member/ada-reader', supports: ['identity'] },
      ],
    },
    validation: { valid: true, policySafe: true },
  }

  assert.deepEqual(discoveredAuthorityDomains(firstPass), ['publisher.example'])
  assert.equal(
    shouldSelectFocusedAuthoritySearch(firstPass, {
      status: 'completed',
      output: seriesOutput,
      validation: { valid: true, policySafe: true },
    }),
    true,
  )
})

test('does not focus on discovery-only subdomains or a resolved safe first pass', () => {
  const unresolved = {
    status: 'completed',
    consultedUrls: ['https://books.google.com/books?id=example', publisherUrl],
    output: {
      classification: 'unresolved',
      authoritySources: [
        { url: 'https://books.google.com/books?id=example', supports: ['identity'] },
        { url: publisherUrl, supports: ['identity'] },
      ],
    },
    validation: { valid: true, policySafe: true },
  }
  const resolved = {
    ...unresolved,
    output: { ...unresolved.output, classification: 'series' },
  }

  assert.deepEqual(discoveredAuthorityDomains(unresolved), ['publisher.example'])
  assert.deepEqual(discoveredAuthorityDomains(resolved), [])
})

test('applies allowed-domain filters only to an explicitly focused search', async () => {
  const target = buildAuthorityTarget(testCase)
  let requestBody
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(
      JSON.stringify({
        id: 'response-focused',
        model: 'test-model',
        output: [
          {
            type: 'message',
            content: [{ type: 'output_text', text: JSON.stringify(seriesOutput), annotations: [] }],
          },
        ],
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  await acquireAuthorityEvidence(target, {
    apiKey: 'test-key',
    model: 'test-model',
    allowedDomains: ['publisher.example'],
    searchStrategy: 'discovered-origin-focus',
    fetchImpl,
  })

  assert.deepEqual(requestBody.tools[0].filters, { allowed_domains: ['publisher.example'] })
  assert.equal(requestBody.metadata.search_strategy, 'discovered-origin-focus')
})

test('uses a bounded no-tools call to repair structural output', async () => {
  const target = buildAuthorityTarget(testCase)
  let requestBody
  const fetchImpl = async (_url, options) => {
    requestBody = JSON.parse(options.body)
    return new Response(
      JSON.stringify({
        id: 'repair-1',
        model: 'test-model',
        output: [
          {
            type: 'message',
            content: [
              {
                type: 'output_text',
                text: JSON.stringify(seriesOutput),
                annotations: [],
              },
            ],
          },
        ],
        usage: { input_tokens: 40, output_tokens: 20 },
      }),
      { status: 200, headers: { 'Content-Type': 'application/json' } },
    )
  }

  const result = await repairAuthorityEvidence(
    target,
    { ...seriesOutput, memberships: [] },
    ['series classification requires a membership'],
    { apiKey: 'test-key', model: 'test-model', fetchImpl },
  )

  assert.equal('tools' in requestBody, false)
  assert.equal(requestBody.store, false)
  assert.equal(requestBody.max_output_tokens, 1000)
  assert.match(requestBody.instructions, /Do not search the web/)
  assert.match(requestBody.input, /series classification requires a membership/)
  assert.deepEqual(result.output, seriesOutput)
})

test('scores abstention, series precision, and dangerous errors separately', () => {
  const standaloneCase = {
    id: 'standalone',
    title: 'Only Book',
    authors: ['Bea Writer'],
    truth: { status: 'reviewed', standalone: true, memberships: [], sources: [] },
  }
  const unresolved = {
    caseId: 'standalone',
    status: 'completed',
    cached: false,
    webSearchCalls: 1,
    usage: { input_tokens: 100, output_tokens: 20 },
    output: {
      caseId: 'standalone',
      identity: { matched: false, confidence: 'none', evidenceUrls: [] },
      classification: 'unresolved',
      memberships: [],
      authoritySources: [],
      uncertainties: ['No qualifying first-party page found.'],
      note: 'Unresolved.',
    },
  }
  unresolved.validation = validateAuthorityAcquisition(
    buildAuthorityTarget(standaloneCase),
    unresolved.output,
    [],
  )
  const accepted = {
    caseId: 'book',
    status: 'completed',
    cached: false,
    webSearchCalls: 2,
    usage: { input_tokens: 200, output_tokens: 80 },
    modelCallCount: 2,
    repair: { output: seriesOutput, usage: { input_tokens: 40, output_tokens: 20 } },
    output: seriesOutput,
  }
  accepted.validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), seriesOutput, [
    publisherUrl,
  ])

  const score = scoreAuthorityAcquisition(
    { cases: [testCase, standaloneCase] },
    [accepted, unresolved],
    'test-model',
  )

  assert.equal(score.capability.validResponseRate, 1)
  assert.equal(score.capability.policySafeResponseRate, 1)
  assert.equal(score.capability.resolutionRate, 0.5)
  assert.equal(score.capability.resolvedAccuracy, 1)
  assert.equal(score.capability.effectiveAccuracy, 0.5)
  assert.equal(score.capability.membershipPrecision, 1)
  assert.equal(score.capability.membershipRecall, 1)
  assert.equal(score.capability.falseStandaloneRate, 0)
  assert.equal(score.capability.falseSeriesRate, 0)
  assert.equal(score.operations.webSearchCalls, 3)
  assert.equal(score.operations.inputTokens, 300)
  assert.equal(score.operations.modelCalls, 3)
  assert.equal(score.operations.repairCalls, 1)
  assert.equal(score.operations.repairInputTokens, 40)
  assert.equal(score.operations.repairOutputTokens, 20)
})

test('treats a generic publisher series suffix as naming drift, not a false membership', () => {
  const output = structuredClone(seriesOutput)
  output.memberships[0].series = 'The Sequence crime series'
  const result = {
    caseId: 'book',
    status: 'completed',
    cached: false,
    webSearchCalls: 1,
    usage: {},
    output,
    validation: validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
      publisherUrl,
    ]),
  }

  const score = scoreAuthorityAcquisition({ cases: [testCase] }, [result], 'test-model')

  assert.equal(score.capability.membershipPrecision, 1)
  assert.equal(score.capability.membershipRecall, 1)

  const crimeFiction = structuredClone(seriesOutput)
  crimeFiction.memberships[0].series = 'The Sequence crime fiction series'
  const crimeFictionResult = {
    ...result,
    output: crimeFiction,
    validation: validateAuthorityAcquisition(buildAuthorityTarget(testCase), crimeFiction, [
      publisherUrl,
    ]),
  }
  const crimeFictionScore = scoreAuthorityAcquisition(
    { cases: [testCase] },
    [crimeFictionResult],
    'test-model',
  )
  assert.equal(crimeFictionScore.capability.membershipPrecision, 1)
  assert.equal(crimeFictionScore.capability.membershipRecall, 1)

  const leadingArticle = structuredClone(seriesOutput)
  leadingArticle.memberships[0].series = 'The Sequence'
  const leadingArticleScore = scoreAuthorityAcquisition(
    {
      cases: [{ ...testCase, truth: { ...testCase.truth, memberships: [{ series: 'Sequence' }] } }],
    },
    [
      {
        ...result,
        output: leadingArticle,
        validation: validateAuthorityAcquisition(buildAuthorityTarget(testCase), leadingArticle, [
          publisherUrl,
        ]),
      },
    ],
    'test-model',
  )
  assert.equal(leadingArticleScore.capability.membershipPrecision, 1)
  assert.equal(leadingArticleScore.capability.membershipRecall, 1)
})

test('quarantines a generic form that does not name a bibliographic series', () => {
  const output = structuredClone(seriesOutput)
  output.memberships[0].series = 'duology'
  const validation = validateAuthorityAcquisition(buildAuthorityTarget(testCase), output, [
    publisherUrl,
  ])

  assert.equal(validation.valid, true)
  assert.equal(validation.policySafe, false)
  assert.match(validation.policyViolations.join('\n'), /generic form instead of a named/)

  const score = scoreAuthorityAcquisition(
    {
      cases: [
        {
          ...testCase,
          truth: {
            ...testCase.truth,
            memberships: [{ ...testCase.truth.memberships[0], series: 'Named Duology' }],
          },
        },
      ],
    },
    [
      {
        caseId: 'book',
        status: 'completed',
        cached: false,
        billing: {},
        output,
        validation,
      },
    ],
    'test-model',
  )
  assert.equal(score.capability.resolutionRate, 0)
  assert.equal(score.capability.membershipPrecision, null)
})

test('separates usable candidate proposals from unresolved and quarantined output', () => {
  const candidate = { ...testCase, truth: { status: 'candidate', memberships: [], sources: [] } }
  const result = {
    caseId: 'book',
    status: 'completed',
    cached: false,
    webSearchCalls: 1,
    usage: {},
    output: seriesOutput,
    validation: validateAuthorityAcquisition(buildAuthorityTarget(candidate), seriesOutput, [
      publisherUrl,
    ]),
  }
  const score = scoreAuthorityAcquisition({ cases: [candidate] }, [result], 'test-model')

  assert.deepEqual(score.candidateQueue, {
    seriesProposals: 1,
    standaloneProposals: 0,
    unresolved: 0,
    quarantined: 0,
  })
})

test('does not report cached evidence tokens as new run consumption', () => {
  const result = {
    caseId: 'book',
    status: 'completed',
    cached: true,
    modelCallCount: 2,
    webSearchCalls: 2,
    usage: { input_tokens: 300, output_tokens: 90 },
    repair: { output: seriesOutput, usage: { input_tokens: 40, output_tokens: 20 } },
    output: seriesOutput,
    validation: validateAuthorityAcquisition(buildAuthorityTarget(testCase), seriesOutput, [
      publisherUrl,
    ]),
  }

  const score = scoreAuthorityAcquisition({ cases: [testCase] }, [result], 'test-model')

  assert.equal(score.operations.cached, 1)
  assert.equal(score.operations.modelCalls, 0)
  assert.equal(score.operations.inputTokens, 0)
  assert.equal(score.operations.outputTokens, 0)
  assert.equal(score.operations.repairCalls, 0)
  assert.equal(score.operations.repairInputTokens, 0)
  assert.equal(score.operations.repairOutputTokens, 0)
})

test('reports Exa fallback search, model, and cost separately', () => {
  const result = {
    caseId: 'book',
    status: 'completed',
    cached: false,
    billing: { modelCalls: 2, webSearchCalls: 3, inputTokens: 300, outputTokens: 50 },
    output: seriesOutput,
    validation: validateAuthorityAcquisition(buildAuthorityTarget(testCase), seriesOutput, [
      publisherUrl,
    ]),
    exaFallback: {
      selected: true,
      locator: {
        operations: {
          queriesCompleted: 3,
          requests: 4,
          urlsInspected: 24,
          estimatedCostUsd: 0.028,
        },
      },
      search: {
        billing: { modelCalls: 1, webSearchCalls: 1, inputTokens: 120, outputTokens: 20 },
      },
    },
  }

  const score = scoreAuthorityAcquisition({ cases: [testCase] }, [result], 'test-model')

  assert.equal(score.operations.exaFallbackAttempts, 1)
  assert.equal(score.operations.exaFallbackSearchesCompleted, 3)
  assert.equal(score.operations.exaFallbackRequests, 4)
  assert.equal(score.operations.exaFallbackUrlsInspected, 24)
  assert.equal(score.operations.exaFallbackEstimatedCostUsd, 0.028)
  assert.equal(score.operations.exaFallbackModelCalls, 1)
  assert.equal(score.operations.exaFallbackSelected, 1)
  assert.equal(score.operations.exaFallbackInputTokens, 120)
  assert.equal(score.operations.exaFallbackOutputTokens, 20)
})
