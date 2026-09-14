import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-router', () => ({
  createRoute: (options: unknown) => options,
  Link: ({
    to,
    children,
    search: _search,
    ...props
  }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { to: string; search?: unknown }) => (
    <a href={to} {...props}>
      {children}
    </a>
  ),
  useNavigate: () => vi.fn(),
  useRouterState: ({
    select,
  }: {
    select: (state: { location: { pathname: string } }) => unknown
  }) => select({ location: { pathname: '/library' } }),
}))
vi.mock('./RootRoute', () => ({ rootRoute: {} }))
vi.mock('../data/books', () => ({
  useBooks: () => ({ data: [] }),
  useUpdateBook: () => ({ mutate: vi.fn() }),
}))
vi.mock('../lib/supabase', () => ({ supabase: {} }))

const { LibraryHeader } = await import('./LibraryRoute')
const { Toolbar } = await import('../library/Toolbar')

describe('Library stays book-focused', () => {
  it('keeps Books, Shelves, and Series as linked views of the personal library', () => {
    render(
      <>
        <LibraryHeader scope="personal" readout="12 books" />
        <Toolbar />
      </>,
    )

    expect(screen.queryByRole('group', { name: 'View mode' })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Grid$/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: /^Series$/ })).not.toBeInTheDocument()
    const navigation = screen.getByRole('navigation', { name: 'My library views' })
    expect(navigation).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page')
    expect(screen.getByRole('link', { name: 'Shelves' })).toHaveAttribute('href', '/shelves')
    expect(screen.getByRole('link', { name: 'Series' })).toHaveAttribute('href', '/series')
  })

  it('does not imply personal shelves or series belong to the household catalog', () => {
    render(<LibraryHeader scope="household" readout="Household · shared" />)

    expect(screen.getByRole('heading', { name: 'Household library' })).toBeInTheDocument()
    expect(screen.queryByRole('navigation', { name: 'My library views' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'My library' })).toBeInTheDocument()
  })
})
