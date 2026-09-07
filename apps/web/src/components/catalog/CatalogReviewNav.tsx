import { Link } from '@tanstack/react-router'

export function CatalogReviewNav() {
  return (
    <nav
      aria-label="Catalog review workspaces"
      className="my-4 flex flex-wrap gap-3 text-sm text-ink"
    >
      <Link
        to="/catalog/covers"
        search={{ state: 'attention', q: '', page: 0, work: undefined }}
        className="skin-control inline-flex min-h-11 items-center border border-line px-4"
        activeProps={{ 'aria-current': 'page' }}
      >
        Review catalog covers
      </Link>
      <Link
        to="/catalog/metadata"
        search={{ state: 'attention', issue: 'all', q: '', page: 0, work: undefined }}
        className="skin-control inline-flex min-h-11 items-center border border-line px-4"
        activeProps={{ 'aria-current': 'page' }}
      >
        Review catalog metadata
      </Link>
    </nav>
  )
}
