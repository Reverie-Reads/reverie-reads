import { useRef, useState } from 'react'
import { PAGE_COUNT, parseNumericField } from '@reverie/core'
import { parseReleasePub } from '../../data/releases'
import {
  useSaveCatalogEditionCorrection,
  editionPublicationLabel,
  type CatalogMetadataWork,
  type EditionCorrectionInput,
} from '../../data/corpusMetadataReview'
import { Button } from '../Button'

export function CatalogEditionCorrection({
  work,
  blocked,
  onDirtyChange,
  onSaved,
  onRefresh,
}: {
  work: CatalogMetadataWork
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (message: string) => void
  onRefresh: () => void
}) {
  const [field, setField] = useState<'pages' | 'publication'>('pages')
  const [value, setValue] = useState('')
  const [isbn, setIsbn] = useState('')
  const [evidenceTitle, setEvidenceTitle] = useState('')
  const [evidenceAuthor, setEvidenceAuthor] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [note, setNote] = useState('')
  const [preview, setPreview] = useState<EditionCorrectionInput | null>(null)
  const [approved, setApproved] = useState(false)
  const [error, setError] = useState('')
  const [attempted, setAttempted] = useState(false)
  const inflight = useRef(false)
  const save = useSaveCatalogEditionCorrection()
  if (work.editionCorrectionVersion !== 1 || !work.editionFingerprint)
    return (
      <p className="my-4 text-sm text-muted">
        Page and date corrections need the updated server. Reload after deployment.
      </p>
    )

  function changed() {
    setPreview(null)
    setApproved(false)
    setError('')
    onDirtyChange(true)
  }
  function prepare() {
    if (blocked || save.isPending || attempted) return
    setError('')
    const parsedPages = parseNumericField(value, PAGE_COUNT)
    const pub = parseReleasePub(value.trim())
    let correction: EditionCorrectionInput['correction']
    if (field === 'pages') {
      if (!parsedPages.ok || parsedPages.value == null) {
        setError('Enter a whole page count from 1 to 20000. Blank does not clear a value.')
        return
      }
      correction = { field, value: { pages: parsedPages.value } }
    } else {
      if (!pub || pub.y == null) {
        setError('Use a valid YYYY, YYYY-MM, or YYYY-MM-DD. Blank does not clear a date.')
        return
      }
      correction = { field, value: { y: pub.y, m: pub.m, d: pub.d } }
    }
    if (
      !isbn ||
      !evidenceTitle.trim() ||
      !evidenceAuthor.trim() ||
      !note.trim() ||
      !/^https:\/\/[^\s/?#@]+([/?#][^\s]*)?$/.test(sourceUrl.trim())
    ) {
      setError(
        'Choose an ISBN and enter the source title, full contributors, HTTPS link and explanation.',
      )
      return
    }
    setPreview({
      work,
      isbn,
      evidenceTitle,
      evidenceAuthor,
      correction,
      sourceUrl,
      note,
      identityConfirmed: true,
    })
    setApproved(false)
  }
  async function apply() {
    if (!preview || !approved || inflight.current || attempted || blocked) return
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync(preview)
      onSaved(`Edition details corrected for ${work.title}. Personal copies were not changed.`)
    } catch (e) {
      setError(
        (e as { message?: string })?.message ?? 'The correction result could not be confirmed.',
      )
    } finally {
      inflight.current = false
    }
  }
  function discard() {
    setField('pages')
    setValue('')
    setIsbn('')
    setEvidenceTitle('')
    setEvidenceAuthor('')
    setSourceUrl('')
    setNote('')
    setPreview(null)
    setApproved(false)
    setError('')
    onDirtyChange(false)
  }
  const disabled = blocked || save.isPending || attempted
  const current =
    field === 'pages' ? String(work.pages ?? 'Unknown') : editionPublicationLabel(work.publication)
  const next =
    preview?.correction.field === 'pages'
      ? String(preview.correction.value.pages)
      : preview
        ? editionPublicationLabel(preview.correction.value as CatalogMetadataWork['publication'])
        : ''
  return (
    <section aria-label="Edition correction" className="my-5 border-t border-line pt-4">
      <h3 className="font-semibold">Correct pages or publication date</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        These shared values may come from different editions. Choose one reference ISBN and check
        its full identity at the source. A reference describes that edition, not every ISBN here.
        Author or edition conflicts must be resolved separately. No provider lookup runs here.
      </p>
      <p className="mt-2 text-sm">
        Current pages: {work.pages ?? 'Unknown'} · Publication:{' '}
        {editionPublicationLabel(work.publication)}
      </p>
      {!!work.contributors?.length && (
        <p className="mt-2 text-sm text-muted">
          Recorded contributors:{' '}
          {work.contributors
            .map((person) => `${person.name}${person.role ? ` (${person.role})` : ''}`)
            .join(', ')}
          . If these names and the displayed author disagree, resolve identity first.
        </p>
      )}
      {Object.entries(work.editionProvenance ?? {})
        .filter(([, source]) => source?.referenceIsbn)
        .map(([key, source]) => (
          <p key={key} className="mt-1 break-words text-xs text-muted">
            {{
              pages: 'Pages',
              pubY: 'Publication year',
              pubM: 'Publication month',
              pubD: 'Publication day',
            }[key] ?? key}
            : reviewed reference ISBN {source?.referenceIsbn}
          </p>
        ))}
      {blocked && (
        <p className="mt-2 text-sm">
          Save or discard the description draft before correcting edition details.
        </p>
      )}
      <form
        className="mt-4 space-y-4"
        onSubmit={(e) => {
          e.preventDefault()
          prepare()
        }}
      >
        <fieldset disabled={disabled} className="space-y-4">
          <legend className="sr-only">Reference edition and evidence</legend>
          <label className="block text-sm">
            Reference edition ISBN
            <select
              value={isbn}
              onChange={(e) => {
                changed()
                setIsbn(e.target.value)
              }}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            >
              <option value="">Choose an existing ISBN</option>
              {[...new Set(work.isbns)].map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            Title shown by the edition source
            <input
              value={evidenceTitle}
              onChange={(e) => {
                changed()
                setEvidenceTitle(e.target.value)
              }}
              maxLength={1000}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            />
          </label>
          <label className="block text-sm">
            Full contributor names shown by the edition source
            <input
              value={evidenceAuthor}
              onChange={(e) => {
                changed()
                setEvidenceAuthor(e.target.value)
              }}
              maxLength={2000}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            />
          </label>
          <label className="block text-sm">
            Field to correct
            <select
              value={field}
              onChange={(e) => {
                changed()
                setField(e.target.value as 'pages' | 'publication')
                setValue('')
              }}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            >
              <option value="pages">Pages only</option>
              <option value="publication">Publication date only</option>
            </select>
          </label>
          <label className="block text-sm">
            {field === 'pages' ? 'Proposed page count' : 'Proposed publication date'}
            <input
              value={value}
              onChange={(e) => {
                changed()
                setValue(e.target.value)
              }}
              maxLength={10}
              placeholder={field === 'pages' ? 'Whole number' : 'YYYY-MM-DD, YYYY-MM, or YYYY'}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            />
          </label>
          <label className="block text-sm">
            Edition evidence link
            <input
              type="url"
              value={sourceUrl}
              onChange={(e) => {
                changed()
                setSourceUrl(e.target.value)
              }}
              maxLength={2000}
              className="skin-field mt-2 min-h-11 w-full px-3 text-base"
            />
          </label>
          <label className="block text-sm">
            Edition correction explanation
            <textarea
              value={note}
              onChange={(e) => {
                changed()
                setNote(e.target.value)
              }}
              rows={3}
              maxLength={1200}
              className="skin-field mt-2 w-full px-3 py-3 text-base"
            />
          </label>
          <Button type="submit" variant="secondary">
            Preview edition correction
          </Button>
          <Button variant="ghost" onClick={discard}>
            Discard edition draft
          </Button>
        </fieldset>
        {preview && (
          <div
            className="skin-tile space-y-3 border border-line p-3 text-sm"
            aria-label="Correction preview"
          >
            <p>Reference ISBN: {preview.isbn}</p>
            <p>
              {field === 'pages' ? 'Pages' : 'Publication'}: {current} → {next}
            </p>
            <p>
              {field === 'pages'
                ? 'Publication date stays unchanged.'
                : 'Pages stay unchanged. The date replaces year, month and day together; unsupported month/day become unknown.'}
            </p>
            <p>
              Identity, ISBNs, series, covers, personal copies and reading history stay unchanged.
              Other catalog concerns remain open.
            </p>
            <label className="flex min-h-11 items-start gap-3">
              <input
                type="checkbox"
                checked={approved}
                disabled={disabled}
                onChange={(e) => setApproved(e.target.checked)}
                className="mt-1"
              />
              I checked this edition’s full identity and approve exactly this shared-field
              correction.
            </label>
            <Button disabled={disabled || !approved} onClick={() => void apply()}>
              Apply edition correction
            </Button>
          </div>
        )}
        {error && (
          <div role="alert" className="space-y-2 border border-line p-3 text-sm">
            <p>{error}</p>
            {attempted && (
              <>
                <p>
                  Do not repeat an uncertain save. Reload the current record and inspect its history
                  before another decision. Reloading discards this draft.
                </p>
                <Button variant="secondary" onClick={onRefresh}>
                  Reload current record
                </Button>
              </>
            )}
          </div>
        )}
      </form>
    </section>
  )
}
