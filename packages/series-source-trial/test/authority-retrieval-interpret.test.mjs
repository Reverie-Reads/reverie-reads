import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { test } from 'node:test'
import {
  buildRetrievalInterpretationInput,
  interpretRetrievedAuthorityEvidence,
  RETRIEVAL_INTERPRETATION_PROMPT_VERSION,
  retrievalInterpretationCacheMaterial,
} from '../src/authority/retrieval/interpret.mjs'
import { REPEATED_NUMBERED_CATALOG_HEADINGS } from '../src/authority/retrieval/profile.mjs'

const target = {
  schemaVersion: 1,
  caseId: 'book-pyg',
  target: { title: 'Pyg', authors: ['Pip Landers-Letts'], publicationYear: 2025 },
}
const evidenceText =
  'TITLE: The Leamington Bloom Series\nP: Pyg is part of The Leamington Bloom Series.'
const childUrl = 'https://author.example/series'
const retrieval = {
  status: 'retrieved',
  reviewOnly: true,
  evidenceText,
  manifest: {
    caseId: target.caseId,
    childFinalUrl: childUrl,
    sourceKind: 'author',
    gatewayVersion: 'gateway-v1',
    policyVersion: 'policy-v1',
    extractorVersion: 'extractor-v1',
    profileVersion: 'profile-v1',
    evidenceCapabilities: [],
    sanitizedSha256: createHash('sha256').update(evidenceText).digest('hex'),
  },
}
const output = {
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
      kind: 'author',
      supports: ['identity', 'series_membership'],
      evidenceSummary: 'The author directly places Pyg in The Leamington Bloom Series.',
    },
  ],
  uncertainties: [],
  note: 'The retrieved author page directly supports series membership.',
}

test('builds a truth-blind, single-source interpretation packet', () => {
  const input = buildRetrievalInterpretationInput(target, retrieval)

  assert.deepEqual(input.target, target.target)
  assert.equal(input.source.url, childUrl)
  assert.equal(input.source.kind, 'author')
  assert.equal(input.source.evidenceText, evidenceText)
  assert.deepEqual(input.source.provenance.evidenceCapabilities, [])
  assert.equal('truth' in input, false)
  assert.equal(JSON.stringify(input).includes('parentUrl'), false)
})

test('builds a cache key without retaining evidence text', () => {
  const material = retrievalInterpretationCacheMaterial(target, retrieval, 'test-model')

  assert.equal(material.source.provenance.sanitizedSha256, retrieval.manifest.sanitizedSha256)
  assert.equal(JSON.stringify(material).includes(evidenceText), false)
  assert.equal('evidenceText' in material.source, false)
})

test('sends one strict no-tool model request and returns structured output', async () => {
  let request
  const interpreted = await interpretRetrievedAuthorityEvidence(target, retrieval, {
    apiKey: 'test-key',
    model: 'test-model',
    fetchImpl: async (_url, options) => {
      request = JSON.parse(options.body)
      return {
        ok: true,
        json: async () => ({
          id: 'response-1',
          model: 'test-model',
          output: [
            {
              type: 'message',
              content: [{ type: 'output_text', text: JSON.stringify(output) }],
            },
          ],
          usage: { input_tokens: 200, output_tokens: 100 },
        }),
      }
    },
  })

  assert.deepEqual(interpreted.output, output)
  assert.equal(interpreted.promptVersion, RETRIEVAL_INTERPRETATION_PROMPT_VERSION)
  assert.equal(request.store, false)
  assert.equal(request.model, 'test-model')
  assert.equal('tools' in request, false)
  assert.equal('tool_choice' in request, false)
  assert.equal(request.text.format.strict, true)
  assert.match(request.instructions, new RegExp(REPEATED_NUMBERED_CATALOG_HEADINGS))
  assert.equal(JSON.parse(request.input).source.url, childUrl)
})

test('rejects a tampered or oversized packet before the API call', async () => {
  for (const changed of [
    { ...retrieval, evidenceText: `${evidenceText} changed` },
    {
      ...retrieval,
      manifest: { ...retrieval.manifest, evidenceCapabilities: ['unknown_capability'] },
    },
    {
      ...retrieval,
      evidenceText: 'x'.repeat(8_001),
      manifest: {
        ...retrieval.manifest,
        sanitizedSha256: createHash('sha256').update('x'.repeat(8_001)).digest('hex'),
      },
    },
  ]) {
    let called = false
    await assert.rejects(
      interpretRetrievedAuthorityEvidence(target, changed, {
        apiKey: 'test-key',
        fetchImpl: async () => {
          called = true
        },
      }),
    )
    assert.equal(called, false)
  }
})
