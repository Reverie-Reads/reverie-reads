import { describe, expect, it } from 'vitest'
import {
  parseEditionCreditSourceUseReview,
  reviewEditionCreditSourceUse,
} from './editionCreditSourceUse'

const review = () => ({
  version: 1,
  basis: 'public_terms',
  url: 'https://publisher.example/reuse#bibliography',
  note: 'The inspected terms cover retained edition identity and literal contributor-credit facts.',
  checkedAt: '2026-10-18T12:00:00.000Z',
  scope: 'edition_identity_and_credit_facts',
  confirmed: true,
})
const now = '2026-10-18T12:00:00.000Z'
describe('manual edition-credit source-use review', () => {
  it.each(['public_terms', 'written_permission'])(
    'retains the exact %s reference without granting other uses',
    (basis) => {
      const input = { ...review(), basis },
        parsed = parseEditionCreditSourceUseReview(input)
      expect(parsed).toEqual(input)
      expect(parsed).not.toBe(input)
      parsed.note = 'Changed copy'
      expect(input.note).not.toBe(parsed.note)
      expect(reviewEditionCreditSourceUse(input, now)).toEqual({ ready: true, reasons: [] })
      expect(parsed).not.toHaveProperty('export')
      expect(parsed).not.toHaveProperty('modelInput')
    },
  )
  it.each([
    { confirmed: false },
    { version: 2 },
    { basis: 'api_key' },
    { basis: 'model_verified' },
    { basis: { toString: (): string => 'public_terms' } },
    { note: ' ' },
    { note: 'x'.repeat(1001) },
    { scope: 'all_provider_content' },
    { scope: 'model_input' },
    { sourcePayload: {} },
    { privateNotes: 'private value' },
    { modelApproval: true },
  ])('rejects unsupported use assertions or additional payload fields', (patch) => {
    const input = { ...review(), ...patch }
    expect(() => parseEditionCreditSourceUseReview(input)).toThrow()
    expect(reviewEditionCreditSourceUse(input, now)).toEqual({
      ready: false,
      reasons: ['source_use_review_required'],
    })
  })
  it.each([
    'http://publisher.example/terms',
    'javascript:alert(1)',
    'https://person:secret@publisher.example/terms',
    'https://publisher.example/terms?key=private',
    'https://publisher.example/terms?mode=share',
    'https://publisher.example/terms?',
    'https://publisher.example\\terms',
    'https://publisher.example/white space',
    '',
    'https://' + 'a'.repeat(2000),
  ])('rejects unsafe or credential-bearing permission references', (url) => {
    expect(() => parseEditionCreditSourceUseReview({ ...review(), url })).toThrow()
  })
  it.each([
    '2026-02-30T12:00:00Z',
    '2026-10-18T24:00:00Z',
    '2026-10-18',
    '2026-10-18T12:00:00+01:00',
  ])('rejects a noncanonical inspection date: %s', (checkedAt) => {
    expect(() => parseEditionCreditSourceUseReview({ ...review(), checkedAt })).toThrow()
  })
  it.each([
    '2026-10-18T12:00:00Z',
    '2026-10-18T12:00:00.1Z',
    '2026-10-18T12:00:00.12Z',
    '2026-10-18T12:00:00.123Z',
  ])('retains a real UTC timestamp: %s', (checkedAt) => {
    expect(parseEditionCreditSourceUseReview({ ...review(), checkedAt }).checkedAt).toBe(checkedAt)
  })
  it('does not turn an old or future permission attestation into current support', () => {
    expect(
      reviewEditionCreditSourceUse({ ...review(), checkedAt: '2026-09-18T12:00:00Z' }, now).ready,
    ).toBe(true)
    for (const checkedAt of ['2026-09-18T11:59:59.999Z', '2026-10-18T12:00:00.001Z'])
      expect(reviewEditionCreditSourceUse({ ...review(), checkedAt }, now)).toEqual({
        ready: false,
        reasons: ['source_use_stale'],
      })
    expect(reviewEditionCreditSourceUse(review(), 'tomorrow').reasons).toContain('source_use_stale')
    expect(reviewEditionCreditSourceUse(null, now).reasons).toContain('source_use_review_required')
  })
})
