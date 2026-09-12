import { ShelfPlacementError, type useAddFromSearch } from '../data/search'

/** Essential save status, including recovery after the book saved but placement did not. */
export function SearchSaveNotice({ add }: { add: ReturnType<typeof useAddFromSearch> }) {
  if (add.isPending)
    return (
      <p role="status" className="mt-2 text-sm text-ink">
        {add.variables?.savedBookId ? 'Adding to shelf…' : 'Saving book…'}
      </p>
    )
  if (!add.isError) return null
  const variables = add.variables
  const savedBookId = add.error instanceof ShelfPlacementError ? add.error.bookId : undefined
  return (
    <div role="alert" className="mt-2 text-sm text-ink">
      <p>{savedBookId ? add.error.message : 'We couldn’t save this book. Please try again.'}</p>
      {savedBookId && variables && (
        <button
          type="button"
          className="min-h-11 font-semibold underline underline-offset-4"
          onClick={() => add.mutate({ ...variables, savedBookId })}
        >
          Retry adding to shelf
        </button>
      )}
    </div>
  )
}
