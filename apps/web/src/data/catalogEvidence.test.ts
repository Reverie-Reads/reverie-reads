import { beforeEach, expect, it, vi } from 'vitest'
import { applyCatalogEvidence, readCatalogEvidenceAttempt } from './catalogEvidence'
import { isOfflinePersistableQueryKey } from '../lib/offlineCache'
import type { CatalogEvidenceDraft } from '@reverie/core'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))
const draft = (): CatalogEvidenceDraft => ({
  version: 1,
  field: 'description',
  editionId: null,
  value: 'Checked summary.',
  identity: { title: 'Still Waters', author: 'Jane Smith', isbn: null },
  source: {
    url: 'https://publisher.example/book',
    recordId: 'book',
    locator: 'Synopsis',
    checkedAt: '2026-10-20T12:00:00Z',
    kind: 'publisher',
  },
  support: { explanation: 'Checked every claim.', scope: 'work', independentlyChecked: true },
  sourceUse: {
    version: 1,
    basis: 'public_terms',
    url: 'https://publisher.example/terms',
    note: 'Inspected basis covers retaining and displaying this summary.',
    checkedAt: '2026-10-20T12:00:00Z',
    scope: 'catalog_description',
    confirmed: true,
  },
  note: 'Other holds stay open.',
})
beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: { status: 'applied' }, error: null })
})
it('sends only the exact reviewed draft and durable retry ID', async () => {
  const input = { id: 'retry-id', workId: 'work-id', fingerprint: 'frozen', draft: draft() }
  const pending = applyCatalogEvidence(input)
  input.draft.value = 'Changed after submission'
  await pending
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_apply_catalog_evidence', {
    p_id: 'retry-id',
    p_work: 'work-id',
    p_expected_fingerprint: 'frozen',
    p_draft: expect.objectContaining({ value: 'Checked summary.' }),
    p_confirmed: true,
  })
})
it('surfaces failed or stale results without another write', async () => {
  const error = new Error('Stale target')
  rpc.mockResolvedValue({ data: null, error })
  await expect(
    applyCatalogEvidence({ id: 'id', workId: 'work', fingerprint: 'old', draft: draft() }),
  ).rejects.toBe(error)
  expect(rpc).toHaveBeenCalledOnce()
})
it('looks up the exact attempted receipt independently of recent-history pagination', async () => {
  await readCatalogEvidenceAttempt('work', 'attempt')
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_get_catalog_evidence', {
    p_work: 'work',
    p_review: 'attempt',
  })
})
it('never persists administrator source-use or evidence history in the reader offline cache', () => {
  expect(isOfflinePersistableQueryKey(['catalog-evidence', 'admin', 'work'])).toBe(false)
})
