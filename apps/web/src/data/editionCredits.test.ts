import { beforeEach, expect, it, vi } from 'vitest'
import { prepareEditionCredits } from './editionCredits'
const api = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc: api.rpc } }))
const input = () => ({
  id: 'review',
  workId: 'work',
  editionId: 'edition',
  fingerprint: 'current',
  evidence: {
    version: 1 as const,
    source: {
      url: 'https://publisher.example/edition',
      kind: 'publisher' as const,
      checkedAt: '2026-10-18T12:00:00Z',
      locator: 'Edition details',
      retentionConfirmed: true as const,
    },
    identity: {
      title: 'Still Waters',
      authors: ['Jane Smith'],
      isbn: '9780306406157',
      format: null,
      language: null,
    },
    credits: [
      {
        name: 'Ann Brown',
        role: 'translator' as const,
        scope: 'whole' as const,
        basis: 'edition' as const,
        sourceRole: 'Translated by',
      },
    ],
    confirmations: { sourceChecked: true, identityChecked: true, creditsChecked: true },
  },
  sourceUseReview: {
    version: 1 as const,
    basis: 'public_terms' as const,
    url: 'https://publisher.example/terms',
    note: 'These terms cover attributed edition identity and credit facts.',
    checkedAt: '2026-10-18T12:00:00Z',
    scope: 'edition_identity_and_credit_facts' as const,
    confirmed: true as const,
  },
})
beforeEach(() => {
  vi.clearAllMocks()
  api.rpc.mockResolvedValue({ data: { id: 'review' }, error: null })
})
it('sends only the strict frozen bibliography and source-use record through the reviewed RPC', async () => {
  const value = input()
  await prepareEditionCredits(value)
  expect(api.rpc).toHaveBeenCalledExactlyOnceWith('admin_prepare_reviewed_edition_credits', {
    p_id: value.id,
    p_work: value.workId,
    p_edition: value.editionId,
    p_expected_fingerprint: value.fingerprint,
    p_evidence: value.evidence,
    p_source_use: value.sourceUseReview,
  })
})
it.each([
  'privateFields',
  'providerPayload',
  'sourceUseAssertion',
  'providerCreditId',
  'providerRoleCode',
])('rejects %s before a server retention call', async (kind) => {
  const value = input()
  if (kind === 'privateFields') Object.assign(value.evidence, { notes: 'Private reader value' })
  if (kind === 'providerPayload') Object.assign(value.sourceUseReview, { providerPayload: {} })
  if (kind === 'sourceUseAssertion') Object.assign(value.sourceUseReview, { basis: 'api_key' })
  if (kind === 'providerCreditId')
    Object.assign(value.evidence.credits[0]!, { sourceContributorId: 'provider-person' })
  if (kind === 'providerRoleCode')
    Object.assign(value.evidence.credits[0]!, { sourceRoleCode: 'T' })
  await expect(prepareEditionCredits(value)).rejects.toThrow()
  expect(api.rpc).not.toHaveBeenCalled()
})
it('keeps an older-server failure explicit without falling back to the legacy prepare RPC', async () => {
  api.rpc.mockResolvedValue({ data: null, error: { code: 'PGRST202' } })
  await expect(prepareEditionCredits(input())).rejects.toThrow('needs the updated server')
  expect(api.rpc).toHaveBeenCalledTimes(1)
})
it('lets an exact structural retry reach the server even when the inspection is now old', async () => {
  const value = input()
  value.sourceUseReview.checkedAt = '2020-01-01T12:00:00Z'
  // Only the locked server knows whether the original save already succeeded. A new old
  // receipt is rejected there; an existing identical applied receipt remains a read-only retry.
  await prepareEditionCredits(value)
  expect(api.rpc).toHaveBeenCalledTimes(1)
})
