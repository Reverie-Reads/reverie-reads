import { useEffect } from 'react'
import { createRoute, useNavigate } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { loadGuestHandoff } from '../auth/landing/guest/handoff'

/** `/auth` exists so the URL resolves and a signed-out reader can deep-link straight to the auth
 *  screen (which the unauth shell renders from the path + `?mode`). A signed-IN reader who lands here
 *  has no business on the auth screen, so they skip to their library. */
function AuthRedirect() {
  const navigate = useNavigate()
  useEffect(() => {
    void navigate({ to: loadGuestHandoff() ? '/onboarding' : '/library', replace: true })
  }, [navigate])
  return null
}

export const authRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'auth',
  validateSearch: (
    search: Record<string, unknown>,
  ): { mode?: 'signin' | 'signup'; guest?: boolean } => ({
    mode: search.mode === 'signup' ? 'signup' : search.mode === 'signin' ? 'signin' : undefined,
    guest: search.guest === true || search.guest === 'true' ? true : undefined,
  }),
  component: AuthRedirect,
})
