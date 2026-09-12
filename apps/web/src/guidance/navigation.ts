import {
  NAVIGATION_ITEMS,
  priorityNavigationItems,
  type NavigationItem,
} from '../components/navigation'
import {
  arrangementsEqual,
  DEFAULT_ARRANGEMENT_PRESET,
  type ArrangementConfig,
} from '../design/arrangements'
import { guidanceAllowsPath, type Guidance } from './model'

const guideItem: NavigationItem = { label: 'Library guide', to: '/guide', icon: 'library' }

/** Filtering is a view. A custom priority trio wins; no arrangement is saved or replaced here. */
export function guidedNavigation(
  arrangement: ArrangementConfig,
  guidance: Guidance | null | undefined,
  pathname: string,
) {
  const customized = !arrangementsEqual(arrangement, DEFAULT_ARRANGEMENT_PRESET.config)
  const priority = priorityNavigationItems(arrangement.destinations).map((item) =>
    customized || guidanceAllowsPath(item.to, guidance) ? item : guideItem,
  )
  const priorityPaths = new Set(priority.map((item) => item.to))
  const other = NAVIGATION_ITEMS.filter(
    (item) =>
      !priorityPaths.has(item.to) &&
      (guidanceAllowsPath(item.to, guidance) ||
        pathname === item.to ||
        (item.to !== '/' && pathname.startsWith(`${item.to}/`))),
  )
  return { priority, other: [...other, ...(priorityPaths.has('/guide') ? [] : [guideItem])] }
}
