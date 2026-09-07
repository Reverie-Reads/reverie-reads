import { act, fireEvent, render, renderHook } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { useSetCover } from './coverSheet'
import { CoverImage } from '../components/CoverImage'
const mocks = vi.hoisted(() => ({ update: vi.fn().mockResolvedValue({}), ingest: vi.fn() }))
vi.mock('./books', () => ({ useUpdateBook: () => ({ mutateAsync: mocks.update }) }))
vi.mock('../lib/covers', () => ({ ingestCover: mocks.ingest, fetchEditions: vi.fn() }))
vi.mock('./brokenCovers', () => ({ clearCoverBroken: vi.fn(), markCoverBroken: vi.fn() }))
it('keeps the working linked image after a failed large-image fallback and a later render', async () => {
  const original = 'https://books.google.com/books/content?id=selection&zoom=1'
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => useSetCover(), { wrapper })
  await act(() =>
    hook.result.current.mutateAsync({ book: { id: 'one' }, source: 'google', url: original }),
  )
  const patch = mocks.update.mock.calls[0]![0].patch
  expect(patch).toMatchObject({ cover: original, coverThumb: original, coverUserChosen: true })
  expect(mocks.ingest).not.toHaveBeenCalled()
  const { container } = render(<CoverImage book={patch} reportErrors={false} />)
  let image = container.querySelector('img')!
  Object.defineProperties(image, {
    naturalWidth: { value: 575, configurable: true },
    naturalHeight: { value: 750, configurable: true },
  })
  fireEvent.load(image)
  image = container.querySelector('img')!
  expect(image.src).toBe(original)
  Object.defineProperties(image, {
    naturalWidth: { value: 128, configurable: true },
    naturalHeight: { value: 206, configurable: true },
  })
  fireEvent.load(image)
  expect(container.querySelector('img')?.src).toBe(original)
  client.clear()
})
