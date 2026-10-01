import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { useAuth } from '../auth/AuthProvider'
import { ProductEntry } from '../products/ProductEntry'

function StartScreen() {
  const { session, signOut } = useAuth()
  return session ? (
    <ProductEntry key={session.user.id} actorId={session.user.id} signOut={signOut} />
  ) : null
}
export const startRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'start',
  component: StartScreen,
})
