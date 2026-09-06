import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import { DiscoverBookPreview } from './DiscoverBookPreview'
const details = vi.hoisted(() => vi.fn())
vi.mock('../lib/discoveryDetails', async (original) => ({
  ...(await original<typeof import('../lib/discoveryDetails')>()),
  fetchDiscoveryDetails: details,
}))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ children }: { children: ReactNode }) => <a>{children}</a>,
}))
vi.mock('./Modal', () => ({
  Modal: ({ children }: { children: ReactNode }) => <div role="dialog">{children}</div>,
}))
it('keeps the shortlist synopsis visible while refresh is pending and after it fails', async () => {
  let reject!: (error: Error) => void
  details.mockReturnValue(
    new Promise((_, fail) => {
      reject = fail
    }),
  )
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  render(
    <QueryClientProvider client={client}>
      <DiscoverBookPreview
        hit={{
          title: 'A book',
          authors: ['A Writer'],
          cover: '',
          isbn: '',
          pub: '',
          description: 'The description kept with this selection.',
        }}
        onClose={() => {}}
      />
    </QueryClientProvider>,
  )
  expect(screen.getByText('The description kept with this selection.')).toBeVisible()
  reject(new Error('Provider offline'))
  expect(await screen.findByRole('alert')).toHaveTextContent('Updated details couldn’t be loaded')
  expect(screen.getByText('The description kept with this selection.')).toBeVisible()
  client.clear()
})
