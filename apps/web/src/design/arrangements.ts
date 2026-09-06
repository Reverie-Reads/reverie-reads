import type { NavigationIconName } from '../components/navigation'

export type ArrangementPresetId = 'library' | 'next-read' | 'reading-life'
export type ArrangementDestinationId =
  | 'home'
  | 'library'
  | 'match'
  | 'shelves'
  | 'series'
  | 'planner'
  | 'stats'
  | 'discover'
export type HomeModuleId = 'reading' | 'next-read' | 'priority' | 'releases' | 'year'

export interface ArrangementDestination {
  id: ArrangementDestinationId
  label: string
  icon: NavigationIconName
}

export interface HomeModule {
  id: HomeModuleId
  label: string
  description: string
}

export interface ArrangementConfig {
  destinations: ArrangementDestinationId[]
  homeModules: HomeModuleId[]
}

export interface ArrangementPreset {
  id: ArrangementPresetId
  label: string
  description: string
  config: ArrangementConfig
}

export const MAX_PRIORITY_DESTINATIONS = 3

export const ARRANGEMENT_DESTINATIONS: readonly ArrangementDestination[] = [
  { id: 'home', label: 'Home', icon: 'home' },
  { id: 'library', label: 'Library', icon: 'library' },
  { id: 'match', label: 'Next read', icon: 'match' },
  { id: 'shelves', label: 'Shelves', icon: 'shelves' },
  { id: 'series', label: 'Series', icon: 'series' },
  { id: 'planner', label: 'Planner', icon: 'planner' },
  { id: 'stats', label: 'Stats', icon: 'stats' },
  { id: 'discover', label: 'Discover', icon: 'discover' },
]

export const HOME_MODULES: readonly HomeModule[] = [
  {
    id: 'reading',
    label: 'Reading now',
    description: 'Current books, progress, and the next reading action.',
  },
  {
    id: 'next-read',
    label: 'Choose a next read',
    description: 'Available candidates from the reader’s own library.',
  },
  {
    id: 'priority',
    label: 'Priority shelves',
    description: 'Books from shelves the reader has marked as important.',
  },
  {
    id: 'releases',
    label: 'Coming soon',
    description: 'Known releases approaching in the reader’s library.',
  },
  {
    id: 'year',
    label: 'Your reading year',
    description: 'Private yearly progress and the reader’s own goal.',
  },
]

export const ARRANGEMENT_PRESETS: readonly ArrangementPreset[] = [
  {
    id: 'library',
    label: 'Keep my books close',
    description: 'Lead with the collection, shelves, and books already in progress.',
    config: {
      destinations: ['library', 'home', 'shelves'],
      homeModules: ['priority', 'reading', 'releases'],
    },
  },
  {
    id: 'next-read',
    label: 'Find my next read',
    description: 'Bring the shortlist and current books to the front.',
    config: {
      destinations: ['home', 'match', 'library'],
      homeModules: ['next-read', 'reading', 'priority'],
    },
  },
  {
    id: 'reading-life',
    label: 'Remember my reading',
    description: 'Lead with current reading, the year, and the history held by the library.',
    config: {
      destinations: ['home', 'library', 'stats'],
      homeModules: ['reading', 'year', 'priority'],
    },
  },
]

export const DEFAULT_ARRANGEMENT_PRESET = ARRANGEMENT_PRESETS[1]!

export function cloneArrangement(config: ArrangementConfig): ArrangementConfig {
  return { destinations: [...config.destinations], homeModules: [...config.homeModules] }
}

export function moveItem<T>(items: readonly T[], index: number, direction: -1 | 1): T[] {
  const target = index + direction
  if (index < 0 || index >= items.length || target < 0 || target >= items.length) return [...items]
  const next = [...items]
  const current = next[index]!
  next[index] = next[target]!
  next[target] = current
  return next
}

export function hideDestination(
  config: ArrangementConfig,
  destination: ArrangementDestinationId,
): ArrangementConfig {
  if (destination === 'library') return cloneArrangement(config)
  return {
    ...cloneArrangement(config),
    destinations: config.destinations.filter((id) => id !== destination),
  }
}

export function restoreDestination(
  config: ArrangementConfig,
  destination: ArrangementDestinationId,
): ArrangementConfig {
  if (
    config.destinations.includes(destination) ||
    config.destinations.length >= MAX_PRIORITY_DESTINATIONS
  ) {
    return cloneArrangement(config)
  }
  return { ...cloneArrangement(config), destinations: [...config.destinations, destination] }
}
