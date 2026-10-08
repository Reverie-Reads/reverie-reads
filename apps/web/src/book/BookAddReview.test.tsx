// @vitest-environment jsdom
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { BookAddReview } from './BookAddReview'
vi.mock('../components/CoverImage', () => ({ CoverImage: () => null }))
afterEach(cleanup)
describe('review of the submitted record', () => {
  it('shows unknown values and no inferred ownership or reading history', () => {
    render(<BookAddReview book={{ title: 'A Quiet Atlas' }} destination="Your library" />)
    expect(screen.getByText('Author not supplied')).toBeTruthy()
    expect(screen.getByText('Your library')).toBeTruthy()
    expect(screen.queryByText('Owned')).toBeNull()
    expect(screen.queryByText('Paperback')).toBeNull()
    expect(screen.queryByText('Read')).toBeNull()
  })
  it('keeps a zero series position and the complete contributor, date and rating review', () => {
    render(
      <BookAddReview
        book={{
          title: 'Before the Atlas',
          contributors: [{ name: 'Iona Vale', role: 'translator', position: 0 }],
          series: 'Quiet Islands',
          position: 0,
          pub: { y: 2025, m: null, d: null },
          pages: 352,
          rating: 4.5,
          wishlist: true,
        }}
        destination="Your library + Household"
      />,
    )
    expect(screen.getByText('Quiet Islands · Book 0')).toBeTruthy()
    expect(screen.getByText('Iona Vale (translator)')).toBeTruthy()
    expect(screen.getByText('2025')).toBeTruthy()
    expect(screen.getByText('352')).toBeTruthy()
    expect(screen.getByText('4.5 / 5')).toBeTruthy()
    expect(screen.getByText('Wishlist')).toBeTruthy()
  })
})
