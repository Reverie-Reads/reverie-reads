import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { ProductPreferences } from '@reverie/core'
const mocks = vi.hoisted(() => ({
  fetch: vi.fn(),
  save: vi.fn(),
  navigate: vi.fn(),
  invalidate: vi.fn(),
}))
vi.mock('../data/productPreferences', () => ({
  fetchProductPreferences: mocks.fetch,
  saveProductPreferences: mocks.save,
}))
vi.mock('@tanstack/react-router', () => ({ useNavigate: () => mocks.navigate }))
vi.mock('@tanstack/react-query', () => ({
  useQueryClient: () => ({ invalidateQueries: mocks.invalidate }),
}))
vi.mock('../auth/BrandAtmosphere', () => ({ BrandAtmosphere: () => null }))
vi.mock('../auth/Wordmark', () => ({ Wordmark: () => <span>Midniht</span> }))
import { ProductEntry } from './ProductEntry'

const reader: ProductPreferences = {
  version: 1,
  enabledProducts: ['reader'],
  activeProduct: 'reader',
  initialChoiceComplete: true,
  presentation: {},
}
const collector: ProductPreferences = {
  ...reader,
  enabledProducts: ['collector'],
  activeProduct: 'collector',
  presentation: { collector: { version: 8, layout: ['locations'] } },
}
function mount() {
  return render(<ProductEntry actorId="alice" signOut={vi.fn()} />)
}
beforeEach(() => {
  vi.clearAllMocks()
  mocks.fetch.mockResolvedValue({ document: null, revision: 0 })
  mocks.save.mockResolvedValue({ document: reader, revision: 1 })
})

describe('explicit product entry', () => {
  it('offers only usable Reader, and saves the deliberate choice before navigating', async () => {
    let finish!: () => void
    mocks.save.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    mount()
    const button = await screen.findByRole('button', { name: 'Use Reader' })
    expect(screen.queryByRole('button', { name: /collector/i })).not.toBeInTheDocument()
    expect(mocks.save).not.toHaveBeenCalled()
    fireEvent.click(button)
    fireEvent.click(button)
    expect(mocks.save).toHaveBeenCalledExactlyOnceWith('alice', 0, reader)
    expect(mocks.navigate).not.toHaveBeenCalled()
    await act(async () => finish())
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
  })
  it('opens an existing Reader without changing preferences or replaying onboarding', async () => {
    mocks.fetch.mockResolvedValue({ document: reader, revision: 7 })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Reader' }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
  })
  it('preserves unavailable Collector with a no-write Reader escape', async () => {
    mocks.fetch.mockResolvedValue({ document: collector, revision: 3 })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Open Reader for now' }))
    expect(mocks.save).not.toHaveBeenCalled()
    expect(mocks.navigate).toHaveBeenCalledWith({ to: '/' })
  })
  it('deliberately enables Reader without dropping Collector or its newer presentation', async () => {
    mocks.fetch.mockResolvedValue({ document: collector, revision: 3 })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Use Reader' }))
    await waitFor(() =>
      expect(mocks.save).toHaveBeenCalledWith('alice', 3, {
        ...collector,
        enabledProducts: ['collector', 'reader'],
        activeProduct: 'reader',
      }),
    )
  })
  it.each([{ version: 2 }, { version: 1, broken: true }])(
    'keeps unsupported/invalid documents intact: %j',
    async (document) => {
      mocks.fetch.mockResolvedValue({ document, revision: 9 })
      mount()
      fireEvent.click(await screen.findByRole('button', { name: 'Open Reader for now' }))
      expect(screen.queryByRole('button', { name: 'Use Reader' })).not.toBeInTheDocument()
      expect(mocks.save).not.toHaveBeenCalled()
    },
  )
  it('retries a failed save with the exact original revision and document', async () => {
    mocks.save.mockRejectedValueOnce(new Error('Network'))
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Use Reader' }))
    await screen.findByRole('alert')
    expect(mocks.navigate).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Use Reader' }))
    await waitFor(() => expect(mocks.navigate).toHaveBeenCalled())
    expect(mocks.save.mock.calls).toEqual([
      ['alice', 0, reader],
      ['alice', 0, reader],
    ])
  })
  it('does not automatically rebase or write after a conflict', async () => {
    mocks.save.mockRejectedValueOnce({ code: 'PT409' })
    mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Use Reader' }))
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Use Reader' })).toBeDisabled()
    expect(mocks.fetch).toHaveBeenCalledTimes(1)
    mocks.fetch.mockResolvedValue({ document: reader, revision: 2 })
    fireEvent.click(screen.getByRole('button', { name: 'Load current choices' }))
    await screen.findByRole('button', { name: 'Open Reader' })
    expect(mocks.save).toHaveBeenCalledTimes(1)
    expect(mocks.navigate).not.toHaveBeenCalled()
  })
  it('offers retry and an explicit Reader escape when the profile fails to load', async () => {
    mocks.fetch.mockRejectedValueOnce(new Error('Unavailable'))
    mount()
    await screen.findByRole('alert')
    expect(screen.getByRole('button', { name: 'Open Reader for now' })).toBeEnabled()
    expect(screen.queryByRole('button', { name: 'Use Reader' })).not.toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    await screen.findByRole('button', { name: 'Use Reader' })
    expect(mocks.save).not.toHaveBeenCalled()
  })
  it('does not navigate or invalidate another account after the entry screen unmounts', async () => {
    let finish!: () => void
    mocks.save.mockReturnValue(
      new Promise<void>((resolve) => {
        finish = resolve
      }),
    )
    const view = mount()
    fireEvent.click(await screen.findByRole('button', { name: 'Use Reader' }))
    view.unmount()
    await act(async () => finish())
    expect(mocks.navigate).not.toHaveBeenCalled()
    expect(mocks.invalidate).not.toHaveBeenCalled()
  })
})
