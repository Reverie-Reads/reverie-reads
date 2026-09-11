import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { GoogleBooksAttribution, GoogleBooksResultLink } from './GoogleBooksAttribution'

describe('Google Books result attribution', () => {
  it('uses the official asset at its unmodified natural dimensions', () => {
    render(<GoogleBooksAttribution />)

    const badge = screen.getByRole('img', { name: 'Powered by Google' })
    expect(badge).toHaveAttribute('src', '/google-books-powered-by.png')
    expect(badge).toHaveAttribute('width', '62')
    expect(badge).toHaveAttribute('height', '30')
  })

  it('links a Google result to its exact Books page in a new tab', () => {
    render(
      <GoogleBooksResultLink
        result={{
          source: 'google',
          title: 'The Left Hand of Darkness',
          sourceUrl: 'https://books.google.com/books?id=left-hand',
        }}
      />,
    )

    const link = screen.getByRole('link', {
      name: 'View The Left Hand of Darkness on Google Books (opens in a new tab)',
    })
    expect(link).toHaveAttribute('href', 'https://books.google.com/books?id=left-hand')
    expect(link).toHaveAttribute('target', '_blank')
  })

  it('renders no link for a missing, non-Google, or lookalike provider URL', () => {
    const { rerender } = render(
      <GoogleBooksResultLink result={{ source: 'google', title: 'Missing' }} />,
    )
    expect(screen.queryByRole('link')).toBeNull()

    rerender(
      <GoogleBooksResultLink
        result={{
          source: 'hardcover',
          title: 'Wrong provider',
          sourceUrl: 'https://books.google.com/books?id=wrong-provider',
        }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()

    rerender(
      <GoogleBooksResultLink
        result={{
          source: 'google',
          title: 'Lookalike',
          sourceUrl: 'https://books.google.com.example.test/books?id=lookalike',
        }}
      />,
    )
    expect(screen.queryByRole('link')).toBeNull()
  })
})
