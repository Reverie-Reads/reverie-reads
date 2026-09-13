import { NAVIGATION_ITEMS, priorityNavigationItems } from '../components/navigation'
import {
  arrangementsEqual,
  DEFAULT_ARRANGEMENT_PRESET,
  type ArrangementConfig,
} from '../design/arrangements'
import { guidanceAllowsPath, type Guidance } from './model'

/** Filtering is a view. A custom priority trio wins; no arrangement is saved or replaced here. */
export function guidedNavigation(
  arrangement: ArrangementConfig,
  guidance: Guidance | null | undefined,
  pathname: string,
) {
  const customized = !arrangementsEqual(arrangement, DEFAULT_ARRANGEMENT_PRESET.config)
  const priority = priorityNavigationItems(arrangement.destinations).filter(
    (item) => customized || guidanceAllowsPath(item.to, guidance),
  )
  const priorityPaths = new Set(priority.map((item) => item.to))
  const other = NAVIGATION_ITEMS.filter(
    (item) =>
      !priorityPaths.has(item.to) &&
      (guidanceAllowsPath(item.to, guidance) ||
        pathname === item.to ||
        (item.to !== '/' && pathname.startsWith(`${item.to}/`))),
  )
  return { priority, other }
}
