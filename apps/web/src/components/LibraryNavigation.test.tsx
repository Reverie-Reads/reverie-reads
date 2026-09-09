import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { LibraryNavigation } from './LibraryNavigation'

describe('personal library navigation', () => {
  afterEach(() => vi.restoreAllMocks())

  it('moves between real destinations and keeps the selected Books filter on a repeated press', async () => {
    // jsdom has no viewport scrolling. Keep the real router and clicks; only its browser scroll
    // effect needs a stub, since this test asserts destinations and query preservation.
    vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
    const root = createRootRoute({ component: () => <Outlet /> })
    const books = createRoute({
      getParentRoute: () => root,
      path: '/library',
      validateSearch: (search: Record<string, unknown>) => ({
        shelf: typeof search.shelf === 'string' ? search.shelf : undefined,
      }),
      component: () => (
        <>
          <h1>My books</h1>
          <LibraryNavigation current="books" />
        </>
      ),
    })
    const shelves = createRoute({
      getParentRoute: () => root,
      path: '/shelves',
      component: () => (
        <>
          <h1>My shelves</h1>
          <LibraryNavigation current="shelves" />
        </>
      ),
    })
    const series = createRoute({
      getParentRoute: () => root,
      path: '/series',
      component: () => (
        <>
          <h1>My series</h1>
          <LibraryNavigation current="series" />
        </>
      ),
    })
    const covers = createRoute({
      getParentRoute: () => root,
      path: '/covers',
      component: () => (
        <>
          <h1>My covers</h1>
          <LibraryNavigation current="covers" />
        </>
      ),
    })
    const history = createMemoryHistory({ initialEntries: ['/library?shelf=owned'] })
    const router = createRouter({
      routeTree: root.addChildren([books, shelves, series, covers]),
      history,
    })
    render(<RouterProvider router={router} />)
    const user = userEvent.setup()

    await screen.findByRole('heading', { name: 'My books' })
    const initial = within(screen.getByRole('navigation', { name: 'My library views' }))
    expect(initial.getByRole('link', { name: 'Books' })).toHaveAttribute('aria-current', 'page')
    expect(initial.getByRole('link', { name: 'Books' })).toHaveAttribute(
      'href',
      '/library?shelf=owned',
    )
    await user.click(initial.getByRole('link', { name: 'Books' }))
    expect(router.state.location.search).toEqual({ shelf: 'owned' })

    await user.click(initial.getByRole('link', { name: 'Shelves' }))
    await screen.findByRole('heading', { name: 'My shelves' })
    expect(screen.getByRole('link', { name: 'Shelves' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'Series' }))
    await screen.findByRole('heading', { name: 'My series' })
    expect(screen.getByRole('link', { name: 'Series' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'Covers' }))
    await screen.findByRole('heading', { name: 'My covers' })
    expect(screen.getByRole('link', { name: 'Covers' })).toHaveAttribute('aria-current', 'page')

    await user.click(screen.getByRole('link', { name: 'Books' }))
    await screen.findByRole('heading', { name: 'My books' })
    expect(router.state.location.pathname).toBe('/library')
  })
})
