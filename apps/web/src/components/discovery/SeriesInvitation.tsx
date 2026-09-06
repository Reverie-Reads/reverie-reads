import type { DiscoveryBook } from '@reverie/core'
import { useDiscoverySeries } from '../../data/discoverySeries'
import { Button } from '../Button'
export function SeriesInvitation({ onOpen }: { onOpen: (book: DiscoveryBook) => void }) {
  const invitation = useDiscoverySeries()
  if (!invitation.data) return null
  const { name, after, book } = invitation.data
  return (
    <aside className="discovery-series skin-card">
      <div>
        <p className="discovery-eyebrow">A story you’ve started</p>
        <h2>There’s more of {name}.</h2>
        <p>
          You’ve read {after}. The next cataloged book is {book.title}.
        </p>
      </div>
      <Button variant="secondary" onClick={() => onOpen(book)}>
        See the next book
      </Button>
    </aside>
  )
}
