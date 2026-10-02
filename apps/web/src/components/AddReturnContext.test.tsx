import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Link,
  Outlet,
  RouterProvider,
} from '@tanstack/react-router'
import { describe, expect, it, vi } from 'vitest'
import { AddReturnProvider } from './AddReturnContext'
import { useAddReturn } from './addReturn'
import { DraftExitGuard } from './DraftExitGuard'

function setup(initial = '/library?scope=household', dirty = false, busy = false) {
  let finishSave = () => {}
  vi.spyOn(window, 'scrollTo').mockImplementation(() => {})
  function Root() {
    const [account, setAccount] = useState(1)
    return (
      <>
        <button onClick={() => setAccount(account + 1)}>Switch account</button>
        <AddReturnProvider key={account}>
          <Outlet />
        </AddReturnProvider>
      </>
    )
  }
  const root = createRootRoute({ component: Root })
  const library = createRoute({
    getParentRoute: () => root,
    path: '/library',
    validateSearch: (s: Record<string, unknown>) => ({ scope: s.scope }),
    component: () => (
      <>
        <h1>Library</h1>
        <Link to="/add">Add here</Link>
      </>
    ),
  })
  const add = createRoute({
    getParentRoute: () => root,
    path: '/add',
    component: function Add() {
      const origin = useAddReturn()
      const [unsaved, setUnsaved] = useState(dirty)
      finishSave = () => setUnsaved(false)
      return (
        <>
          <h1>Add</h1>
          {unsaved && <DraftExitGuard busy={busy} />}
          <input aria-label="Draft title" defaultValue="My unsaved book" />
          <button onClick={origin?.returnToOrigin}>
            {origin?.label ?? 'No remembered origin'}
          </button>
          <Link to="/book/$bookId" params={{ bookId: 'new-book' }} replace>
            Open saved book
          </Link>
        </>
      )
    },
  })
  const book = createRoute({
    getParentRoute: () => root,
    path: '/book/$bookId',
    component: () => <h1>Saved book</h1>,
  })
  const history = createMemoryHistory({ initialEntries: [initial] })
  const router = createRouter({ routeTree: root.addChildren([library, add, book]), history })
  render(<RouterProvider router={router} />)
  return { router, history, user: userEvent.setup(), finishSave: () => finishSave() }
}

describe('Add entry and return', () => {
  it('returns to the exact household query and opening the saved book skips the completed Add page', async () => {
    const { user, router, history } = setup()
    await user.click(await screen.findByRole('link', { name: 'Add here' }))
    await user.click(await screen.findByRole('button', { name: 'Return to your household' }))
    await waitFor(() => expect(router.state.location.href).toBe('/library?scope=household'))
    await user.click(await screen.findByRole('link', { name: 'Add here' }))
    await user.click(await screen.findByRole('link', { name: 'Open saved book' }))
    await screen.findByRole('heading', { name: 'Saved book' })
    history.back()
    await waitFor(() => expect(router.state.location.href).toBe('/library?scope=household'))
  })

  it('retains an unsaved draft when navigation is cancelled and leaves only after the explicit choice', async () => {
    const { user, router } = setup('/library?scope=household', true)
    await user.click(await screen.findByRole('link', { name: 'Add here' }))
    await user.click(await screen.findByRole('link', { name: 'Open saved book' }))
    await user.click(await screen.findByRole('button', { name: 'Keep editing' }))
    expect(screen.getByRole('textbox', { name: 'Draft title' })).toHaveValue('My unsaved book')
    expect(router.state.location.pathname).toBe('/add')
    await user.click(screen.getByRole('link', { name: 'Open saved book' }))
    await user.click(await screen.findByRole('button', { name: 'Leave draft' }))
    await waitFor(() => expect(router.state.location.href).toBe('/book/new-book'))
  })

  it('cancels an outstanding exit when the save completes and permits a fresh deliberate exit', async () => {
    const { user, router, finishSave } = setup('/library?scope=household', true, true)
    await user.click(await screen.findByRole('link', { name: 'Add here' }))
    await user.click(await screen.findByRole('link', { name: 'Open saved book' }))
    await screen.findByRole('dialog', { name: 'Saving your book' })
    expect(screen.queryByRole('button', { name: 'Leave draft' })).toBeNull()
    await act(async () => finishSave())
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(router.state.location.pathname).toBe('/add')
    await user.click(screen.getByRole('link', { name: 'Open saved book' }))
    await waitFor(() => expect(router.state.location.pathname).toBe('/book/new-book'))
  })

  it('forgets the previous account origin and never derives one from a direct-link parameter', async () => {
    const { user } = setup()
    await user.click(await screen.findByRole('link', { name: 'Add here' }))
    await screen.findByRole('button', { name: 'Return to your household' })
    await user.click(screen.getByRole('button', { name: 'Switch account' }))
    await screen.findByRole('button', { name: 'No remembered origin' })
  })

  it('uses no remembered origin for direct entry, even with an external return query', async () => {
    setup('/add?returnTo=https://example.org')
    await screen.findByRole('button', { name: 'No remembered origin' })
  })
})
