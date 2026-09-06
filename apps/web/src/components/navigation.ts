import type { ArrangementDestinationId } from '../design/arrangements'

export type NavigationIconName =
  | 'home'
  | 'library'
  | 'shelves'
  | 'series'
  | 'tropes'
  | 'planner'
  | 'stats'
  | 'match'
  | 'discover'
  | 'clubs'
  | 'indies'
  | 'skins'
  | 'settings'

export interface NavigationItem {
  label: string
  to: string
  icon: NavigationIconName
}

/** One navigation model feeds both the shipped shell and the public product playground. */
export const NAVIGATION_ITEMS = [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'Library', to: '/library', icon: 'library' },
  { label: 'Next read', to: '/match', icon: 'match' },
  { label: 'Shelves', to: '/shelves', icon: 'shelves' },
  { label: 'Series', to: '/series', icon: 'series' },
  { label: 'Planner', to: '/planner', icon: 'planner' },
  { label: 'Stats', to: '/stats', icon: 'stats' },
  { label: 'Tropes', to: '/tropes', icon: 'tropes' },
  { label: 'Discover', to: '/discover', icon: 'discover' },
  { label: 'Clubs', to: '/clubs', icon: 'clubs' },
  { label: 'Bookshops', to: '/indie', icon: 'indies' },
] as const satisfies readonly NavigationItem[]

export const NAVIGATION_GROUPS = [
  { label: 'Reading', items: NAVIGATION_ITEMS.slice(0, 3) },
  { label: 'My library', items: NAVIGATION_ITEMS.slice(3, 5) },
  { label: 'More', items: NAVIGATION_ITEMS.slice(5) },
] as const

export const MOBILE_TAB_ITEMS = [
  NAVIGATION_ITEMS[0],
  NAVIGATION_ITEMS[1],
  NAVIGATION_ITEMS[2],
] as const

export const MORE_NAVIGATION_ITEMS = [
  ...NAVIGATION_ITEMS.filter(
    (item) => !(MOBILE_TAB_ITEMS as readonly NavigationItem[]).includes(item),
  ),
  { label: 'Appearance', to: '/skins', icon: 'skins' },
  { label: 'Settings', to: '/settings', icon: 'settings' },
] as const satisfies readonly NavigationItem[]

const DESTINATION_PATHS: Record<ArrangementDestinationId, string> = {
  home: '/',
  library: '/library',
  match: '/match',
  shelves: '/shelves',
  series: '/series',
  planner: '/planner',
  stats: '/stats',
  discover: '/discover',
}

/** The saved priority trio drives both shells. Invalid ids cannot reach here because the profile
 * parser falls back before rendering, but the filter also keeps this function total in tests. */
export function priorityNavigationItems(
  destinations: readonly ArrangementDestinationId[],
): NavigationItem[] {
  return destinations
    .map((id) => NAVIGATION_ITEMS.find((item) => item.to === DESTINATION_PATHS[id]))
    .filter((item): item is (typeof NAVIGATION_ITEMS)[number] => !!item)
}

export function moreNavigationItems(
  destinations: readonly ArrangementDestinationId[],
): NavigationItem[] {
  const priorityPaths = new Set(priorityNavigationItems(destinations).map((item) => item.to))
  return [
    ...NAVIGATION_ITEMS.filter((item) => !priorityPaths.has(item.to)),
    { label: 'Appearance', to: '/skins', icon: 'skins' as const },
    { label: 'Settings', to: '/settings', icon: 'settings' as const },
  ]
}

const DETAIL_DESTINATIONS = [
  ['/book/', 'Book record'],
  ['/shelf/', 'Shelf'],
  ['/series/', 'Series'],
  ['/tropes/', 'Trope'],
  ['/moods/', 'Mood'],
  ['/club/', 'Club'],
  ['/list/', 'Shared list'],
  ['/review', 'Review books'],
  ['/add', 'Add a book'],
] as const

/** A compact, human label for mobile chrome. The persistent tabs communicate destination; the
 * header names the place the reader has actually reached, including detail routes outside the
 * primary navigation model. */
export function navigationLabelForPath(pathname: string): string {
  const primary =
    NAVIGATION_ITEMS.find((item) => pathname === item.to) ??
    MORE_NAVIGATION_ITEMS.find((item) => pathname === item.to)
  if (primary) return primary.label

  const detail = DETAIL_DESTINATIONS.find(([prefix]) => pathname.startsWith(prefix))
  if (detail) return detail[1]

  return (
    NAVIGATION_ITEMS.find((item) => item.to !== '/' && pathname.startsWith(`${item.to}/`))?.label ??
    'Reading room'
  )
}
