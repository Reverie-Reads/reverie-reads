import type { CorpusEdition, CorpusRecord } from '../../data/corpusEditions'
import { editionPublicationLabel } from '../../data/corpusMetadataReview'

export function EditionFacts({ edition }: { edition: CorpusEdition }) {
  const d = edition.details
  const facts = [
    ['ISBN', edition.isbn || 'Not recorded'],
    ['Edition', d.statement || 'Not recorded'],
    ['Format', d.format || 'Not recorded'],
    ['Publisher', d.publisher || 'Not recorded'],
    ['Language', d.language || 'Not recorded'],
    ['Pages', d.pages == null ? 'Not recorded' : String(d.pages)],
    ['Published', editionPublicationLabel(d.publication ?? undefined)],
  ]
  return (
    <div className="min-w-0 space-y-3">
      <dl className="grid min-w-0 grid-cols-2 gap-x-5 gap-y-2 text-sm">
        {facts.map(([label, value]) => (
          <div key={label} className="min-w-0">
            <dt className="text-muted">{label}</dt>
            <dd className="break-words">{value}</dd>
          </div>
        ))}
      </dl>
      {!!edition.credits?.length && (
        <section aria-label="Reviewed edition credits" className="space-y-2 text-sm">
          <h4 className="font-semibold">Edition credit evidence</h4>
          <p className="text-muted">
            Individual supported credits; the list may be incomplete. Personal contributors stay
            separate.
          </p>
          <ol className="space-y-2">
            {edition.credits.map((entry) => (
              <li key={`${entry.reviewId}:${entry.position}`} className="break-words">
                {entry.credit.name} · {entry.credit.role.replaceAll('_', ' ')}
                {entry.credit.part ? ` · ${entry.credit.part}` : ''}
                {entry.reviewRequired && (
                  <p className="font-semibold">
                    Needs renewed review: the work or edition identity changed.
                  </p>
                )}
                <span className="block text-muted">
                  Source label: {entry.credit.sourceRole || 'Not stated'}
                </span>
                <span className="block text-muted">
                  Reviewed source ISBN: {entry.identity.isbn}
                </span>
                <a
                  href={entry.source.url}
                  className="underline"
                  target="_blank"
                  rel="noopener noreferrer"
                >
                  Credit source
                </a>
              </li>
            ))}
          </ol>
        </section>
      )}
    </div>
  )
}
export function CorpusGuidance({ record }: { record: CorpusRecord }) {
  const genres = [...new Set([record.genre, ...record.genres].filter(Boolean))]
  const subs = [...new Set([record.subgenre, ...record.subgenres].filter(Boolean))]
  return (
    <div className="min-w-0 space-y-2 break-words text-sm">
      <p>
        <span className="text-muted">Genres: </span>
        {genres.join(' · ') || 'Not recorded'}
      </p>
      {subs.length > 0 && (
        <p>
          <span className="text-muted">Subgenres: </span>
          {subs.join(' · ')}
        </p>
      )}
      <p>
        <span className="text-muted">Spice / sexual content: </span>
        {record.spice == null ? 'Not assessed' : `${record.spice}/5`}
      </p>
      <p>
        <span className="text-muted">Darkness / emotional intensity: </span>
        {record.darkness == null ? 'Not assessed' : `${record.darkness}/5`}
      </p>
      {(record.spice != null || record.darkness != null) && (
        <p className="text-muted">
          Shared guidance is an assessment. Your personal levels stay yours.
        </p>
      )}
      {record.guidanceSource?.sourceRef &&
        /^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(record.guidanceSource.sourceRef) && (
          <a
            href={record.guidanceSource.sourceRef}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-block underline"
          >
            Guidance source
          </a>
        )}
    </div>
  )
}
