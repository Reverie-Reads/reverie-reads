import { useState } from 'react'
import type { Book } from '@reverie/core'
import { usePublishPersonalBookTag } from '../data/tropes'

export function PublishBookTag({ book, workId }: { book: Book; workId: string }) {
  const publish = usePublishPersonalBookTag()
  const [selected, setSelected] = useState('')
  const tag = book.tropes.find((t) => t.id === selected)
  return (
    <details className="mt-3">
      <summary className="cursor-pointer text-sm text-ink">
        Publish a saved tag to the shared catalog
      </summary>
      <label className="mt-2 block">
        Tag for {book.title}
        <select
          value={selected}
          onChange={(e) => {
            setSelected(e.target.value)
            publish.reset()
          }}
          disabled={publish.isPending}
          className="skin-field ml-2"
        >
          <option value="">Choose a tag</option>
          {book.tropes.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      </label>
      {tag && (
        <button
          type="button"
          disabled={publish.isPending || publish.isSuccess}
          className="skin-control min-h-11 px-3"
          onClick={() => publish.mutate({ bookId: book.id, workId, id: tag.id, name: tag.name })}
        >
          Publish “{tag.name}” to the catalog
        </button>
      )}
      {publish.isSuccess && <p role="status">The tag is in the shared catalog.</p>}
      {publish.isError && (
        <p role="alert">
          Could not publish this tag. Check the saved book and tag before retrying.
        </p>
      )}
    </details>
  )
}
