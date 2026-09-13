import { beforeEach, expect, it, vi } from 'vitest'
import {
  saveCatalogMetadataReview,
  saveCatalogEditionCorrection,
  type CatalogMetadataWork,
} from './corpusMetadataReview'
import { isOfflinePersistableQueryKey } from '../lib/offlineCache'
const { rpc } = vi.hoisted(() => ({ rpc: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: { rpc } }))
const work = { id: 'work', fingerprint: 'reviewed-snapshot', revision: 4 } as CatalogMetadataWork
beforeEach(() => {
  rpc.mockReset()
  rpc.mockResolvedValue({ data: 'work', error: null })
})
it('sends the reviewed snapshot and only the explicitly chosen description correction', async () => {
  await saveCatalogMetadataReview({
    work,
    action: 'description',
    note: ' Checked publisher ',
    sourceUrl: ' https://publisher.example/book ',
    description: ' A checked synopsis. ',
    identityConfirmed: true,
  })
  expect(rpc).toHaveBeenCalledWith('admin_review_corpus_metadata', {
    p_work: 'work',
    p_expected_fingerprint: 'reviewed-snapshot',
    p_expected_revision: 4,
    p_action: 'description',
    p_note: 'Checked publisher',
    p_source_url: 'https://publisher.example/book',
    p_description: 'A checked synopsis.',
    p_identity_confirmed: true,
  })
})
it('an assessment or deferral never silently saves a description draft', async () => {
  await saveCatalogMetadataReview({
    work,
    action: 'defer',
    note: '',
    sourceUrl: '',
    description: 'Unsaved draft',
    identityConfirmed: false,
  })
  expect(rpc.mock.calls[0]?.[1].p_description).toBeNull()
})
it('surfaces a stale record refusal without retrying a write', async () => {
  const error = new Error('This catalog record or review changed. Refresh before deciding.')
  rpc.mockResolvedValue({ data: null, error })
  await expect(
    saveCatalogMetadataReview({
      work,
      action: 'reviewed',
      note: 'Checked',
      sourceUrl: '',
      identityConfirmed: true,
    }),
  ).rejects.toBe(error)
  expect(rpc).toHaveBeenCalledTimes(1)
})
it('never persists administrator metadata assessments into the offline reader cache', () => {
  expect(
    isOfflinePersistableQueryKey(['catalog-metadata-review', 'admin', 'history', 'work']),
  ).toBe(false)
  expect(isOfflinePersistableQueryKey(['books', 'reader'])).toBe(true)
})
it('sends one selected edition field to the narrow RPC, never the broad editor', async () => {
  await saveCatalogEditionCorrection({
    work: { ...work, editionCorrectionVersion: 1, editionFingerprint: 'frozen-edition' },
    isbn: '0306406152',
    evidenceTitle: ' Exact Title ',
    evidenceAuthor: ' Full Writer; Other Writer ',
    correction: { field: 'publication', value: { y: 2024, m: null, d: null } },
    sourceUrl: ' https://publisher.example/edition ',
    note: ' Exact edition checked ',
    identityConfirmed: true,
  })
  expect(rpc).toHaveBeenCalledExactlyOnceWith('admin_correct_corpus_edition_details', {
    p_work: 'work',
    p_expected_fingerprint: 'frozen-edition',
    p_expected_revision: 4,
    p_isbn: '0306406152',
    p_evidence_title: 'Exact Title',
    p_evidence_author: 'Full Writer; Other Writer',
    p_field: 'publication',
    p_value: { y: 2024, m: null, d: null },
    p_source_url: 'https://publisher.example/edition',
    p_note: 'Exact edition checked',
    p_identity_confirmed: true,
  })
})
it('refuses an old server before sending a correction request', async () => {
  await expect(
    saveCatalogEditionCorrection({
      work,
      isbn: '0306406152',
      evidenceTitle: 'Exact Title',
      evidenceAuthor: 'Full Writer',
      correction: { field: 'pages', value: { pages: 120 } },
      sourceUrl: 'https://publisher.example/edition',
      note: 'Checked',
      identityConfirmed: true,
    }),
  ).rejects.toThrow('not available')
  expect(rpc).not.toHaveBeenCalled()
})
it('does not retry an uncertain edition write', async () => {
  rpc.mockResolvedValue({ data: null, error: new Error('Connection lost') })
  await expect(
    saveCatalogEditionCorrection({
      work: { ...work, editionCorrectionVersion: 1, editionFingerprint: 'frozen-edition' },
      isbn: '0306406152',
      evidenceTitle: 'Exact Title',
      evidenceAuthor: 'Full Writer',
      correction: { field: 'pages', value: { pages: 120 } },
      sourceUrl: 'https://publisher.example/edition',
      note: 'Checked',
      identityConfirmed: true,
    }),
  ).rejects.toThrow('Connection lost')
  expect(rpc).toHaveBeenCalledTimes(1)
})
