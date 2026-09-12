import { createRouter } from '@tanstack/react-router'
import { rootRoute } from './routes/RootRoute'
import { homeRoute } from './routes/HomeRoute'
import { libraryRoute } from './routes/LibraryRoute'
import { shelvesRoute } from './routes/ShelvesRoute'
import { shelfRoute } from './routes/ShelfRoute'
import { plannerRoute } from './routes/PlannerRoute'
import { statsRoute } from './routes/StatsRoute'
import { matchRoute } from './routes/MatchRoute'
import { discoverRoute } from './routes/DiscoverRoute'
import { addRoute } from './routes/AddRoute'
import { settingsRoute } from './routes/SettingsRoute'
import { clubsRoute } from './routes/ClubsRoute'
import { clubRoute } from './routes/ClubRoute'
import { sharedListRoute } from './routes/SharedListRoute'
import { indieRoute } from './routes/IndieRoute'
import { skinsRoute } from './routes/SkinGalleryRoute'
import { seriesRoute } from './routes/SeriesRoute'
import { seriesIndexRoute } from './routes/SeriesIndexRoute'
import { sharedSeriesRoute } from './routes/SharedSeriesRoute'
import { tropesRoute } from './routes/TropesRoute'
import { tropeRoute } from './routes/TropeRoute'
import { moodRoute } from './routes/MoodRoute'
import { reviewRoute } from './routes/ReviewRoute'
import { catalogMetadataReviewRoute } from './routes/CatalogMetadataReviewRoute'
import { catalogCoverReviewRoute } from './routes/CatalogCoverReviewRoute'
import { coverStudioRoute } from './routes/CoverStudioRoute'
import { authRoute } from './routes/AuthRoute'
import { welcomeRoute } from './routes/WelcomeRoute'
import { guideRoute } from './routes/GuideRoute'
import { onboardingRoute } from './routes/OnboardingRoute'
import { labRoute } from './routes/LabRoute'
import { labStructureRoute } from './routes/LabStructureRoute'
import { labArrangementsRoute } from './routes/LabArrangementsRoute'
import { bookRoute } from './book/BookDetailRoute'

const routeTree = rootRoute.addChildren([
  homeRoute,
  libraryRoute,
  shelvesRoute,
  shelfRoute,
  plannerRoute,
  statsRoute,
  matchRoute,
  discoverRoute,
  addRoute,
  settingsRoute,
  clubsRoute,
  clubRoute,
  sharedListRoute,
  indieRoute,
  skinsRoute,
  seriesIndexRoute,
  sharedSeriesRoute,
  seriesRoute,
  tropesRoute,
  tropeRoute,
  moodRoute,
  reviewRoute,
  catalogCoverReviewRoute,
  coverStudioRoute,
  catalogMetadataReviewRoute,
  authRoute,
  welcomeRoute,
  onboardingRoute,
  guideRoute,
  labRoute,
  labStructureRoute,
  labArrangementsRoute,
  bookRoute,
])

export const router = createRouter({
  routeTree,
  // Wrong in BOTH directions without this, which is why it is one option rather than two: back
  // navigation did not restore where you were, and forward navigation kept the PREVIOUS page's
  // scroll instead of starting at the top. TanStack ships the behaviour; it was simply never turned
  // on. Its own branch on purpose — one flag changes every route at once, so a red run means one
  // thing.
  scrollRestoration: true,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
