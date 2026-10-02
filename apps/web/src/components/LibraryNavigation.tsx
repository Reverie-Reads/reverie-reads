import { Link } from '@tanstack/react-router'
import { useReadingMode } from '../design/useReadingMode'

const LIBRARY_VIEWS = [
  { key: 'books', label: 'Books', to: '/library' },
  { key: 'shelves', label: 'Shelves', to: '/shelves' },
  { key: 'series', label: 'Series', to: '/series' },
  { key: 'covers', label: 'Covers', to: '/covers' },
] as const

/** Related views of the personal library. Household membership has its own scope control. */
export function LibraryNavigation({
  current,
  className = '',
}: {
  current: (typeof LIBRARY_VIEWS)[number]['key']
  className?: string
}) {
  const { mode } = useReadingMode()
  const navigation = (
    <nav aria-label="My library views" className={`flex flex-wrap gap-2 ${className}`}>
      {LIBRARY_VIEWS.map((view) => {
        const active = view.key === current
        return (
          <Link
            key={view.key}
            to={view.to}
            search={active ? true : {}}
            aria-current={active ? 'page' : undefined}
            className={`skin-control flex min-h-11 items-center justify-center px-4 text-[14px] font-semibold ${
              active ? 'skin-btn-primary' : 'skin-btn-secondary'
            }`}
          >
            {view.label}
          </Link>
        )
      })}
    </nav>
  )
  return mode === 'bearded' ? (
    <details className={className}>
      <summary className="min-h-12 cursor-pointer text-[16px] font-medium text-ink">
        Other ways to view my books
      </summary>
      {navigation}
    </details>
  ) : (
    navigation
  )
}
