import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  authorityPolicyForCase,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  shouldRepairAuthorityAcquisition,
  validateAuthorityAcquisition,
} from '../src/authority/evidence.mjs'
import {
  authorityAcquisitionOutputSchema,
  authorityAcquisitionInstructions,
  authorityAcquisitionRepairInstructions,
  authorityRelationshipEncodingInstructions,
} from '../src/authority/schema.mjs'
import { retrievalInterpretationInstructions } from '../src/authority/retrieval/interpret.mjs'

const url = 'https://publisher.example/books/second-book'
const target = buildAuthorityTarget({
  id: 'source-claims',
  title: 'Second Book',
  authors: ['Ada Reader'],
})
const policy = authorityPolicyForCase({})
const proposal = () => ({
  caseId: target.caseId,
  identity: { matched: true, confidence: 'high', evidenceUrls: [url] },
  classification: 'series',
  memberships: [{ series: 'The Sequence', position: 2, role: 'primary', evidenceUrls: [url] }],
  authoritySources: [
    {
      url,
      kind: 'publisher',
      observedIdentity: { title: 'Second Book', authors: ['Ada Reader'], workKind: 'single_work' },
      originAssessment: 'claimed_first_party',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary: 'The publisher places the exact title and author in The Sequence, book 2.',
      relationshipClaims: [{ name: 'The Sequence', kind: 'book_series', position: 2 }],
    },
  ],
  uncertainties: [],
  note: '',
})
const validate = (output, rules = policy) => {
  const urls = output.authoritySources.map((source) => source.url)
  return validateAuthorityAcquisition(
    target,
    canonicalizeAuthorityAcquisition(output, urls, rules),
    urls,
    rules,
  )
}

test('current acquisition requires structured source claims; legacy replay cannot supply them', () => {
  assert.equal(policy.requireRelationshipClaims, true)
  assert.ok(
    authorityAcquisitionOutputSchema.properties.authoritySources.items.required.includes(
      'relationshipClaims',
    ),
  )
  const output = proposal()
  delete output.authoritySources[0].relationshipClaims
  assert.equal(validate(output).valid, false)
  assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
  assert.equal(validate(output, {}).policySafe, true)
})

test('accepts direct publisher relationships without upgrading review-only status', () => {
  const result = validate(proposal())
  assert.equal(result.policySafe, true)
  assert.equal(result.reviewOnly, true)
})

test('a single consistent structured claim can still enter the existing structural repair lane', () => {
  const output = proposal()
  output.memberships = []
  const result = validate(output)
  assert.deepEqual(result.errors, ['series classification requires a membership'])
  assert.equal(shouldRepairAuthorityAcquisition(result), true)
})

test('structural repair cannot resolve competing names or positions', () => {
  for (const claim of [
    { name: 'Another Sequence', kind: 'book_series', position: 2 },
    { name: 'The Sequence', kind: 'book_series', position: 3 },
  ]) {
    const output = proposal()
    output.memberships = []
    output.authoritySources[0].relationshipClaims.push(claim)
    assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
  }
})

test('structural repair cannot manufacture missing extracted relationship claims', () => {
  const output = proposal()
  output.memberships = []
  output.authoritySources[0].relationshipClaims = []
  assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
})

test('only generic series/books suffixes normalize; articles and named forms stay distinct', () => {
  for (const [name, safe] of [
    ['The Sequence series', true],
    ['THE SEQUENCE', true],
    ['Sequence', false],
    ['The Sequence Trilogy', false],
  ]) {
    const output = proposal()
    output.authoritySources[0].relationshipClaims[0].name = name
    assert.equal(validate(output).policySafe, safe, name)
  }
})

test('unknown and non-book relationship kinds cannot establish membership', () => {
  for (const kind of ['publisher_collection', 'imprint', 'reading_list', 'universe', 'unknown']) {
    const output = proposal()
    output.authoritySources[0].relationshipClaims[0].kind = kind
    assert.equal(validate(output).policySafe, false, kind)
  }
})

test('rejects missing, malformed and invented source claims without structural repair', () => {
  for (const claims of [
    null,
    {},
    [],
    [{ name: '', kind: 'book_series', position: 2 }],
    [{ name: 'The Sequence', kind: 'book_series', position: '2' }],
    [null],
  ]) {
    const output = proposal()
    output.authoritySources[0].relationshipClaims = claims
    const result = validate(output)
    assert.equal(result.policySafe, false)
    assert.equal(shouldRepairAuthorityAcquisition(result), false)
  }
})

test('a disagreeing source label cannot be hidden by choosing only one source', () => {
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/books/second-book',
    supports: ['identity'],
    relationshipClaims: [{ name: 'Another Sequence', kind: 'book_series', position: 2 }],
  })
  const result = validate(output)
  assert.equal(result.policySafe, false)
  assert.ok(result.policyViolations.some((reason) => reason.includes('unrepresented series claim')))
})

test('multiple explicit memberships stay visible for review, not silently collapsed', () => {
  const output = proposal()
  output.authoritySources[0].relationshipClaims.push({
    name: 'Second Sequence',
    kind: 'book_series',
    position: null,
  })
  output.memberships.push({
    series: 'Second Sequence',
    position: null,
    role: 'secondary',
    evidenceUrls: [url],
  })
  assert.equal(validate(output).policySafe, true)
  assert.equal(validate(output).reviewOnly, true)
})

test('empty supports cannot make an observed conflict disappear during cleanup', () => {
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/books/second-book',
    supports: [],
    relationshipClaims: [{ name: 'Another Sequence', kind: 'book_series', position: 2 }],
  })
  assert.equal(validate(output).policySafe, false)
  assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
})

test('positions require a matching explicit source claim and conflicts stay review-only', () => {
  for (const position of [null, 3]) {
    const output = proposal()
    output.authoritySources[0].relationshipClaims[0].position = position
    assert.equal(validate(output).policySafe, false)
  }
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/books/second-book',
    relationshipClaims: [{ name: 'The Sequence', kind: 'book_series', position: 3 }],
  })
  assert.equal(validate(output).policySafe, false)
})

test('an uncertain competing relationship cannot be ignored for a resolved series', () => {
  const output = proposal()
  output.authoritySources[0].relationshipClaims.push({
    name: 'Another Group',
    kind: 'unknown',
    position: null,
  })
  assert.equal(validate(output).policySafe, false)
})

test('a corroborating membership source need not supply the separately supported position', () => {
  const output = proposal()
  const authorUrl = 'https://author.example/books/second-book'
  output.memberships[0].evidenceUrls.push(authorUrl)
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: authorUrl,
    supports: ['identity', 'series_membership'],
    relationshipClaims: [{ name: 'The Sequence', kind: 'book_series', position: null }],
  })
  assert.equal(validate(output).policySafe, true)
})

test('unresolved preserves conflicting observations without claiming standalone', () => {
  const output = proposal()
  output.classification = 'unresolved'
  output.memberships = []
  output.authoritySources[0].relationshipClaims[0].kind = 'unknown'
  assert.equal(validate(output).policySafe, true)
  assert.equal(validate(output).reviewOnly, true)
})

test('affirmative standalone cannot ignore an observed bibliographic relationship', () => {
  const output = proposal()
  output.classification = 'standalone'
  output.memberships = []
  output.authoritySources[0].supports = ['identity', 'standalone']
  output.authoritySources[0].evidenceSummary = 'The publisher calls the exact work standalone.'
  assert.equal(validate(output).policySafe, false)
  output.authoritySources[0].relationshipClaims[0].kind = 'unknown'
  assert.equal(validate(output).policySafe, false)
  output.authoritySources[0].relationshipClaims = []
  assert.equal(validate(output).policySafe, true)
})

test('observed publisher-collection and imprint errors stay blocked even when mislabeled book_series', () => {
  for (const [sourceUrl, name] of [
    ['https://www.penguinrandomhouse.com/series/RH8/random-house-100/', 'Random House 100 Series'],
    [
      'https://www.penguinrandomhouse.com/series/TV1/thousand-voices/?utm_source=test',
      'Thousand Voices',
    ],
    ['https://www.arielsullivan.com/books/conform', 'Thousand Voices'],
  ]) {
    for (const hasIdentity of [true, false]) {
      const output = proposal()
      output.identity.evidenceUrls = [sourceUrl]
      output.memberships[0] = {
        series: name,
        position: null,
        role: 'primary',
        evidenceUrls: [sourceUrl],
      }
      output.authoritySources[0] = {
        ...output.authoritySources[0],
        url: sourceUrl,
        kind: 'publisher',
        supports: hasIdentity ? ['identity', 'series_membership'] : ['series_membership'],
        evidenceSummary: `The source labels the work ${name}.`,
        relationshipClaims: [{ name, kind: 'book_series', position: null }],
      }
      const result = validate(output)
      assert.equal(result.policySafe, false, sourceUrl)
      assert.equal(shouldRepairAuthorityAcquisition(result), false, sourceUrl)
    }
  }
})

test('scoped profiles do not block unrelated publisher series or corrected author labels', () => {
  const output = proposal()
  output.authoritySources[0].url = 'https://www.arielsullivan.com/books/conform'
  output.memberships[0].evidenceUrls = [output.authoritySources[0].url]
  output.identity.evidenceUrls = [output.authoritySources[0].url]
  assert.equal(validate(output).policySafe, true)
})

test('acquisition, structural repair and retrieval share the same bounded relationship encoding', () => {
  for (const instructions of [
    authorityAcquisitionInstructions,
    authorityAcquisitionRepairInstructions,
    retrievalInterpretationInstructions,
  ]) {
    assert.ok(instructions.includes(authorityRelationshipEncodingInstructions))
  }
})

test('a descriptive identity-only source does not invent a competing named series', () => {
  const output = proposal()
  output.authoritySources.push({
    url: 'https://author.example/book',
    observedIdentity: { title: 'Second Book', authors: ['Ada Reader'], workKind: 'single_work' },
    originAssessment: 'claimed_first_party',
    kind: 'author',
    supports: ['identity'],
    evidenceSummary:
      'The author describes the exact book as the first in a seasonal smalltown series, without naming the series.',
    relationshipClaims: [],
  })
  assert.equal(validate(output).policySafe, true)
  output.authoritySources[0].supports = ['identity']
  output.authoritySources[0].relationshipClaims = []
  assert.equal(
    validate(output).policySafe,
    false,
    'the unnamed source cannot replace the named evidence',
  )
})

test('generic descriptive labels cannot become a membership or an invented alias', () => {
  for (const name of ['a seasonal smalltown series', 'a witchy romance trilogy']) {
    const output = proposal()
    output.memberships[0].series = name
    output.authoritySources[0].relationshipClaims[0].name = name
    assert.equal(validate(output).policySafe, false)
  }
  const output = proposal()
  output.authoritySources[0].relationshipClaims.push({
    name: 'A Distinct Named Trilogy',
    kind: 'unknown',
    position: null,
  })
  assert.equal(validate(output).policySafe, false)
})

test('standalone is affirmative support with no fabricated named relationship', () => {
  const output = proposal()
  output.classification = 'standalone'
  output.memberships = []
  output.authoritySources[0].supports = ['identity', 'standalone']
  output.authoritySources[0].evidenceSummary =
    'The publisher affirmatively calls the exact work a standalone novel.'
  output.authoritySources[0].relationshipClaims = []
  assert.equal(validate(output).policySafe, true)
  output.authoritySources[0].relationshipClaims = [
    { name: 'standalone', kind: 'unknown', position: null },
  ]
  assert.equal(
    validate(output).policySafe,
    false,
    'cleanup must not silently discard malformed claims',
  )
  assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
})
