import { useState } from 'react'
import { Link } from '@tanstack/react-router'
import { Button } from '../Button'
import {
  METADATA_ACTIONS,
  METADATA_ISSUES,
  useCatalogMetadataHistory,
  useSaveCatalogMetadataReview,
  type CatalogMetadataWork,
  type MetadataAction,
} from '../../data/corpusMetadataReview'

function SourceLink({ url }: { url: string }) {
  // Saved evidence is displayed, never fetched or interpreted as code.
  if (!/^https:\/\/[^\s/?#]+[^\s]*$/.test(url)) return null
  return (
    <a href={url} target="_blank" rel="noopener noreferrer" className="break-all underline">
      Open recorded source
    </a>
  )
}
export function CatalogMetadataEditor({
  work: initialWork,
  onSaved,
  onRefresh,
}: {
  work: CatalogMetadataWork
  onSaved: (message: string) => void
  onRefresh: () => void
}) {
  // Keep the reviewed version with its draft even if a background refetch sees a newer record.
  const [work] = useState(initialWork)
  const [description, setDescription] = useState(work.description)
  const [note, setNote] = useState(work.note)
  const [sourceUrl, setSourceUrl] = useState(work.sourceUrl)
  const [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState('')
  const save = useSaveCatalogMetadataReview()
  const history = useCatalogMetadataHistory(work.id)
  const reviewed = confirmed && !!note.trim()
  const descriptionChanged = description.trim() !== work.description

  async function decide(action: MetadataAction) {
    setError('')
    try {
      await save.mutateAsync({
        work,
        action,
        note,
        sourceUrl,
        description,
        identityConfirmed: confirmed,
      })
      onSaved(`${METADATA_ACTIONS[action]} for ${work.title}.`)
    } catch (e) {
      setError(
        e instanceof Error
          ? e.message
          : ((e as { message?: string }).message ?? 'The review could not be saved.'),
      )
    }
  }
  return (
    <article
      className="skin-card min-w-0 border border-line p-4 text-ink sm:p-6"
      style={{ background: 'var(--card-solid)' }}
    >
      <p className="text-xs uppercase tracking-widest text-muted">Shared catalog record</p>
      <h2
        className="mt-2 break-words text-2xl leading-snug"
        style={{ fontFamily: 'var(--font-display)' }}
      >
        {work.title}
      </h2>
      <p className="mt-1 text-sm text-muted">{work.author || 'Author not recorded'}</p>
      <p className="mt-3 text-sm">
        {[work.year, work.publisher, work.language].filter(Boolean).join(' · ') ||
          'Edition details not recorded'}
      </p>
      <p className="mt-2 break-words text-sm">ISBNs: {work.isbns.join(', ') || 'None recorded'}</p>
      <ul aria-label="Metadata concerns" className="my-4 space-y-1 text-sm">
        {work.issues.map((issue) => (
          <li key={issue}>{METADATA_ISSUES[issue]}</li>
        ))}
      </ul>
      {!!work.related.length && (
        <section className="my-5 border-t border-line pt-4">
          <h3 className="font-semibold">Compare related records</h3>
          <p className="mt-2 text-sm leading-relaxed text-muted">
            Matching identifiers can mean a duplicate, an edition, or incorrect catalog data.
            Compare the evidence before recording your assessment. This workspace does not merge
            records or move ISBNs.
          </p>
          <ul className="mt-3 space-y-3">
            {work.related.map((peer) => (
              <li key={peer.id} className="skin-tile border border-line p-3 text-sm">
                <Link
                  to="/catalog/metadata"
                  search={{ state: 'all', issue: 'all', q: '', page: 0, work: peer.id }}
                  className="font-semibold underline"
                >
                  {peer.title}
                </Link>
                <p>{peer.author || 'Author not recorded'}</p>
                <p className="mt-2 text-muted">
                  {[
                    peer.isbn_match && 'Shared ISBN',
                    peer.identity_match && 'Same normalized title and author',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <p className="mt-2 break-words">
                  ISBNs: {peer.isbns.join(', ') || 'None recorded'}
                </p>
                <p className="mt-1">
                  {[peer.pub_y, peer.publisher, peer.language].filter(Boolean).join(' · ') ||
                    'Edition details not recorded'}
                </p>
                <p className="mt-2 whitespace-pre-wrap leading-relaxed">
                  {peer.description || 'No description recorded.'}
                </p>
              </li>
            ))}
          </ul>
          {work.relatedTotal > work.related.length && (
            <p className="mt-2 text-sm text-muted">
              Showing {work.related.length} of {work.relatedTotal} related records. Search an ISBN
              to inspect more.
            </p>
          )}
        </section>
      )}
      {work.descriptionSource && (
        <p className="mb-3 text-sm">
          <SourceLink url={work.descriptionSource} />
        </p>
      )}
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void decide('description')
        }}
        className="mt-5 space-y-4"
      >
        <label className="block text-sm font-semibold">
          Catalog description
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            maxLength={12000}
            rows={7}
            className="skin-field mt-2 min-h-40 w-full resize-y px-3 py-3 text-base font-normal leading-relaxed"
            placeholder="A concise description of this book"
          />
        </label>
        <p className="text-sm leading-relaxed text-muted">
          Use a description you have permission to share, or write a brief summary in your own words
          from a checked source. Saving changes the shared catalog only.
        </p>
        <label className="block text-sm font-semibold">
          Evidence source link
          <input
            type="url"
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            maxLength={2000}
            placeholder="https://…"
            className="skin-field mt-2 min-h-11 w-full px-3 text-base font-normal"
          />
        </label>
        <label className="block text-sm font-semibold">
          Assessment note
          <textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            maxLength={1200}
            className="skin-field mt-2 w-full resize-y px-3 py-3 text-base font-normal leading-relaxed"
            placeholder="What did you check? What still needs attention?"
          />
        </label>
        <label className="flex min-h-11 items-start gap-3 text-sm leading-relaxed">
          <input
            type="checkbox"
            checked={confirmed}
            onChange={(e) => setConfirmed(e.target.checked)}
            className="mt-1"
          />
          I checked the title, author, and relevant edition evidence for this record.
        </label>
        {error && (
          <div role="alert" className="border border-line p-3 text-sm">
            <p>{error}</p>
            <Button variant="secondary" onClick={onRefresh}>
              Reload current record
            </Button>
            <p className="mt-2 text-muted">
              Reloading replaces this draft with the current catalog details.
            </p>
          </div>
        )}
        {descriptionChanged && (
          <p className="text-sm text-muted">
            You have an unsaved description. Save it before recording another decision, or{' '}
            <button
              type="button"
              className="underline"
              onClick={() => setDescription(work.description)}
            >
              discard the description draft
            </button>
            .
          </p>
        )}
        <div className="flex flex-wrap gap-2">
          <Button
            type="submit"
            disabled={
              save.isPending ||
              !reviewed ||
              !description.trim() ||
              description.trim() === work.description ||
              !/^https:\/\//.test(sourceUrl.trim())
            }
          >
            Save description
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || !reviewed || descriptionChanged}
            onClick={() => void decide('reviewed')}
          >
            Record assessment
          </Button>
          <Button
            variant="secondary"
            disabled={save.isPending || descriptionChanged}
            onClick={() => void decide('defer')}
          >
            Set aside for later
          </Button>
          {work.state !== 'open' && (
            <Button
              variant="ghost"
              disabled={save.isPending || descriptionChanged}
              onClick={() => void decide('reopen')}
            >
              Reopen review
            </Button>
          )}
        </div>
        <p className="text-sm leading-relaxed text-muted">
          An assessment records what you found; it does not certify the book as correct. Saving a
          description keeps any identity concerns open. Personal copies, notes, and reading history
          stay with their readers.
        </p>
      </form>
      <section className="mt-6 border-t border-line pt-4">
        <h3 className="font-semibold">Recent review history</h3>
        {history.isPending ? (
          <p className="mt-2 text-sm text-muted">Loading history…</p>
        ) : history.isError ? (
          <Button variant="secondary" onClick={() => void history.refetch()}>
            Retry history
          </Button>
        ) : !history.data.length ? (
          <p className="mt-2 text-sm text-muted">No decisions recorded yet.</p>
        ) : (
          <ol className="mt-3 space-y-4 text-sm">
            {history.data.map((event) => (
              <li key={event.id}>
                <p className="font-semibold">{METADATA_ACTIONS[event.action]}</p>
                <time className="text-muted" dateTime={event.created_at}>
                  {new Date(event.created_at).toLocaleString()}
                </time>
                <p className="mt-1 whitespace-pre-wrap break-words">
                  {event.next_value.review.note}
                </p>
                <SourceLink url={event.next_value.review.source_url} />
              </li>
            ))}
          </ol>
        )}
      </section>
    </article>
  )
}
