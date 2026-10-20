import { useEffect, useRef, useState, type ReactNode } from 'react'
import {
  resolveIntakeEvidence,
  reviewCatalogEvidenceDraft,
  catalogEvidenceDraftKey,
  type CatalogEvidenceDraft,
  type IntakeResolution,
} from '@reverie/core'
import { useAuth } from '../../auth/AuthProvider'
import {
  useApplyCatalogEvidence,
  useCatalogEvidence,
  readCatalogEvidenceAttempt,
  type CatalogEvidenceContext,
  type CatalogEvidenceSave,
} from '../../data/catalogEvidence'
import type { CatalogMetadataWork } from '../../data/corpusMetadataReview'
import { parseReleasePub } from '../../data/releases'
import { Button } from '../Button'

const fieldClass = 'skin-field mt-2 min-h-11 w-full px-3 py-2 text-base'
function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block text-sm">
      {label}
      {children}
    </label>
  )
}
const label = (field: CatalogEvidenceDraft['field']) =>
  ({ description: 'Description', pages: 'Pages', publication: 'Publication date' })[field]
const display = (value: unknown) =>
  value === undefined || value === null
    ? 'Unknown'
    : typeof value === 'string'
      ? value
      : JSON.stringify(value)

/** Provider packets remain transient, untrusted research. No bridge into the save payload. */
function ResearchPacket() {
  const [result, setResult] = useState<IntakeResolution | null>(null)
  const [error, setError] = useState('')
  const epoch = useRef(0)
  useEffect(
    () => () => {
      epoch.current++
    },
    [],
  )
  return (
    <details className="my-4 border border-line p-3">
      <summary className="min-h-11 cursor-pointer text-sm">Inspect a local research packet</summary>
      <p className="my-2 text-sm text-muted">
        Research stays in this browser page. Packet values and permission labels cannot authorize a
        save. Inspect the original source before preparing a separate correction.
      </p>
      <Field label="Evidence request JSON">
        <input
          type="file"
          accept="application/json,.json"
          className={fieldClass}
          onChange={(e) => {
            const run = ++epoch.current
            const file = e.target.files?.[0]
            setResult(null)
            setError('')
            if (!file) return
            if (file.size > 1024 * 1024) {
              setError('Use an evidence packet no larger than 1 MiB.')
              return
            }
            void file
              .text()
              .then((text) => {
                if (epoch.current !== run) return
                try {
                  setResult(resolveIntakeEvidence(JSON.parse(text)))
                } catch {
                  setError('This is not a valid evidence request. No values were imported.')
                }
              })
              .catch(() => {
                if (epoch.current === run) setError('The local file could not be read.')
              })
          }}
        />
      </Field>
      {error && (
        <p role="alert" className="mt-2 text-sm">
          {error}
        </p>
      )}
      {result && (
        <div className="mt-3 space-y-3 text-sm">
          <p>
            Research only · work: {result.work.state} · edition: {result.edition.state}. Target
            fingerprint: <span className="break-all">{result.targetFingerprint}</span>. This is not
            a current catalog check.
          </p>
          {result.request.observations.map((o) => (
            <div key={o.id} className="border-t border-line pt-2">
              <p className="break-words">
                {o.source.provider} · {o.status} · {o.source.recordId}
              </p>
              <p className="break-words">Source reference: {o.source.url}</p>
              <p>
                Holds:{' '}
                {result.observations.find((x) => x.id === o.id)?.reasons.join(', ') ||
                  'No resolver hold; manual source review is still required'}
              </p>
              {o.claims.map((c) => (
                <p key={c.id} className="whitespace-pre-wrap break-words">
                  {c.field} ({c.scope}): {display(c.value)} · {c.locator}
                </p>
              ))}
            </div>
          ))}
          <Button
            variant="ghost"
            onClick={() => {
              epoch.current++
              setResult(null)
            }}
          >
            Clear research packet
          </Button>
        </div>
      )}
    </details>
  )
}

export function CatalogEvidenceReview(props: {
  work: CatalogMetadataWork
  blocked: boolean
  onDirtyChange: (dirty: boolean) => void
  onSaved: (message: string) => void
  onRefresh?: () => void
}) {
  const { session } = useAuth()
  return <EvidencePanel key={`${session?.user.id}:${props.work.id}`} {...props} />
}
function EvidencePanel({
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
  onRefresh?: () => void
}) {
  const context = useCatalogEvidence(work.id)
  const [opened, setOpened] = useState<CatalogEvidenceContext | null>(null)
  const [field, setField] = useState<CatalogEvidenceDraft['field']>('description')
  const [editionId, setEditionId] = useState('')
  const [value, setValue] = useState('')
  const [title, setTitle] = useState('')
  const [author, setAuthor] = useState('')
  const [sourceUrl, setSourceUrl] = useState('')
  const [recordId, setRecordId] = useState('')
  const [locator, setLocator] = useState('')
  const [kind, setKind] = useState<CatalogEvidenceDraft['source']['kind']>('publisher')
  const [explanation, setExplanation] = useState('')
  const [note, setNote] = useState('')
  const [termsUrl, setTermsUrl] = useState('')
  const [termsNote, setTermsNote] = useState('')
  const [basis, setBasis] = useState<'public_terms' | 'written_permission'>('public_terms')
  const [inspected, setInspected] = useState(false)
  const [preview, setPreview] = useState<CatalogEvidenceSave | null>(null)
  const [approved, setApproved] = useState(false)
  const [attempted, setAttempted] = useState(false)
  const [applied, setApplied] = useState(false)
  const [error, setError] = useState('')
  const [rejected, setRejected] = useState(false)
  const [historyChecked, setHistoryChecked] = useState(false)
  const active = useRef(true),
    inflight = useRef(false)
  const save = useApplyCatalogEvidence()
  useEffect(() => {
    active.current = true
    return () => {
      active.current = false
    }
  }, [])
  const snapshot = opened ?? context.data
  const editions = snapshot?.record.editions ?? []
  const edition = editions.find((e) => e.id === editionId)
  const disabled = blocked || attempted || save.isPending
  const current = field === 'description' ? snapshot?.record.description : edition?.details[field]
  function changed() {
    if (!opened && context.data) setOpened(structuredClone(context.data))
    setPreview(null)
    setApproved(false)
    setInspected(false)
    setError('')
    onDirtyChange(true)
  }
  function prepare() {
    if (!snapshot || disabled || !inspected) return
    try {
      const date = parseReleasePub(value.trim())
      const at = new Date().toISOString()
      const draft = reviewCatalogEvidenceDraft(
        {
          version: 1,
          field,
          editionId: field === 'description' ? null : editionId,
          value:
            field === 'description'
              ? value.trim()
              : field === 'pages'
                ? { pages: Number(value) }
                : date && { y: date.y, m: date.m, d: date.d },
          identity: {
            title,
            author,
            isbn: field === 'description' ? null : (edition?.isbn ?? null),
          },
          source: { url: sourceUrl, recordId, locator, checkedAt: at, kind },
          support: {
            explanation,
            scope: field === 'description' ? 'work' : 'edition',
            independentlyChecked: true,
          },
          sourceUse: {
            version: 1,
            basis,
            url: termsUrl,
            note: termsNote,
            checkedAt: at,
            scope: field === 'description' ? 'catalog_description' : 'catalog_edition_facts',
            confirmed: true,
          },
          note,
        },
        at,
      )
      if (!draft.ready) throw new Error('The inspected source or source-use review is stale.')
      setPreview({
        id: crypto.randomUUID(),
        workId: work.id,
        fingerprint: snapshot.fingerprint,
        draft: draft.draft,
      })
      setApproved(false)
      setError('')
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Check the correction before previewing it.')
    }
  }
  async function apply(exactRetry = false) {
    if (
      !preview ||
      !approved ||
      blocked ||
      save.isPending ||
      (attempted && !exactRetry) ||
      inflight.current
    )
      return
    inflight.current = true
    setAttempted(true)
    try {
      await save.mutateAsync(preview)
      if (!active.current) return
      setApplied(true)
      setError('')
      onDirtyChange(false)
      // Keep this receipt mounted even if subsequent history reads fail.
    } catch (e) {
      if (active.current) {
        // A rejection of a later retry cannot prove that an earlier uncertain request failed.
        setRejected(
          !attempted &&
            ['22023', 'PT409', '42501', 'P0002', 'P0001', 'PGRST202'].includes(
              (e as { code?: string })?.code ?? '',
            ),
        )
        setError(
          (e as { message?: string })?.message ??
            'The save result is uncertain. Check history before another decision.',
        )
      }
    } finally {
      inflight.current = false
    }
  }
  async function checkHistory() {
    setHistoryChecked(false)
    let confirmed = applied
    if (preview && attempted) {
      try {
        const read = await readCatalogEvidenceAttempt(work.id, preview.id)
        if (!active.current) return
        if (
          read.attempt?.id === preview.id &&
          catalogEvidenceDraftKey(read.attempt.draft) === catalogEvidenceDraftKey(preview.draft)
        ) {
          setApplied(true)
          confirmed = true
          setError('')
          onDirtyChange(false)
        }
      } catch {
        if (active.current)
          setError(
            'The exact attempted save could not be checked. Keep this draft until recovery succeeds.',
          )
        return
      }
    }
    const read = await context.refetch()
    if (!active.current) return
    if (read.isError) {
      setError(
        confirmed
          ? 'The correction is confirmed, but recent history could not be loaded.'
          : 'History could not be loaded. The original attempted change is still locked.',
      )
      return
    }
    setHistoryChecked(true)
    if (read.data?.history.some((h) => h.id === preview?.id)) {
      setApplied(true)
      setError('')
      onDirtyChange(false)
    }
  }
  return (
    <section aria-label="Evidence-backed correction" className="my-5 border-t border-line pt-4">
      <h3 className="font-semibold">Review a supported fact</h3>
      <p className="mt-2 text-sm text-muted">
        Check one fact at its original source, then review the exact change. Descriptions belong to
        the work; pages and dates belong to the selected published edition. Identity conflicts stay
        under review.
      </p>
      <ResearchPacket />
      {context.isPending ? (
        <p className="text-sm">Loading evidence review…</p>
      ) : context.isError && !snapshot ? (
        <div role="alert" className="text-sm">
          <p>{context.error.message}</p>
          <Button variant="secondary" onClick={() => void context.refetch()}>
            Retry evidence review
          </Button>
        </div>
      ) : (
        snapshot && (
          <>
            {blocked && (
              <p className="my-2 text-sm">Save or discard the other catalog draft first.</p>
            )}
            <form
              className="mt-4 space-y-4"
              onSubmit={(e) => {
                e.preventDefault()
                prepare()
              }}
              onChange={changed}
            >
              <fieldset disabled={disabled} className="space-y-4">
                <legend className="sr-only">Supported fact and inspected source</legend>
                <Field label="Fact to review">
                  <select
                    className={fieldClass}
                    value={field}
                    onChange={(e) => {
                      setField(e.target.value as typeof field)
                      setValue('')
                    }}
                  >
                    <option value="description">Work description</option>
                    <option value="pages">Selected edition pages</option>
                    <option value="publication">Selected edition publication date</option>
                  </select>
                </Field>
                {field !== 'description' && (
                  <Field label="Published edition">
                    <select
                      className={fieldClass}
                      value={editionId}
                      onChange={(e) => setEditionId(e.target.value)}
                    >
                      <option value="">Choose an existing exact edition</option>
                      {editions
                        .filter((e) => e.isbn)
                        .map((e) => (
                          <option key={e.id} value={e.id}>
                            {e.isbn} · {e.details.format ?? 'Format unknown'}
                          </option>
                        ))}
                    </select>
                  </Field>
                )}
                <p className="whitespace-pre-wrap break-words text-sm">
                  Current {label(field).toLowerCase()}: {display(current)}
                </p>
                <Field label="Supported value">
                  {field === 'description' ? (
                    <textarea
                      className={fieldClass}
                      rows={4}
                      maxLength={10000}
                      value={value}
                      onChange={(e) => setValue(e.target.value)}
                    />
                  ) : (
                    <input
                      className={fieldClass}
                      maxLength={10}
                      value={value}
                      placeholder={
                        field === 'pages' ? 'Whole page count' : 'YYYY, YYYY-MM or YYYY-MM-DD'
                      }
                      onChange={(e) => setValue(e.target.value)}
                    />
                  )}
                </Field>
                <Field label="Title at this source">
                  <input
                    className={fieldClass}
                    maxLength={1000}
                    value={title}
                    onChange={(e) => setTitle(e.target.value)}
                  />
                </Field>
                <Field label="Source full author names">
                  <input
                    className={fieldClass}
                    maxLength={2000}
                    value={author}
                    onChange={(e) => setAuthor(e.target.value)}
                  />
                </Field>
                <Field label="Original evidence link">
                  <input
                    type="url"
                    className={fieldClass}
                    maxLength={2000}
                    value={sourceUrl}
                    onChange={(e) => setSourceUrl(e.target.value)}
                  />
                </Field>
                <Field label="Source kind">
                  <select
                    className={fieldClass}
                    value={kind}
                    onChange={(e) => setKind(e.target.value as typeof kind)}
                  >
                    <option value="publisher">Publisher</option>
                    <option value="author">Author</option>
                    <option value="published_book">Published book page</option>
                  </select>
                </Field>
                <Field label="Source record identifier">
                  <input
                    className={fieldClass}
                    maxLength={200}
                    value={recordId}
                    onChange={(e) => setRecordId(e.target.value)}
                  />
                </Field>
                <Field label="Where the fact appears">
                  <input
                    className={fieldClass}
                    maxLength={1000}
                    value={locator}
                    onChange={(e) => setLocator(e.target.value)}
                  />
                </Field>
                <Field label="Why the evidence supports this fact">
                  <textarea
                    className={fieldClass}
                    rows={2}
                    maxLength={1200}
                    value={explanation}
                    onChange={(e) => setExplanation(e.target.value)}
                  />
                </Field>
                <p className="text-sm text-muted">
                  Record your own explanation. Keep restricted source passages in the transient
                  research view. A model’s quotation or interpretation is not independent
                  verification.
                </p>
                <Field label="Permission basis for this field">
                  <select
                    className={fieldClass}
                    value={basis}
                    onChange={(e) => setBasis(e.target.value as typeof basis)}
                  >
                    <option value="public_terms">Applicable public terms</option>
                    <option value="written_permission">Specific written permission</option>
                  </select>
                </Field>
                <Field label="Source-use reference">
                  <input
                    type="url"
                    className={fieldClass}
                    maxLength={2000}
                    value={termsUrl}
                    onChange={(e) => setTermsUrl(e.target.value)}
                  />
                </Field>
                <Field label="How the basis covers retaining and displaying this value">
                  <textarea
                    className={fieldClass}
                    rows={2}
                    maxLength={1000}
                    value={termsNote}
                    onChange={(e) => setTermsNote(e.target.value)}
                  />
                </Field>
                <Field label="Correction note">
                  <textarea
                    className={fieldClass}
                    rows={2}
                    maxLength={1200}
                    value={note}
                    onChange={(e) => setNote(e.target.value)}
                  />
                </Field>
                <label className="flex min-h-11 items-start gap-3 text-sm">
                  <input
                    type="checkbox"
                    className="mt-1"
                    checked={inspected}
                    onChange={(e) => {
                      e.stopPropagation()
                      setInspected(e.target.checked)
                    }}
                  />
                  I independently checked the original source, exact book or edition, support for
                  this fact and the applicable source-use basis.
                </label>
                <Button type="submit" variant="secondary" disabled={!inspected}>
                  Preview supported correction
                </Button>
                <Button
                  variant="ghost"
                  onClick={() => {
                    setValue('')
                    setOpened(null)
                    setPreview(null)
                    setApproved(false)
                    setInspected(false)
                    onDirtyChange(false)
                  }}
                >
                  Discard evidence draft
                </Button>
              </fieldset>
            </form>
            {preview && (
              <div
                aria-label="Supported correction preview"
                className="mt-4 space-y-3 border border-line p-3 text-sm"
              >
                <p>
                  {label(preview.draft.field)}: {display(current)} →{' '}
                  <span className="whitespace-pre-wrap break-words">
                    {display(preview.draft.value)}
                  </span>
                </p>
                <p className="break-words">
                  Source: {preview.draft.source.url} · {preview.draft.source.locator}
                </p>
                <p>
                  {preview.draft.editionId
                    ? `Only published edition ${preview.draft.identity.isbn} changes.`
                    : 'Only the shared work description changes.'}{' '}
                  Other facts, personal values and reading history stay unchanged.
                </p>
                <label className="flex min-h-11 items-start gap-3">
                  <input
                    type="checkbox"
                    className="mt-1"
                    disabled={disabled}
                    checked={approved}
                    onChange={(e) => setApproved(e.target.checked)}
                  />
                  Approve exactly this correction and its recorded evidence.
                </label>
                <Button disabled={disabled || !approved} onClick={() => void apply()}>
                  Apply supported correction
                </Button>
              </div>
            )}
            {applied && (
              <div role="status" className="my-3 space-y-2 border border-line p-3 text-sm">
                <p>Supported correction saved. Personal data and reading history were preserved.</p>
                <Button
                  disabled={blocked}
                  variant="secondary"
                  onClick={() => {
                    onSaved(`Supported correction saved for ${work.title}.`)
                  }}
                >
                  Return to current catalog record
                </Button>
              </div>
            )}
            {error && (
              <p role="alert" className="my-3 text-sm">
                {error}
              </p>
            )}
            <Button className="mt-3" variant="secondary" onClick={() => void checkHistory()}>
              Check evidence history
            </Button>
            {attempted && !applied && (
              <p className="mt-2 text-sm">
                The attempted draft is locked. Check history to recover a saved result.{' '}
                {historyChecked
                  ? 'No matching decision appears in the latest 20 entries; this does not prove the save failed.'
                  : 'A read failure does not prove a save failed.'}
              </p>
            )}
            <ol aria-label="Applied evidence history" className="mt-4 space-y-3 text-sm">
              {context.data?.history.map((h) => (
                <li key={h.id} className="break-words">
                  <p>
                    {label(h.draft.field)} · {new Date(h.applied_at).toLocaleString()}
                  </p>
                  <p>
                    {display(h.previous_value)} → {display(h.draft.value)}
                  </p>
                  <p>
                    {h.draft.source.url} · {h.draft.source.locator}
                  </p>
                  <p>{h.draft.support.explanation}</p>
                  <p>Source-use basis: {h.draft.sourceUse.url}</p>
                </li>
              ))}
            </ol>
          </>
        )
      )}
      {rejected && !applied && onRefresh && (
        <div className="my-3 space-y-2 text-sm">
          <p>
            The server rejected this change without applying it. Reloading explicitly discards this
            draft; it does not rebase or submit it.
          </p>
          <Button variant="secondary" disabled={blocked || save.isPending} onClick={onRefresh}>
            Reload current record and discard rejected draft
          </Button>
        </div>
      )}
      {attempted && !applied && !rejected && historyChecked && (
        <Button
          variant="secondary"
          disabled={blocked || save.isPending}
          onClick={() => void apply(true)}
        >
          Retry exactly this reviewed save
        </Button>
      )}
    </section>
  )
}
