import { createError, defineEventHandler, getQuery, setResponseHeaders } from 'nitro/h3'
import {
  BookstoreDirectoryInputError,
  fetchBookstoreDirectory,
  parseBookstoreDirectoryQuery,
} from '../server/bookstoreDirectory'

export default defineEventHandler(async (event) => {
  let input
  try {
    input = parseBookstoreDirectoryQuery(getQuery(event))
  } catch (error) {
    if (error instanceof BookstoreDirectoryInputError) {
      throw createError({ statusCode: 400, statusMessage: 'Invalid bookstore search' })
    }
    throw error
  }

  try {
    const payload = await fetchBookstoreDirectory(input)
    // Coordinates are canonical two-decimal grid cells and results contain only public OSM place
    // data. Keep browsers short-lived while the shared CDN absorbs repeat area searches.
    setResponseHeaders(event, {
      'Cache-Control': 'public, max-age=120',
      'Vercel-CDN-Cache-Control':
        'public, s-maxage=604800, stale-while-revalidate=7776000, stale-if-error=7776000',
    })
    return { payload, source: 'web' }
  } catch (error) {
    console.error('Bookstore directory upstream failed', error)
    throw createError({ statusCode: 502, statusMessage: 'Bookstore directory unavailable' })
  }
})
