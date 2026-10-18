import type { ComponentType, ReactNode } from 'react'
import { render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  location: { pathname: '/' },
  matches: [{ pathname: '/' }],
  callbackPresent: false,
  session: null as { user: { id: string; email: string; email_confirmed_at: string } } | null,
  protectedReads: vi.fn(),
  navigate: vi.fn(),
}))
vi.mock('@tanstack/react-router', () => ({
  createRootRoute: (options: unknown) => ({ options }),
  useRouterState: ({ select }: { select: (s: typeof state) => unknown }) => select(state),
  useNavigate: () => state.navigate,
  // Outlet uses the committed match even when the location already points at a pending route.
  Outlet: () => {
    const active = state.matches[state.matches.length - 1]?.pathname
    if (!active) return null
    if (active === '/') {
      state.protectedReads()
      return <div>Protected Home</div>
    }
    return <div>{active === '/guide' ? 'Public guide' : 'Public welcome'}</div>
  },
}))
vi.mock('../auth/AuthProvider', () => ({
  useAuth: () => ({ session: state.session, loading: false }),
}))
vi.mock('../auth/UnauthShell', () => ({ UnauthShell: () => <div>Signed-out front door</div> }))
vi.mock('../lib/authCallback', () => ({
  authCallback: {
    get present() {
      return state.callbackPresent
    },
  },
}))
vi.mock('../skin/labels', () => ({ useVoice: () => ({ loading: 'Loading' }) }))
vi.mock('../components/Sky', () => ({ Sky: () => null }))
vi.mock('../components/AppShell', () => ({
  AppShell: ({ children }: { children: ReactNode }) => (
    <section data-testid="private-shell">{children}</section>
  ),
}))
vi.mock('../components/UpdateToast', () => ({ UpdateToast: () => null }))
vi.mock('../components/WriteErrorToast', () => ({ WriteErrorToast: () => null }))
vi.mock('../components/JustFinishedSheet', () => ({ JustFinishedSheet: () => null }))
vi.mock('../auth/VerifyEmail', () => ({ VerifyEmail: () => null }))
vi.mock('../auth/ReadingRoomGate', () => ({
  ReadingRoomGate: ({ children }: { children: ReactNode }) => (
    <section data-testid="reading-room-gate">{children}</section>
  ),
}))
vi.mock('../components/PersonalLibrarySync', () => ({
  PersonalLibrarySync: () => <div data-testid="personal-library-sync" />,
}))
vi.mock('../guidance/BookTourProvider', () => ({
  BookTourProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../guidance/BookTour', () => ({ BookTour: () => null }))
vi.mock('../components/HouseholdDestinations', () => ({
  HouseholdDestinations: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../components/AddReturnContext', () => ({
  AddReturnProvider: ({ children }: { children: ReactNode }) => children,
}))
vi.mock('../design/ReadingMode', () => ({
  ReadingModeProvider: ({ children }: { children: ReactNode }) => children,
}))

const { rootRoute } = await import('./RootRoute')
const Root = rootRoute.options.component as ComponentType
beforeEach(() => {
  vi.clearAllMocks()
  state.location.pathname = '/'
  state.matches = [{ pathname: '/' }]
  state.callbackPresent = false
  state.session = null
})

describe('root public-route transition boundary', () => {
  it('never mounts protected Home while its public guide destination is pending', () => {
    const view = render(<Root />)
    expect(screen.getByText('Signed-out front door')).toBeTruthy()
    state.location.pathname = '/guide'
    view.rerender(<Root />)
    expect(screen.getByText('Signed-out front door')).toBeTruthy()
    expect(screen.queryByText('Protected Home')).toBeNull()
    expect(state.protectedReads).not.toHaveBeenCalled()
    state.matches = [{ pathname: '/' }, { pathname: '/guide' }]
    view.rerender(<Root />)
    expect(screen.getByText('Public guide')).toBeTruthy()
    expect(state.protectedReads).not.toHaveBeenCalled()
  })
  it('keeps the committed public guide during pending protected navigation and gates its commit', () => {
    state.location.pathname = '/guide'
    state.matches = [{ pathname: '/' }, { pathname: '/guide' }]
    const view = render(<Root />)
    state.location.pathname = '/'
    view.rerender(<Root />)
    expect(screen.getByText('Public guide')).toBeTruthy()
    state.matches = [{ pathname: '/' }]
    view.rerender(<Root />)
    expect(screen.getByText('Signed-out front door')).toBeTruthy()
    expect(screen.queryByText('Protected Home')).toBeNull()
    expect(state.protectedReads).not.toHaveBeenCalled()
  })
  it.each(['/', '/guide', '/welcome'])(
    'does not mount private providers before matches exist at %s',
    (path) => {
      state.location.pathname = path
      state.matches = []
      render(<Root />)
      expect(state.protectedReads).not.toHaveBeenCalled()
      expect(screen.queryByTestId('private-shell')).toBeNull()
      expect(screen.queryByTestId('personal-library-sync')).toBeNull()
    },
  )
  it('keeps signed-in providers with committed protected content in both pending directions', () => {
    state.session = {
      user: {
        id: 'reader-a',
        email: 'reader@example.test',
        email_confirmed_at: '2026-10-18T00:00:00Z',
      },
    }
    const view = render(<Root />)
    expect(screen.getByTestId('private-shell').textContent).toContain('Protected Home')
    expect(screen.getByTestId('personal-library-sync')).toBeTruthy()
    state.location.pathname = '/guide'
    view.rerender(<Root />)
    expect(screen.getByTestId('private-shell').textContent).toContain('Protected Home')
    expect(screen.getByTestId('personal-library-sync')).toBeTruthy()
    state.matches = [{ pathname: '/' }, { pathname: '/guide' }]
    view.rerender(<Root />)
    expect(screen.getByText('Public guide')).toBeTruthy()
    expect(screen.queryByTestId('reading-room-gate')).toBeNull()
    expect(screen.queryByTestId('personal-library-sync')).toBeNull()
    const readsBeforeReturn = state.protectedReads.mock.calls.length
    state.location.pathname = '/'
    view.rerender(<Root />)
    expect(screen.getByText('Public guide')).toBeTruthy()
    expect(screen.queryByTestId('private-shell')).toBeNull()
    expect(screen.queryByTestId('personal-library-sync')).toBeNull()
    expect(state.protectedReads).toHaveBeenCalledTimes(readsBeforeReturn)
    state.matches = [{ pathname: '/' }]
    view.rerender(<Root />)
    expect(screen.getByTestId('reading-room-gate')).toBeTruthy()
    expect(screen.getByTestId('private-shell').textContent).toContain('Protected Home')
    expect(screen.getByTestId('personal-library-sync')).toBeTruthy()
  })
  it('does not redirect a callback already committed to welcome', () => {
    state.callbackPresent = true
    state.location.pathname = '/welcome'
    state.matches = [{ pathname: '/' }, { pathname: '/welcome' }]
    render(<Root />)
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(state.navigate).not.toHaveBeenCalled()
    expect(state.protectedReads).not.toHaveBeenCalled()
  })
  it('retains the committed welcome route and auth-callback redirect', () => {
    state.location.pathname = '/welcome'
    state.matches = [{ pathname: '/' }, { pathname: '/welcome' }]
    const view = render(<Root />)
    expect(screen.getByText('Public welcome')).toBeTruthy()
    view.unmount()
    state.location.pathname = '/'
    state.matches = [{ pathname: '/' }]
    state.callbackPresent = true
    const callbackView = render(<Root />)
    expect(state.navigate).toHaveBeenCalledWith({ to: '/welcome', replace: true })
    state.location.pathname = '/welcome'
    callbackView.rerender(<Root />)
    expect(screen.getByText('Signed-out front door')).toBeTruthy()
    state.matches = [{ pathname: '/' }, { pathname: '/welcome' }]
    callbackView.rerender(<Root />)
    expect(screen.getByText('Public welcome')).toBeTruthy()
    expect(state.navigate).toHaveBeenCalledTimes(1)
    expect(state.protectedReads).not.toHaveBeenCalled()
  })
})
