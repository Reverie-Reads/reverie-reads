import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { ReflectScreen } from '../stats/ReflectScreen'

export const statsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'stats',
  component: ReflectScreen,
})
