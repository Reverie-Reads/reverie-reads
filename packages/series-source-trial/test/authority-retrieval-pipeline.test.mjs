import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import { validateAuthorityAcquisition } from '../src/authority/evidence.mjs'
import {
  augmentAuthorityAcquisition,
  canonicalizeRetrievedAuthoritySemantics,
  evidencePacketContainsTargetIdentity,
  evidencePacketContainsTargetTitle,
  selectRetrievalParent,
  shouldAttemptAuthorityRetrieval,
  validateRetrievedAuthoritySemantics,
} from '../src/authority/retrieval/pipeline.mjs'
import { REPEATED_NUMBERED_CATALOG_HEADINGS } from '../src/authority/retrieval/profile.mjs'
import { authorityRetrievalProfiles } from '../src/authority/retrieval/profiles.mjs'

const now = new Date('2026-09-05T12:00:00.000Z')
const parentUrl = 'https://author.example/'
const childUrl = 'https://author.example/series'
const target = {
  schemaVersion: 1,
  caseId: 'book-pyg',
  target: { title: 'Pyg', authors: ['Pip Landers-Letts'], publicationYear: 2025 },
}
const profile = {
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
}
const identitySource = {
  url: parentUrl,
  kind: 'author',
  supports: ['identity'],
  evidenceSummary: 'The author page identifies Pyg by Pip Landers-Letts.',
}
const unresolvedOutput = {
  caseId: target.caseId,
  identity: { matched: true, confidence: 'high', evidenceUrls: [parentUrl] },
  classification: 'unresolved',
  memberships: [],
  authoritySources: [identitySource],
  uncertainties: ['No direct series evidence was found.'],
  note: 'Identity is known; classification is unresolved.',
}
const firstPass = {
  caseId: target.caseId,
  status: 'completed',
  output: unresolvedOutput,
  consultedUrls: [parentUrl],
  validation: validateAuthorityAcquisition(target, unresolvedOutput, [parentUrl]),
  cached: true,
}
const directOutput = {
  caseId: target.caseId,
  identity: { matched: true, confidence: 'high', evidenceUrls: [childUrl] },
  classification: 'series',
  memberships: [
    {
      series: 'The Leamington Bloom',
      position: null,
      role: 'primary',
      evidenceUrls: [childUrl],
    },
  ],
  authoritySources: [
    {
      url: childUrl,
      kind: 'publisher',
      supports: ['identity', 'series_membership'],
      evidenceSummary: 'The author directly places Pyg in The Leamington Bloom Series.',
    },
  ],
  uncertainties: [],
  note: 'Direct author evidence supports membership.',
}
const evidenceText = 'P: Pip Landers-Letts lists Pyg as part of The Leamington Bloom Series.'
const retrieval = {
  status: 'retrieved',
  reviewOnly: true,
  evidenceText,
  manifest: {
    caseId: target.caseId,
    startedAt: now.toISOString(),
    terminalResult: 'retrieved',
    childFinalUrl: childUrl,
    sourceKind: 'author',
    gatewayVersion: 'gateway-v1',
    policyVersion: 'policy-v1',
    extractorVersion: 'extractor-v1',
    profileVersion: profile.profileVersion,
    sanitizedSha256: createHash('sha256').update(evidenceText).digest('hex'),
    requests: { used: 3, limit: 9 },
    response: { encodedBytes: 100 },
  },
}

test('retrieval cannot erase a grounded conflicting claim from an earlier search pass', async () => {
  const conflicting = structuredClone(firstPass)
  conflicting.output.authoritySources[0].relationshipClaims = [
    { name: 'Another Named Series', kind: 'book_series', position: null },
  ]
  const result = await augmentAuthorityAcquisition(target, conflicting, {
    profiles: [profile],
    now,
    retrieve: async () => retrieval,
    interpret: async () => ({ output: directOutput, cached: true }),
  })
  assert.equal(result.selectedPass, 'first')
  assert.equal(result.output.classification, 'unresolved')
  assert.ok(
    result.retrievalInterpretation.reviewReasons.includes('prior_series_claim_not_represented'),
  )
  assert.equal(result.authorityPassHistory.length, 2)
})

test('selects an approved shallow author URL deterministically', () => {
  const selected = selectRetrievalParent(
    ['https://publisher.example/catalog/book', 'https://author.example/about', parentUrl],
    [
      profile,
      {
        ...profile,
        profileVersion: 'publisher-example-v1',
        canonicalOrigin: 'https://publisher.example',
        sourceKind: 'publisher_catalog',
      },
    ],
    now,
  )

  assert.equal(selected.status, 'selected')
  assert.equal(selected.consultedUrl, parentUrl)
  assert.equal(selected.profile.sourceKind, 'author')
})

test('prefers a consulted navigation hub over the same origin homepage and detail pages', () => {
  const selected = selectRetrievalParent(
    [
      'https://author.example/books/ruthless-rival',
      parentUrl,
      'https://author.example/all-books/',
      'https://author.example/about',
    ],
    [profile],
    now,
  )

  assert.equal(selected.status, 'selected')
  assert.equal(selected.consultedUrl, 'https://author.example/all-books/')
})

test('does not mistake a detail page nested under books for a navigation hub', () => {
  const selected = selectRetrievalParent(
    ['https://author.example/books/ruthless-rival', parentUrl],
    [profile],
    now,
  )

  assert.equal(selected.status, 'selected')
  assert.equal(selected.consultedUrl, parentUrl)
})

test('retrieves only for unresolved or quarantined first-pass proposals', () => {
  assert.equal(shouldAttemptAuthorityRetrieval(firstPass), true)
  assert.equal(
    shouldAttemptAuthorityRetrieval({
      ...firstPass,
      output: directOutput,
      validation: { valid: true, policySafe: true },
    }),
    false,
  )
  assert.equal(shouldAttemptAuthorityRetrieval({ status: 'error' }), false)
})

test('requires the exact target title before spending a second model call', async () => {
  const noTitleText = 'H1: The Leamington Bloom Series'
  const noTitleRetrieval = {
    ...retrieval,
    evidenceText: noTitleText,
    manifest: {
      ...retrieval.manifest,
      sanitizedSha256: createHash('sha256').update(noTitleText).digest('hex'),
    },
  }
  let interpreted = 0
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async () => noTitleRetrieval,
    interpret: async () => {
      interpreted += 1
    },
  })

  assert.equal(evidencePacketContainsTargetTitle(target, noTitleRetrieval), false)
  assert.equal(evidencePacketContainsTargetIdentity(target, noTitleRetrieval), false)
  assert.equal(result.retrievalInterpretation.reason, 'target_identity_absent')
  assert.equal(result.selectedPass, 'first')
  assert.equal(interpreted, 0)
})

test('does not spend a model call when the packet omits the target author', async () => {
  const noAuthorText = 'P: Pyg is part of The Leamington Bloom Series.'
  const noAuthorRetrieval = {
    ...retrieval,
    evidenceText: noAuthorText,
    manifest: {
      ...retrieval.manifest,
      sanitizedSha256: createHash('sha256').update(noAuthorText).digest('hex'),
    },
  }
  let interpreted = 0
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async () => noAuthorRetrieval,
    interpret: async () => {
      interpreted += 1
    },
  })

  assert.equal(evidencePacketContainsTargetTitle(target, noAuthorRetrieval), true)
  assert.equal(evidencePacketContainsTargetIdentity(target, noAuthorRetrieval), false)
  assert.equal(result.retrievalInterpretation.reason, 'target_identity_absent')
  assert.equal(interpreted, 0)
})

test('quarantines a series or position invented outside the packet', () => {
  const invented = structuredClone(directOutput)
  invented.memberships[0].series = 'A Different Series'
  invented.memberships[0].position = 2
  invented.authoritySources[0].supports.push('position')
  const cleaned = canonicalizeRetrievedAuthoritySemantics(target, invented, retrieval)
  const validation = validateRetrievedAuthoritySemantics(target, cleaned, retrieval, {
    valid: true,
    policySafe: true,
    policyViolations: [],
  })

  assert.equal(validation.policySafe, false)
  assert.ok(validation.policyViolations.some((entry) => entry.includes('same-line')))
  assert.equal(cleaned.memberships[0].position, null)
  assert.equal(cleaned.memberships[0].role, 'unknown')
  assert.deepEqual(cleaned.authoritySources[0].supports, ['identity', 'series_membership'])
})

test('keeps only a position and role explicitly present in the packet', () => {
  const positioned = structuredClone(directOutput)
  positioned.memberships[0].position = 2
  positioned.memberships[0].role = 'secondary'
  positioned.authoritySources[0].supports.push('position')
  const positionedText =
    'P: Pip Landers-Letts lists Pyg as book two in The Leamington Bloom Series, a secondary series.'
  const positionedRetrieval = { ...retrieval, evidenceText: positionedText }

  const cleaned = canonicalizeRetrievedAuthoritySemantics(target, positioned, positionedRetrieval)

  assert.equal(cleaned.memberships[0].position, 2)
  assert.equal(cleaned.memberships[0].role, 'secondary')
  assert.ok(cleaned.authoritySources[0].supports.includes('position'))
})

test('keeps a hash-numbered position in a same-line title and series metadata field', () => {
  const numbered = structuredClone(directOutput)
  numbered.memberships[0].series = 'Cruel Castaways'
  numbered.memberships[0].position = 1
  numbered.authoritySources[0].supports.push('position')
  const metadataText = 'META: Title: Pyg | Series: Cruel Castaways #1 | Author: Pip Landers-Letts'
  const metadataRetrieval = { ...retrieval, evidenceText: metadataText }

  const cleaned = canonicalizeRetrievedAuthoritySemantics(target, numbered, metadataRetrieval)
  const validation = validateRetrievedAuthoritySemantics(target, cleaned, metadataRetrieval, {
    valid: true,
    policySafe: true,
    policyViolations: [],
  })

  assert.equal(cleaned.memberships[0].position, 1)
  assert.equal(validation.policySafe, true)
})

test('accepts an exact target in a repeated numbered author-catalog heading', () => {
  const highKing = structuredClone(directOutput)
  highKing.memberships[0].series = 'High King'
  highKing.memberships[0].position = 1
  highKing.authoritySources[0].supports.push('position')
  const catalogRetrieval = {
    ...retrieval,
    evidenceText: [
      'TITLE: Books - S. M. Davies',
      'H4: High King 1: The West Rises',
      'P: Britain stands on the brink of catastrophe.',
      'H3: High King 2: Under the Dragon',
    ].join('\n'),
    manifest: {
      ...retrieval.manifest,
      childFinalUrl: 'https://author.example/books/',
      evidenceCapabilities: [REPEATED_NUMBERED_CATALOG_HEADINGS],
    },
  }
  const catalogTarget = {
    ...target,
    target: { ...target.target, title: 'The West Rises', authors: ['S. M. Davies'] },
  }

  const cleaned = canonicalizeRetrievedAuthoritySemantics(catalogTarget, highKing, catalogRetrieval)
  const validation = validateRetrievedAuthoritySemantics(catalogTarget, cleaned, catalogRetrieval, {
    valid: true,
    policySafe: true,
    policyViolations: [],
  })

  assert.equal(cleaned.memberships[0].position, 1)
  assert.equal(cleaned.memberships[0].role, 'unknown')
  assert.equal(validation.policySafe, true)
})

test('rejects repeated numbered catalog headings without a reviewed profile capability', () => {
  const highKing = structuredClone(directOutput)
  highKing.memberships[0].series = 'Top'
  highKing.memberships[0].position = 1
  const catalogTarget = {
    ...target,
    target: { ...target.target, title: 'The West Rises', authors: ['S. M. Davies'] },
  }
  const unprofiledCatalog = {
    ...retrieval,
    evidenceText: [
      'TITLE: Books - S. M. Davies',
      'H4: Top 1: The West Rises',
      'H3: Top 2: Under the Dragon',
    ].join('\n'),
    manifest: {
      ...retrieval.manifest,
      childFinalUrl: 'https://author.example/books/',
      evidenceCapabilities: [],
    },
  }

  const cleaned = canonicalizeRetrievedAuthoritySemantics(
    catalogTarget,
    highKing,
    unprofiledCatalog,
  )
  const validation = validateRetrievedAuthoritySemantics(
    catalogTarget,
    cleaned,
    unprofiledCatalog,
    { valid: true, policySafe: true, policyViolations: [] },
  )

  assert.equal(cleaned.memberships[0].position, null)
  assert.equal(validation.policySafe, false)
})

test('rejects isolated or non-catalog numbered headings as membership evidence', () => {
  const highKing = structuredClone(directOutput)
  highKing.memberships[0].series = 'High King'
  highKing.memberships[0].position = 1
  const catalogTarget = {
    ...target,
    target: { ...target.target, title: 'The West Rises', authors: ['S. M. Davies'] },
  }
  const variants = [
    {
      text: 'TITLE: Books - S. M. Davies\nH4: High King 1: The West Rises',
      url: 'https://author.example/books/',
    },
    {
      text: [
        'TITLE: Books - S. M. Davies',
        'H4: High King 1: The West Rises',
        'H3: High Queen 2: Under the Dragon',
      ].join('\n'),
      url: 'https://author.example/books/',
    },
    {
      text: [
        'TITLE: The West Rises - S. M. Davies',
        'H4: High King 1: The West Rises',
        'H3: High King 2: Under the Dragon',
      ].join('\n'),
      url: 'https://author.example/books/the-west-rises/',
    },
    {
      text: [
        'TITLE: The West Rises - S. M. Davies',
        'H4: High King 1: The West Rises',
        'H3: High King 2: Under the Dragon',
      ].join('\n'),
      url: 'https://author.example/books/?title=the-west-rises',
    },
    {
      text: [
        'TITLE: Contents - S. M. Davies',
        'H4: Chapter 1: The West Rises',
        'H3: Chapter 2: Under the Dragon',
      ].join('\n'),
      url: 'https://author.example/books/',
    },
  ]

  for (const variant of variants) {
    const candidateRetrieval = {
      ...retrieval,
      evidenceText: variant.text,
      manifest: {
        ...retrieval.manifest,
        childFinalUrl: variant.url,
        evidenceCapabilities: [REPEATED_NUMBERED_CATALOG_HEADINGS],
      },
    }
    const cleaned = canonicalizeRetrievedAuthoritySemantics(
      catalogTarget,
      highKing,
      candidateRetrieval,
    )
    const validation = validateRetrievedAuthoritySemantics(
      catalogTarget,
      cleaned,
      candidateRetrieval,
      { valid: true, policySafe: true, policyViolations: [] },
    )

    assert.equal(cleaned.memberships[0].position, null)
    assert.equal(validation.policySafe, false)
  }
})

test('does not interpret a retrieved packet whose capabilities differ from the selected profile', async () => {
  let interpreted = 0
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [{ ...profile, evidenceCapabilities: [REPEATED_NUMBERED_CATALOG_HEADINGS] }],
    now,
    retrieve: async () => retrieval,
    interpret: async () => {
      interpreted += 1
    },
  })

  assert.equal(result.selectedPass, 'first')
  assert.equal(result.retrievalInterpretation.reason, 'profile_manifest_mismatch')
  assert.equal(interpreted, 0)
})

test('does not hide a structurally invalid membership role', () => {
  const malformed = structuredClone(directOutput)
  malformed.memberships[0].role = 'leader'

  const cleaned = canonicalizeRetrievedAuthoritySemantics(target, malformed, retrieval)

  assert.equal(cleaned.memberships[0].role, 'leader')
})

test('selects policy-safe retrieved evidence and strips the packet before return', async () => {
  let retrievedInput
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async (input) => {
      retrievedInput = input
      return retrieval
    },
    interpret: async () => ({
      output: directOutput,
      responseId: 'response-2',
      usage: { input_tokens: 100, output_tokens: 50 },
    }),
  })

  assert.equal(retrievedInput.consultedUrl, parentUrl)
  assert.deepEqual(retrievedInput.consultedUrls, [parentUrl])
  assert.equal(result.selectedPass, 'retrieval')
  assert.deepEqual(result.selectedSourceManifest, { kind: 'retrieval', urls: [childUrl] })
  assert.equal(result.output.classification, 'series')
  assert.equal(result.output.authoritySources[0].kind, 'author')
  assert.equal(result.output.memberships[0].role, 'unknown')
  assert.equal(result.validation.policySafe, true)
  assert.deepEqual(result.retrievalInterpretation.sourceManifestUrls, [childUrl])
  assert.equal('evidenceText' in result.retrieval, false)
  assert.equal(JSON.stringify(result).includes(evidenceText), false)
})

test('lets a grounded unresolved second pass replace a false-positive first pass', async () => {
  const falsePositive = {
    ...firstPass,
    output: { ...unresolvedOutput, classification: 'series', memberships: [] },
    validation: { valid: false, policySafe: false },
  }
  const noRelationship = {
    caseId: target.caseId,
    identity: { matched: false, confidence: 'none', evidenceUrls: [] },
    classification: 'unresolved',
    memberships: [],
    authoritySources: [],
    uncertainties: ['The packet names a series but does not identify the exact work.'],
    note: 'Exact-work membership is not established.',
  }
  const result = await augmentAuthorityAcquisition(target, falsePositive, {
    profiles: [profile],
    now,
    retrieve: async () => retrieval,
    interpret: async () => ({ output: noRelationship }),
  })

  assert.equal(result.selectedPass, 'retrieval')
  assert.equal(result.output.classification, 'unresolved')
  assert.equal(result.validation.policySafe, true)
})

test('rejects a series relationship assembled from different books in the packet', async () => {
  const disconnectedText = [
    'P: Pip Landers-Letts wrote Pyg.',
    'H1: The Leamington Bloom Series',
    'P: Chameleon is book two in The Leamington Bloom Series.',
  ].join('\n')
  const disconnectedRetrieval = { ...retrieval, evidenceText: disconnectedText }
  const positioned = structuredClone(directOutput)
  positioned.memberships[0].position = 2
  positioned.authoritySources[0].supports.push('position')
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async () => disconnectedRetrieval,
    interpret: async () => ({ output: positioned }),
  })

  assert.equal(result.selectedPass, 'first')
  assert.deepEqual(result.selectedSourceManifest, { kind: 'hosted_search', urls: [parentUrl] })
  assert.equal(result.retrievalInterpretation.output.memberships[0].position, null)
  assert.equal(result.retrievalInterpretation.validation.policySafe, false)
  assert.ok(
    result.retrievalInterpretation.validation.policyViolations.some((entry) =>
      entry.includes('same-line'),
    ),
  )
})

test('rejects a standalone term that is disconnected from the target title', () => {
  const standalone = {
    ...directOutput,
    classification: 'standalone',
    memberships: [],
    authoritySources: [
      {
        ...directOutput.authoritySources[0],
        supports: ['identity', 'standalone'],
        evidenceSummary: 'The author calls the book a standalone.',
      },
    ],
  }
  const disconnectedRetrieval = {
    ...retrieval,
    evidenceText: 'P: Pip Landers-Letts wrote Pyg.\nP: Chameleon is a stand-alone novel.',
  }
  const validation = validateRetrievedAuthoritySemantics(
    target,
    standalone,
    disconnectedRetrieval,
    {
      valid: true,
      policySafe: true,
      policyViolations: [],
    },
  )

  assert.equal(validation.policySafe, false)
  assert.ok(validation.policyViolations.some((entry) => entry.includes('same-line')))
})

test('rejects parent citations and keeps an unsafe second pass out of selection', async () => {
  const citesParent = structuredClone(directOutput)
  citesParent.identity.evidenceUrls = [parentUrl]
  citesParent.memberships[0].evidenceUrls = [parentUrl]
  citesParent.authoritySources[0].url = parentUrl
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async () => retrieval,
    interpret: async () => ({ output: citesParent }),
  })

  assert.equal(result.selectedPass, 'first')
  assert.equal(result.output.classification, 'unresolved')
  assert.equal(result.retrievalInterpretation.validation.valid, false)
})

test('keeps non-approved real origins out of retrieval', async () => {
  let calls = 0
  for (const url of [
    'https://www.pipwritesfiction.com/',
    'https://www.penguin.co.uk/series/ATTV/assistant-to-the-villain',
    'https://alihazelwood.com/mate/',
    'https://www.penguinrandomhouse.com/books/775877/mate-by-ali-hazelwood/',
  ]) {
    const result = await augmentAuthorityAcquisition(
      target,
      { ...firstPass, consultedUrls: [url] },
      {
        profiles: authorityRetrievalProfiles,
        now,
        retrieve: async () => {
          calls += 1
        },
      },
    )

    assert.equal(result.retrieval.reason, 'origin_pending')
    assert.equal(result.selectedPass, 'first')
  }
  assert.equal(calls, 0)
})

test('activates the owner-reviewed L.J. Shen origin only inside its trial window', () => {
  const approved = selectRetrievalParent(
    ['https://www.authorljshen.com/all-books/'],
    authorityRetrievalProfiles,
    new Date('2026-09-07T06:40:09.000Z'),
  )

  assert.equal(approved.status, 'selected')
  assert.equal(approved.profile.profileVersion, 'authorljshen-approved-trial-v1')

  const expired = selectRetrievalParent(
    ['https://www.authorljshen.com/all-books/'],
    authorityRetrievalProfiles,
    new Date('2026-10-07T06:40:08.000Z'),
  )

  assert.equal(expired.status, 'skipped')
  assert.equal(expired.reason, 'origin_pending')
})

test('activates the owner-reviewed S. M. Davies catalog capability only inside its trial window', () => {
  for (const url of ['https://smdaviesauthor.com/', 'https://www.smdaviesauthor.com/books/']) {
    const approved = selectRetrievalParent(
      [url],
      authorityRetrievalProfiles,
      new Date('2026-09-07T19:20:58.000Z'),
    )

    assert.equal(approved.status, 'selected')
    assert.equal(approved.profile.profileVersion, 'smdaviesauthor-approved-trial-v1')
    assert.deepEqual(approved.profile.evidenceCapabilities, [REPEATED_NUMBERED_CATALOG_HEADINGS])
  }

  const expired = selectRetrievalParent(
    ['https://smdaviesauthor.com/'],
    authorityRetrievalProfiles,
    new Date('2026-10-07T19:20:57.000Z'),
  )

  assert.equal(expired.status, 'skipped')
  assert.equal(expired.reason, 'origin_pending')
})

test('fails optional retrieval closed when the gateway throws', async () => {
  const result = await augmentAuthorityAcquisition(target, firstPass, {
    profiles: [profile],
    now,
    retrieve: async () => {
      throw new Error('unexpected gateway failure')
    },
  })

  assert.equal(result.retrieval.reason, 'internal_error')
  assert.equal(result.selectedPass, 'first')
  assert.deepEqual(result.output, firstPass.output)
})
