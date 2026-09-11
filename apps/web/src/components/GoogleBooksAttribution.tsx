import { googleBooksResultUrl } from '../lib/search'
import type { SearchResult } from '../lib/search'

type GoogleBooksLinkedItem = {
  title?: string
  source?: SearchResult['source']
  sourceUrl?: string
}

/** Google's official, unmodified 62x30 "Powered by Google" asset, displayed at natural size. */
export function GoogleBooksAttribution() {
  return (
    <img
      src="/google-books-powered-by.png"
      width={62}
      height={30}
      alt="Powered by Google"
      className="h-[30px] w-[62px] flex-none"
      data-testid="google-books-attribution"
    />
  )
}

/** Prominent provider link required beside every displayed Google Books search result. */
export function GoogleBooksResultLink({ result }: { result: GoogleBooksLinkedItem }) {
  const href = googleBooksResultUrl(result)
  if (!href) return null
  return (
    <a
      href={href}
      target="_blank"
      rel="noreferrer"
      className="inline-flex min-h-11 items-center text-[12px] font-semibold text-ink underline underline-offset-4"
      aria-label={`View ${result.title || 'this book'} on Google Books (opens in a new tab)`}
    >
      View on Google Books ↗
    </a>
  )
}
