import assert from 'node:assert/strict'
import test from 'node:test'
import {
  authorityPolicyForCase,
  buildAuthorityTarget,
  canonicalizeAuthorityAcquisition,
  reviewAuthorityPassTransition,
  shouldRepairAuthorityAcquisition,
  validateAuthorityAcquisition,
  validateAuthorityPassHistory,
} from '../src/authority/evidence.mjs'
import {
  authorityAcquisitionInstructions,
  authorityAcquisitionRepairInstructions,
  authorityAcquisitionOutputSchema,
  authorityIdentityObservationInstructions,
} from '../src/authority/schema.mjs'
import { retrievalInterpretationInstructions } from '../src/authority/retrieval/interpret.mjs'

const book = { id: 'identity-review', title: 'Second Book', authors: ['Ada Reader'] }
const target = buildAuthorityTarget(book)
const policy = authorityPolicyForCase(book)
const url = 'https://publisher.example/second-book'
const proposal = () => ({
  caseId: book.id,
  identity: { matched: true, confidence: 'high', evidenceUrls: [url] },
  classification: 'series',
  memberships: [{ series: 'The Sequence', position: 2, role: 'primary', evidenceUrls: [url] }],
  authoritySources: [
    {
      url,
      kind: 'publisher',
      supports: ['identity', 'series_membership', 'position'],
      evidenceSummary: 'The publisher places Second Book by Ada Reader in The Sequence, book 2.',
      relationshipClaims: [{ name: 'The Sequence', kind: 'book_series', position: 2 }],
      observedIdentity: { title: book.title, authors: [...book.authors], workKind: 'single_work' },
      originAssessment: 'claimed_first_party',
    },
  ],
  uncertainties: [],
  note: '',
})
const validate = (output, rules = policy, wanted = target) => {
  const consulted = output.authoritySources.map((source) => source.url)
  return validateAuthorityAcquisition(
    wanted,
    canonicalizeAuthorityAcquisition(output, consulted, rules),
    consulted,
    rules,
  )
}
const snapshot = (output) => ({
  output,
  consultedUrls: output.authoritySources.map((source) => source.url),
})

test('all current prompts require observed identity without model-issued origin qualification', () => {
  assert.equal(policy.requireSourceObservations, true)
  for (const prompt of [
    authorityAcquisitionInstructions,
    authorityAcquisitionRepairInstructions,
    retrievalInterpretationInstructions,
  ]) {
    assert.ok(prompt.includes(authorityIdentityObservationInstructions))
  }
  const schema = authorityAcquisitionOutputSchema.properties.authoritySources.items
  assert.ok(schema.required.includes('observedIdentity'))
  assert.ok(schema.required.includes('originAssessment'))
  assert.deepEqual(schema.properties.originAssessment.enum, ['claimed_first_party', 'unverified'])
})

test('current proposals need observations; missing historical facts are never synthesized', () => {
  const output = proposal()
  delete output.authoritySources[0].observedIdentity
  delete output.authoritySources[0].originAssessment
  const before = structuredClone(output)
  assert.equal(validate(output).valid, false)
  assert.equal(shouldRepairAuthorityAcquisition(validate(output)), false)
  assert.equal(validate(output, {}).policySafe, true)
  assert.deepEqual(output, before)
  output.authoritySources[0].observedIdentity = null
  assert.equal(validate(output, {}).valid, false)
  output.authoritySources[0].observedIdentity = proposal().authoritySources[0].observedIdentity
  output.authoritySources[0].originAssessment = 'verified_by_model'
  assert.equal(validate(output, {}).valid, false)
})

test('exact complete identities pass, but spelling, initials, surnames and partial authors do not', () => {
  assert.equal(validate(proposal()).policySafe, true)
  assert.equal(validate(proposal()).reviewOnly, true)
  for (const authors of [
    ['Ada Reeder'],
    ['A. Reader'],
    ['John Reader'],
    [],
    ['Ada Reader', 'Bea Writer'],
  ]) {
    const output = proposal()
    output.authoritySources[0].observedIdentity.authors = authors
    const result = validate(output)
    assert.equal(result.policySafe, false, JSON.stringify(authors))
    assert.equal(shouldRepairAuthorityAcquisition(result), false)
  }
  const wanted = buildAuthorityTarget({ ...book, authors: ['Ada Reader', 'Bea Writer'] })
  const coauthorPolicy = authorityPolicyForCase({ ...book, ...wanted.target })
  assert.equal(validate(proposal(), coauthorPolicy, wanted).policySafe, false)
  const output = proposal()
  output.authoritySources[0].observedIdentity.authors = ['BEA WRITER', 'Ada Reader']
  assert.equal(validate(output, coauthorPolicy, wanted).policySafe, true)
})

test('formatting equivalence keeps Unicode distinct and does not invent subtitle aliases', () => {
  const output = proposal()
  output.authoritySources[0].observedIdentity = {
    title: '海の本',
    authors: ['山田 花子'],
    workKind: 'single_work',
  }
  const wanted = buildAuthorityTarget({ ...book, title: '海の本', authors: ['山田 花子'] })
  const unicodePolicy = authorityPolicyForCase({ ...book, ...wanted.target })
  assert.equal(validate(output, unicodePolicy, wanted).policySafe, true)
  output.authoritySources[0].observedIdentity.authors = ['山田 太郎']
  assert.equal(validate(output, unicodePolicy, wanted).policySafe, false)
  const punctuated = proposal()
  punctuated.authoritySources[0].observedIdentity.title = ' SECOND—BOOK '
  assert.equal(validate(punctuated).policySafe, true)
  punctuated.authoritySources[0].observedIdentity.title = 'Second Book: A Novel'
  assert.equal(validate(punctuated).policySafe, false)
})

test('an identity-only discrepancy stays visible beside an otherwise supported source', () => {
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/book',
    supports: ['identity'],
    relationshipClaims: [],
    observedIdentity: { title: book.title, authors: ['Ada Reeder'], workKind: 'single_work' },
  })
  assert.equal(validate(output).policySafe, false)
  output.classification = 'unresolved'
  output.memberships = []
  assert.equal(validate(output).policySafe, true)
})

test('cleanup cannot erase a discrepancy by removing its support types', () => {
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/book',
    supports: [],
    relationshipClaims: [],
    observedIdentity: { title: book.title, authors: ['Ada Reeder'], workKind: 'single_work' },
  })
  const cleaned = canonicalizeAuthorityAcquisition(
    output,
    output.authoritySources.map((source) => source.url),
    policy,
  )
  assert.equal(cleaned.authoritySources.length, 2)
  assert.equal(validate(output).policySafe, false)
})

test('unverified origins and on-domain link hubs cannot supply classification or order', () => {
  for (const sourceUrl of [
    'https://stieglarsson.com/book',
    'https://author.example/all-the-links',
    'https://author.example/links',
  ]) {
    const output = proposal()
    output.authoritySources[0].url = sourceUrl
    output.identity.evidenceUrls = [sourceUrl]
    output.memberships[0].evidenceUrls = [sourceUrl]
    const cleaned = canonicalizeAuthorityAcquisition(output, [sourceUrl], policy)
    assert.deepEqual(cleaned.authoritySources[0].supports, ['identity'])
    assert.deepEqual(cleaned.memberships, [])
    assert.equal(validate(output).policySafe, false)
  }
  const output = proposal()
  output.authoritySources[0].originAssessment = 'unverified'
  assert.equal(validate(output).policySafe, false)
})

test('an independent direct source may resolve despite an unverified discovery source', () => {
  const output = proposal()
  output.authoritySources.push({
    ...structuredClone(output.authoritySources[0]),
    url: 'https://author.example/book',
    originAssessment: 'unverified',
  })
  output.memberships[0].evidenceUrls.push(output.authoritySources[1].url)
  assert.equal(validate(output).policySafe, true)
})

test('omnibus association is review-only even without an ordinal; unknown scope also waits', () => {
  for (const workKind of ['omnibus', 'unknown']) {
    const output = proposal()
    output.authoritySources[0].observedIdentity.workKind = workKind
    output.memberships[0].position = null
    assert.equal(validate(output).policySafe, false)
    output.classification = 'unresolved'
    output.memberships = []
    assert.equal(validate(output).policySafe, true)
  }
  const output = proposal()
  output.authoritySources[0].evidenceSummary =
    'The publisher identifies this omnibus as combining two novels in The Sequence.'
  assert.equal(
    validate(output).policySafe,
    false,
    'a single_work label cannot erase container text',
  )
})

test('later passes cannot erase observed identity/container problems or relabel the same origin', () => {
  for (const change of [
    (source) => {
      source.observedIdentity.authors = ['Ada Reeder']
    },
    (source) => {
      source.observedIdentity.workKind = 'omnibus'
    },
    (source) => {
      source.originAssessment = 'unverified'
    },
  ]) {
    const first = proposal()
    first.classification = 'unresolved'
    first.memberships = []
    change(first.authoritySources[0])
    const result = reviewAuthorityPassTransition(snapshot(first), snapshot(proposal()), policy)
    assert.ok(result.reasons.length)
    assert.equal(result.history.length, 2)
  }
  const first = proposal()
  first.classification = 'unresolved'
  first.memberships = []
  first.authoritySources[0].originAssessment = 'unverified'
  const next = proposal()
  const independentUrl = 'https://independent-publisher.example/book'
  next.authoritySources[0].url = independentUrl
  next.memberships[0].evidenceUrls = [independentUrl]
  next.identity.evidenceUrls = [independentUrl]
  assert.deepEqual(
    reviewAuthorityPassTransition(snapshot(first), snapshot(next), policy).reasons,
    [],
  )
})

test('fresh and serialized repair history prevent origin relabelling on cached reads', () => {
  const original = proposal()
  original.authoritySources[0].originAssessment = 'unverified'
  original.memberships = []
  const repaired = proposal()
  const pass = {
    ...snapshot(repaired),
    authorityPassHistory: [snapshot(original), snapshot(repaired)],
  }
  for (const result of [pass, JSON.parse(JSON.stringify(pass))]) {
    const validation = validateAuthorityPassHistory(validate(repaired), result, policy)
    assert.equal(validation.policySafe, false)
    assert.ok(
      validation.policyViolations.some((reason) =>
        reason.includes('prior_origin_control_unverified'),
      ),
    )
  }
  assert.equal(
    validateAuthorityPassHistory(validate(repaired), snapshot(repaired), policy).policySafe,
    true,
  )
})

test('moving an unverified site claim to another path or www spelling is not independent evidence', () => {
  const first = proposal()
  first.classification = 'unresolved'
  first.memberships = []
  first.authoritySources[0].originAssessment = 'unverified'
  for (const nextUrl of [
    'https://publisher.example/another-book-page',
    'https://www.publisher.example/books/second-book',
  ]) {
    const next = proposal()
    next.authoritySources[0].url = nextUrl
    next.identity.evidenceUrls = [nextUrl]
    next.memberships[0].evidenceUrls = [nextUrl]
    assert.ok(
      reviewAuthorityPassTransition(snapshot(first), snapshot(next), policy).reasons.includes(
        'prior_origin_control_unverified',
      ),
    )
  }
})

test('later discovery-only observations cannot poison a consistent independent identity', () => {
  const first = proposal()
  first.classification = 'unresolved'
  first.memberships = []
  const next = proposal()
  next.authoritySources.push({
    ...structuredClone(next.authoritySources[0]),
    url: 'https://goodreads.com/book/other',
    supports: ['identity'],
    relationshipClaims: [],
    observedIdentity: { title: book.title, authors: ['Another Reader'], workKind: 'single_work' },
  })
  assert.equal(validate(next).policySafe, true)
  assert.deepEqual(
    reviewAuthorityPassTransition(snapshot(first), snapshot(next), policy).reasons,
    [],
  )
})
