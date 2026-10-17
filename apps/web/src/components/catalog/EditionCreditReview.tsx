import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import {
  EDITION_CREDIT_HOLDS,
  parseEditionCreditEvidence,
  type EditionCreditEvidence,
} from '@reverie/core'
import {
  applyEditionCredits,
  getEditionCreditReviews,
  prepareEditionCredits,
  type EditionCreditReview as Review,
} from '../../data/editionCredits'
import type { CorpusEdition, CorpusRecord } from '../../data/corpusEditions'
import { catalogError } from '../../data/corpusEditions'
import { Button } from '../Button'

const field = 'skin-field mt-1 min-h-11 w-full min-w-0 border border-line px-3 py-2 text-base'
type Credit = EditionCreditEvidence['credits'][number]
const emptyCredit = (): Credit => ({
  name: '',
  role: 'unknown',
  scope: 'whole',
  basis: 'edition',
  sourceRole: '',
})
const roles: Credit['role'][] = [
  'author',
  'editor',
  'translator',
  'illustrator',
  'narrator',
  'original_story',
  'playwright',
  'foreword',
  'introduction',
  'contributor',
  'unknown',
]

/** Mounted only for a deliberately chosen saved edition in the administrator workspace.
 * Inputs freeze after prepare; saving sends only its server-bound ID and explicit selection. */
export function EditionCreditReview({
  record,
  edition,
  onClose,
  onSaved,
}: {
  record: CorpusRecord
  edition: CorpusEdition
  onClose: () => void
  onSaved: (message: string) => void
}) {
  const queryClient = useQueryClient()
  const [url, setUrl] = useState(''),
    [title, setTitle] = useState(''),
    [authors, setAuthors] = useState('')
  const [isbn, setIsbn] = useState(''),
    [locator, setLocator] = useState('')
  const [kind, setKind] = useState<EditionCreditEvidence['source']['kind']>('unverified')
  const [format, setFormat] = useState(''),
    [language, setLanguage] = useState('')
  const [credits, setCredits] = useState<Credit[]>([emptyCredit()])
  const [checked, setChecked] = useState(false),
    [retention, setRetention] = useState(false)
  const [review, setReview] = useState<Review | null>(null),
    [history, setHistory] = useState<Review[]>([])
  const [selected, setSelected] = useState<number[]>([]),
    [confirmed, setConfirmed] = useState(false)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false),
    [saved, setSaved] = useState(false)
  const pending = useRef(false),
    alive = useRef(true)
  const attempt = useRef<Parameters<typeof prepareEditionCredits>[0] | null>(null)
  const saveSelection = useRef<number[] | null>(null)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
    }
  }, [])
  async function run(action: () => Promise<void>) {
    if (pending.current) return
    pending.current = true
    setBusy(true)
    setError('')
    try {
      await action()
    } catch (e) {
      if (alive.current) setError(catalogError(e))
    } finally {
      pending.current = false
      if (alive.current) setBusy(false)
    }
  }
  const text = (label: string, value: string, update: (v: string) => void) => (
    <label className="block min-w-0 text-sm">
      {label}
      <input className={field} value={value} onChange={(e) => update(e.target.value)} />
    </label>
  )
  function changeCredit(index: number, change: Partial<Credit>) {
    setCredits((old) => old.map((c, n) => (n === index ? { ...c, ...change } : c)))
  }
  async function prepare() {
    await run(async () => {
      if (!attempt.current) {
        const evidence = parseEditionCreditEvidence({
          version: 1,
          source: {
            url,
            kind,
            checkedAt: new Date().toISOString(),
            locator,
            retentionConfirmed: retention,
          },
          identity: {
            title,
            authors: authors
              .split('\n')
              .map((a) => a.trim())
              .filter(Boolean),
            isbn,
            format: format || null,
            language: language || null,
          },
          credits,
          confirmations: {
            sourceChecked: checked,
            identityChecked: checked,
            creditsChecked: checked,
          },
        })
        attempt.current = {
          id: crypto.randomUUID(),
          workId: record.id,
          editionId: edition.id,
          fingerprint: record.fingerprint,
          evidence,
        }
      }
      const next = await prepareEditionCredits(attempt.current)
      if (alive.current) {
        setReview(next)
        setSaved(next.status === 'applied')
      }
    })
  }
  async function save() {
    if (!review || !confirmed || !selected.length) return
    await run(async () => {
      saveSelection.current ??= [...selected]
      await applyEditionCredits(review.id, saveSelection.current)
      if (alive.current) {
        setSaved(true)
        await queryClient.invalidateQueries({ queryKey: ['corpus-record'] })
        if (!alive.current) return
        onSaved(
          'Selected edition credits saved. Personal contributors and reading history are unchanged.',
        )
      }
    })
  }
  async function inspect() {
    await run(async () => {
      const rows = await getEditionCreditReviews(record.id, edition.id)
      if (!alive.current) return
      setHistory(rows)
      const own = rows.find((r) => r.id === attempt.current?.id)
      if (own) {
        setReview(own)
        setSaved(own.status === 'applied')
        if (own.status === 'applied') setSelected(own.selected ?? [])
      }
    })
  }
  return (
    <section
      aria-label="Edition contributor evidence"
      className="mt-4 min-w-0 space-y-4 border-t border-line pt-4 [overflow-wrap:anywhere]"
    >
      <h3 className="font-semibold">Review edition contributors</h3>
      <p className="text-sm">
        {record.title} · {record.author} · ISBN {edition.isbn || 'not recorded'}
      </p>
      <p className="text-sm text-muted">
        Enter bibliographic facts you inspected on an author or publisher page for this edition.
        Preserve its exact names and role labels. A link alone does not verify a credit. Existing
        credits stay unchanged; this list does not claim to be complete.
      </p>
      {!review && !attempt.current && (
        <div className="space-y-3">
          {text('Source page URL', url, setUrl)}
          <label className="block text-sm">
            Source attribution
            <select
              className={field}
              value={kind}
              onChange={(e) => setKind(e.target.value as typeof kind)}
            >
              <option value="unverified">Still unverified</option>
              <option value="publisher">Publisher’s own edition listing</option>
              <option value="author">Author’s own edition listing</option>
            </select>
          </label>
          {text('Source title', title, setTitle)}
          <label className="block text-sm">
            Full creators on the source, one per line
            <textarea
              className={field}
              value={authors}
              onChange={(e) => setAuthors(e.target.value)}
            />
          </label>
          {text('Source ISBN', isbn, setIsbn)}
          <label className="block text-sm">
            Source format
            <select className={field} value={format} onChange={(e) => setFormat(e.target.value)}>
              <option value="">Not stated</option>
              {['paperback', 'hardcover', 'ebook', 'audiobook', 'other'].map((f) => (
                <option key={f}>{f}</option>
              ))}
            </select>
          </label>
          {text('Source language, if stated', language, setLanguage)}
          {text('Where the credits appear on the page', locator, setLocator)}
          {credits.map((c, n) => (
            <fieldset key={n} className="min-w-0 space-y-2 border border-line p-3">
              <legend>Credit {n + 1}</legend>
              {text(`Credit ${n + 1} name`, c.name, (name) => changeCredit(n, { name }))}
              {text(`Credit ${n + 1} original role label`, c.sourceRole ?? '', (sourceRole) =>
                changeCredit(n, { sourceRole }),
              )}
              <label className="block text-sm">
                Credit {n + 1} role
                <select
                  className={field}
                  value={c.role}
                  onChange={(e) => changeCredit(n, { role: e.target.value as Credit['role'] })}
                >
                  {roles.map((r) => (
                    <option key={r} value={r}>
                      {r.replaceAll('_', ' ')}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Credit {n + 1} scope
                <select
                  className={field}
                  value={c.scope}
                  onChange={(e) =>
                    setCredits((old) =>
                      old.map((v, i) =>
                        i !== n
                          ? v
                          : e.target.value === 'part'
                            ? { ...v, scope: 'part', part: '' }
                            : (({ part: _part, ...rest }) => ({ ...rest, scope: 'whole' }))(v),
                      ),
                    )
                  }
                >
                  <option value="whole">Whole book</option>
                  <option value="part">Named part only</option>
                </select>
              </label>
              {c.scope === 'part' &&
                text(`Credit ${n + 1} part`, c.part ?? '', (part) => changeCredit(n, { part }))}
              <label className="block text-sm">
                Credit {n + 1} observed on
                <select
                  className={field}
                  value={c.basis}
                  onChange={(e) => changeCredit(n, { basis: e.target.value as Credit['basis'] })}
                >
                  <option value="edition">This exact edition</option>
                  <option value="work">Work only; edition uncertain</option>
                </select>
              </label>
              {credits.length > 1 && (
                <Button
                  variant="secondary"
                  onClick={() => setCredits((old) => old.filter((_, i) => i !== n))}
                >
                  Remove credit {n + 1} from draft
                </Button>
              )}
            </fieldset>
          ))}
          <Button
            variant="secondary"
            disabled={credits.length >= 32}
            onClick={() => setCredits((old) => [...old, emptyCredit()])}
          >
            Add another credit
          </Button>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I inspected the first-party attribution, exact edition identity and each stated credit.
          </label>
          <label className="flex min-h-11 items-start gap-2 text-sm">
            <input
              type="checkbox"
              checked={retention}
              onChange={(e) => setRetention(e.target.checked)}
            />
            These bibliographic facts may be retained with attribution. This contains no provider
            payloads or private reader data.
          </label>
        </div>
      )}
      {!review && (
        <Button disabled={busy} onClick={() => void prepare()}>
          {attempt.current ? 'Retry the same review' : 'Prepare review'}
        </Button>
      )}
      {review && (
        <div className="space-y-3">
          <p className="text-sm">
            Frozen source:{' '}
            <a
              href={review.evidence.source.url}
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              {review.evidence.source.url}
            </a>
          </p>
          <p className="text-sm">
            {review.evidence.identity.title} · {review.evidence.identity.authors.join(', ')} · ISBN{' '}
            {review.evidence.identity.isbn} ·{' '}
            {review.evidence.identity.format || 'Format not stated'}
            {review.evidence.identity.language ? ` · ${review.evidence.identity.language}` : ''}
          </p>
          <p className="text-sm text-muted">
            {review.evidence.source.locator} · Inspected {review.evidence.source.checkedAt}
          </p>
          {review.stale && !saved && (
            <p role="alert">The catalog changed. Close this review and reload before deciding.</p>
          )}
          {review.decisions.map((d) => {
            const c = review.evidence.credits[d.position]!
            return (
              <div key={d.position} className="border border-line p-3">
                <label className="flex min-h-11 items-start gap-2">
                  <input
                    type="checkbox"
                    disabled={
                      !d.eligible || busy || saved || !!review.stale || !!saveSelection.current
                    }
                    checked={selected.includes(d.position)}
                    onChange={(e) =>
                      setSelected((old) =>
                        e.target.checked
                          ? [...old, d.position]
                          : old.filter((n) => n !== d.position),
                      )
                    }
                  />
                  {c.name} · {c.role.replaceAll('_', ' ')}
                  {c.part ? ` · ${c.part}` : ''}
                </label>
                <p className="text-sm">
                  Source label: {c.sourceRole || 'Not stated'} · {c.basis || 'Scope unverified'}
                </p>
                {d.reasons.map((reason) => (
                  <p key={reason} className="text-sm text-muted">
                    {EDITION_CREDIT_HOLDS[reason]}
                  </p>
                ))}
              </div>
            )
          })}
          {!saved && (
            <>
              <label className="flex min-h-11 items-start gap-2 text-sm">
                <input
                  type="checkbox"
                  disabled={busy || !!saveSelection.current}
                  checked={confirmed}
                  onChange={(e) => setConfirmed(e.target.checked)}
                />
                Save only the selected credits to this shared edition. Leave all other facts under
                review.
              </label>
              <Button
                disabled={busy || !confirmed || !selected.length || !!review.stale}
                onClick={() => void save()}
              >
                {saveSelection.current
                  ? 'Retry the same confirmation'
                  : 'Save selected edition credits'}
              </Button>
            </>
          )}
        </div>
      )}
      {saved && (
        <p role="status">
          Edition credits saved. Personal contributors and reading history are unchanged.
        </p>
      )}
      {error && (
        <p role="alert">{error} Check the saved review before retrying an uncertain response.</p>
      )}
      <div className="flex flex-wrap gap-2">
        <Button variant="secondary" disabled={busy} onClick={() => void inspect()}>
          Check saved reviews
        </Button>
        <Button variant="secondary" disabled={busy} onClick={onClose}>
          Close contributor review
        </Button>
      </div>
      {!!history.length && (
        <ul className="space-y-2 text-sm">
          {history.map((r) => (
            <li key={r.id}>
              {r.status === 'applied'
                ? `${r.selected?.length ?? 0} credits saved`
                : 'Pending review'}{' '}
              · {r.evidence.source.checkedAt} ·{' '}
              {r.evidence.credits.length - (r.selected?.length ?? 0)} credits not applied
              <details className="mt-2">
                <summary className="cursor-pointer underline">Inspect this saved review</summary>
                <p>
                  {r.evidence.identity.title} · ISBN {r.evidence.identity.isbn}
                </p>
                <a
                  href={r.evidence.source.url}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="underline"
                >
                  Source page
                </a>
                <ol className="mt-2 space-y-2">
                  {r.evidence.credits.map((c, n) => (
                    <li key={n}>
                      {c.name} · {c.sourceRole || 'Role not stated'}
                      {c.part ? ` · ${c.part}` : ''}
                      {' · '}
                      {r.selected?.includes(n) ? 'Saved' : 'Not applied; remains under review'}
                    </li>
                  ))}
                </ol>
              </details>
            </li>
          ))}
        </ul>
      )}
    </section>
  )
}
