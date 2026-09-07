import { useMemo } from 'react'
import { buildReadingHistory } from '@reverie/core'
import { useBooks } from './books'
import { useAllReads } from './reads'

/** Reads are a separate query. A pending or failed query is never an empty reading life. */
export function useReadingHistory() {
  const books = useBooks()
  const reads = useAllReads()
  const data = useMemo(() => {
    if (!books.data || !reads.data) return undefined
    return buildReadingHistory(books.data, reads.data.map((read) => ({
      id: read.id, bookId: read.book_id, date: read.read_on,
      format: read.format, rating: read.rating, notes: read.notes,
    })))
  }, [books.data, reads.data])
  return {
    data,
    isError: books.isError || reads.isError,
    isFetching: books.isFetching || reads.isFetching,
    isPaused: books.fetchStatus === 'paused' || reads.fetchStatus === 'paused',
    refetch: () => Promise.all([books.refetch(), reads.refetch()]),
  }
}
