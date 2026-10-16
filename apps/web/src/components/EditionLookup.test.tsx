import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, expect, it, vi } from 'vitest'
import { EditionLookup } from './EditionLookup'
const lookup = vi.hoisted(() => vi.fn())
vi.mock('../lib/enrich', () => ({ findEditions: lookup }))
beforeEach(() => {
  lookup.mockReset()
})
it('does not choose an edition until the reader selects it', async () => {
  const edition = {
    title: 'Test',
    authors: ['Example'],
    isbn13: '9780306406157',
    publisher: 'Example Press',
  }
  lookup.mockResolvedValue({ editions: [edition], limited: true })
  const select = vi.fn()
  render(<EditionLookup title="Test" author="Example" onSelect={select} />)
  fireEvent.click(screen.getByRole('button', { name: 'Find editions' }))
  await screen.findByRole('button', { name: `Use ISBN ${edition.isbn13}` })
  expect(select).not.toHaveBeenCalled()
  expect(screen.getByRole('status')).toHaveTextContent('not an exhaustive list')
  fireEvent.click(screen.getByRole('button', { name: `Use ISBN ${edition.isbn13}` }))
  expect(select).toHaveBeenCalledWith(edition)
})
it('discards a late response after the identity changes', async () => {
  let finish!: (value: unknown) => void
  lookup.mockImplementation(
    () =>
      new Promise((resolve) => {
        finish = resolve
      }),
  )
  const { rerender } = render(<EditionLookup title="First" author="Example" onSelect={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Find editions' }))
  rerender(<EditionLookup title="Second" author="Example" onSelect={vi.fn()} />)
  finish({
    editions: [{ title: 'First', authors: ['Example'], isbn13: '9780306406157' }],
    limited: false,
  })
  await waitFor(() => expect(screen.getByRole('button', { name: 'Find editions' })).toBeEnabled())
  expect(screen.queryByRole('button', { name: /Use ISBN/ })).toBeNull()
  expect(lookup.mock.calls[0]?.[2]?.aborted).toBe(true)
})
it('keeps provider failure distinct from successful emptiness', async () => {
  lookup.mockRejectedValue(
    new Error('Edition lookup is unavailable. Your draft is unchanged; try again.'),
  )
  render(<EditionLookup title="Test" author="Example" onSelect={vi.fn()} />)
  fireEvent.click(screen.getByRole('button', { name: 'Find editions' }))
  expect(await screen.findByRole('alert')).toHaveTextContent('unavailable')
  expect(screen.queryByRole('status')).toBeNull()
})
