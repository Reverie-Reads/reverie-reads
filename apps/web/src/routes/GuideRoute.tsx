import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { GuideScreen } from '../guidance/Guide'

export const guideRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'guide',
  component: GuideScreen,
})
