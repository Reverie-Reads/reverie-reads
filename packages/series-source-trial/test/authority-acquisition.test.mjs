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
import { acquireAuthorityEvidence, repairAuthorityEvidence } from '../src/authority/openai.mjs'
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
  assert.equal(
    AUTHORITY_ACQUISITION_PROMPT_VERSION,
    'authority-acquisition-v6-reading-independence-evidence',
  )
  assert.match(authorityAcquisitionInstructions, /directly compares the exact target/)
  assert.match(authorityAcquisitionInstructions, /lone numeral, a numbered edition/)
  assert.match(authorityAcquisitionInstructions, /establishes reading independence only/)
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

test('keeps selection frames and known marketing taxonomies out of truth evidence', () => {
  const output = structuredClone(seriesOutput)
  output.classification = 'standalone'
  output.memberships = []
  output.authoritySources[0].supports = ['identity', 'standalone']
  output.authoritySources[0].evidenceSummary = 'The list calls this a standalone novel.'
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
    fetchImpl,
  })

  assert.equal(requestBody.store, false)
  assert.deepEqual(requestBody.tools, [{ type: 'web_search', external_web_access: true }])
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
  assert.equal(result.webSearchCalls, 1)
  assert.deepEqual(result.output, seriesOutput)
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
