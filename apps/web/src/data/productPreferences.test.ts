import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductPreferences } from '@reverie/core'
const mocks = vi.hoisted(() => ({ actor: 'alice', rpc: vi.fn(), maybeSingle: vi.fn(), eq: vi.fn() }))
vi.mock('../lib/supabase', () => ({ supabase: {
  auth: { getUser: async () => ({ data: { user: { id: mocks.actor } } }) },
  from: () => ({ select: () => ({ eq: mocks.eq }) }), rpc: mocks.rpc,
} }))
import { fetchProductPreferences, saveProductPreferences } from './productPreferences'
const document: ProductPreferences = { version: 1, enabledProducts: ['reader'], activeProduct: 'reader', initialChoiceComplete: true, presentation: {} }
beforeEach(() => {
  vi.clearAllMocks()
  mocks.actor = 'alice'
  mocks.eq.mockReturnValue({ maybeSingle: mocks.maybeSingle })
  mocks.maybeSingle.mockResolvedValue({ data: { product_preferences: document, product_preferences_revision: 2 }, error: null })
  mocks.rpc.mockResolvedValue({ data: { document, revision: 3 }, error: null })
})
describe('account-bound product preferences', () => {
  it('scopes reads and retains unknown newer documents without a default', async () => {
    const newer = { version: 2, enabledProducts: ['future'] }
    mocks.maybeSingle.mockResolvedValue({ data: { product_preferences: newer, product_preferences_revision: 9 } })
    expect(await fetchProductPreferences('alice')).toEqual({ document: newer, revision: 9 })
    expect(mocks.eq).toHaveBeenCalledWith('id', 'alice')
  })
  it('sends the exact actor, draft and frozen revision to the server', async () => {
    expect(await saveProductPreferences('alice', 2, document)).toEqual({ document, revision: 3 })
    expect(mocks.rpc).toHaveBeenCalledWith('save_product_preferences', { p_owner_id: 'alice', p_expected_revision: 2, p_document: document })
  })
  it('preserves a conflict and never rebases or retries a differing draft', async () => {
    const error = { code: 'PT409', message: 'Changed on another device' }
    mocks.rpc.mockResolvedValue({ data: null, error })
    await expect(saveProductPreferences('alice', 1, document)).rejects.toEqual(error)
    expect(mocks.rpc).toHaveBeenCalledTimes(1)
    expect(mocks.maybeSingle).not.toHaveBeenCalled()
  })
  it('does not dispatch a save after an account switch', async () => {
    mocks.actor = 'bob'
    await expect(saveProductPreferences('alice', 2, document)).rejects.toThrow('account changed')
    expect(mocks.rpc).not.toHaveBeenCalled()
  })
  it('discards a late save response from a previous account', async () => {
    mocks.rpc.mockImplementation(async () => { mocks.actor = 'bob'; return { data: { document, revision: 3 } } })
    await expect(saveProductPreferences('alice', 2, document)).rejects.toThrow('account changed')
  })
  it('discards a late profile read from a previous account', async () => {
    mocks.maybeSingle.mockImplementation(async () => { mocks.actor = 'bob'; return { data: { product_preferences: document, product_preferences_revision: 2 } } })
    await expect(fetchProductPreferences('alice')).rejects.toThrow('account changed')
  })
  it('does not invent a revision when the profile is unavailable', async () => {
    mocks.maybeSingle.mockResolvedValue({ data: null })
    await expect(fetchProductPreferences('alice')).rejects.toThrow('unavailable')
  })
})
