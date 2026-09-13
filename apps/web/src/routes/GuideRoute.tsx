import { createRoute } from '@tanstack/react-router'
import { rootRoute } from './RootRoute'
import { GuideScreen } from '../guidance/Guide'
import { PublicGuide } from '../auth/PublicGuide'

export const guideRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'guide',
  component: PublicGuide,
})

export const guidanceSettingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'settings/guidance',
  component: GuideScreen,
})
