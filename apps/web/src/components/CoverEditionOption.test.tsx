import { fireEvent, render, screen } from '@testing-library/react'
import { expect, it, vi } from 'vitest'
import { CoverEditionOption } from './CoverEditionOption'
import { sortCoverEditions } from '../data/coverSheet'
import type { EditionOption } from '../lib/covers'
const edition: EditionOption = {
  source: 'hardcover',
  title: 'A book',
  cover: 'https://assets.hardcover.app/cover.jpg',
  isbn13: '9780306406157',
  format: 'Paperback',
}
it('puts exact ISBN ahead of source convenience, without reordering the input', () => {
  const exact: EditionOption = {
    ...edition,
    source: 'openlibrary',
    cover: 'https://covers.openlibrary.org/b/isbn/9780306406157-L.jpg?default=false',
  }
  const other = { ...edition, isbn13: '9780140328721' }
  const pool = [other, exact]
  expect(sortCoverEditions(pool, '0306406152')).toEqual([exact, other])
  expect(pool).toEqual([other, exact])
})
it.each([
  [128, 206, 'May look soft'],
  [480, 720, 'Sharp on cards'],
  [800, 1200, 'Sharp in detail'],
])('shows actual %i by %i resolution before selection', (width, height, label) => {
  const onSelect = vi.fn()
  const { container } = render(
    <CoverEditionOption edition={edition} isbn="0306406152" disabled={false} onSelect={onSelect} />,
  )
  const button = screen.getByRole('button')
  expect(button).toBeDisabled()
  const img = container.querySelector('img')!
  Object.defineProperties(img, { naturalWidth: { value: width }, naturalHeight: { value: height } })
  fireEvent.load(img)
  expect(screen.getByText(new RegExp(label))).toBeInTheDocument()
  expect(screen.getByText('Matches your ISBN')).toBeInTheDocument()
  expect(button).toBeEnabled()
  fireEvent.click(button)
  expect(onSelect).toHaveBeenCalledWith(edition)
})
it('does not label a broken image as sharp or allow it to replace a working cover', () => {
  const { container } = render(
    <CoverEditionOption edition={edition} isbn="" disabled={false} onSelect={vi.fn()} />,
  )
  fireEvent.error(container.querySelector('img')!)
  expect(screen.getByText('Image unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
})
it('refuses a successfully decoded tracking pixel from any provider', () => {
  const onSelect = vi.fn()
  const { container } = render(
    <CoverEditionOption edition={edition} isbn="" disabled={false} onSelect={onSelect} />,
  )
  const img = container.querySelector('img')!
  Object.defineProperties(img, { naturalWidth: { value: 1 }, naturalHeight: { value: 1 } })
  fireEvent.load(img)
  expect(screen.getByText('Image unavailable')).toBeInTheDocument()
  expect(screen.getByRole('button')).toBeDisabled()
  fireEvent.click(screen.getByRole('button'))
  expect(onSelect).not.toHaveBeenCalled()
})
