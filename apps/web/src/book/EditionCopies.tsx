import { cloneElement, useId, useRef, useState, type ReactElement } from 'react'
import {
  COPY_STATES,
  EDITION_FORMATS,
  EDITION_FORMAT_LABELS,
  newCopy,
  newEdition,
  parseCopyInventory,
  prepareCopyInventory,
  type Book,
  type CopyInventory,
  type LibraryEdition,
} from '@reverie/core'
import { Modal } from '../components/Modal'
import { Surface } from '../components/Surface'
import { useSaveCopyInventory } from '../data/copyInventory'

const control =
  'skin-control min-h-11 bg-[var(--card-solid)] border border-line px-3 py-2 text-[14px] font-semibold text-ink'
const field =
  'w-full min-w-0 min-h-11 skin-field border border-line bg-[var(--card-solid)] px-3 py-2 text-[16px] leading-normal text-ink'
const stateLabel = { owned: 'Owned', borrowed: 'Borrowed', wishlist: 'Wishlist', unset: 'Not set' }
function Field({ label, children }: { label: string; children: ReactElement<{ id?: string }> }) {
  const id = useId()
  return (
    <div className="min-w-0 text-[13px] text-muted">
      <label htmlFor={id} className="mb-1 block">
        {label}
      </label>
      {cloneElement(children, { id })}
    </div>
  )
}
function EditionArtwork({ edition }: { edition: LibraryEdition }) {
  const [failed, setFailed] = useState(false)
  return (
    <div className="flex aspect-[2/3] w-16 shrink-0 items-center justify-center overflow-hidden rounded-[var(--radius-card)] border border-line bg-[var(--card-solid)] text-center text-[11px] text-muted">
      {edition.cover && !failed ? (
        <img
          src={edition.cover}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => setFailed(true)}
        />
      ) : (
        <span className="px-1 leading-relaxed">{EDITION_FORMAT_LABELS[edition.format]}</span>
      )}
    </div>
  )
}
export function EditionCopies({ book }: { book: Book }) {
  const [editing, setEditing] = useState(false)
  const inventory = book.copyInventory
  return (
    <Surface tone="card" radius="card" pad={3}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-[16px] font-semibold text-ink">Your editions &amp; copies</h3>
          <p className="mt-1 text-[13px] text-muted">
            {inventory
              ? `${inventory.copies.length} copy records · ${inventory.editions.length} editions`
              : 'Keep paperbacks, hardbacks and special editions together.'}
          </p>
        </div>
        <button type="button" className={control} onClick={() => setEditing(true)}>
          {inventory ? 'Manage copies' : 'Set up editions & copies'}
        </button>
      </div>
      {inventory && (
        <div className="mt-4 space-y-3">
          {inventory.editions.map((edition) => (
            <section
              key={edition.id}
              aria-label={edition.label || EDITION_FORMAT_LABELS[edition.format]}
              className="flex min-w-0 gap-3 border-t border-line pt-3"
            >
              <EditionArtwork key={`${edition.id}:${edition.cover}`} edition={edition} />
              <div className="min-w-0 flex-1">
                <h4 className="break-words text-[15px] font-semibold leading-snug text-ink">
                  {edition.label || EDITION_FORMAT_LABELS[edition.format]}
                </h4>
                {edition.label && (
                  <p className="text-[13px] text-muted">{EDITION_FORMAT_LABELS[edition.format]}</p>
                )}
                <p className="break-words text-[12px] text-muted">
                  {[
                    edition.publisher,
                    edition.published,
                    edition.isbn && `ISBN ${edition.isbn}`,
                    edition.pages && `${edition.pages} pages`,
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                </p>
                <ul className="mt-2 space-y-1 text-[13px] text-ink">
                  {inventory.copies
                    .filter((c) => c.editionId === edition.id)
                    .map((copy, index) => (
                      <li key={copy.id} className="break-words">
                        <span className="font-semibold">{copy.label || `Copy ${index + 1}`}</span> ·{' '}
                        {stateLabel[copy.state]}
                        {copy.location && <span className="text-muted"> · {copy.location}</span>}
                      </li>
                    ))}
                </ul>
                {!inventory.copies.some((c) => c.editionId === edition.id) && (
                  <p className="mt-2 text-[13px] text-muted">No copies recorded</p>
                )}
              </div>
            </section>
          ))}
          {!inventory.editions.length && (
            <p className="text-[14px] text-muted">
              No editions recorded. Your reading history is still here.
            </p>
          )}
        </div>
      )}
      {editing && <CopyEditor book={book} onClose={() => setEditing(false)} />}
    </Surface>
  )
}
function CopyEditor({ book, onClose }: { book: Book; onClose: () => void }) {
  const [draft, setDraft] = useState<CopyInventory>(() => prepareCopyInventory(book))
  const [revision] = useState(book.copyInventoryRevision ?? 0)
  const [error, setError] = useState('')
  const [dirty, setDirty] = useState(false)
  const [confirmClose, setConfirmClose] = useState(false)
  const saving = useRef(false)
  const save = useSaveCopyInventory(book.id)
  const change = (next: CopyInventory) => {
    setDraft(next)
    setDirty(true)
    setError('')
  }
  const editionChange = (id: string, patch: Partial<LibraryEdition>) =>
    change({
      ...draft,
      editions: draft.editions.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    })
  const requestClose = () => {
    if (saving.current) return
    if (dirty) setConfirmClose(true)
    else onClose()
  }
  async function submit() {
    if (saving.current) return
    if (!parseCopyInventory(draft)) {
      setError(
        'Check ISBNs, publication dates (YYYY, YYYY-MM or YYYY-MM-DD), page counts (1–20,000) and HTTPS cover links. Google Books images cannot be saved as edition covers.',
      )
      return
    }
    saving.current = true
    setError('')
    try {
      await save.mutateAsync({ inventory: draft, revision })
      onClose()
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Could not save. Your draft is still here.')
    } finally {
      saving.current = false
    }
  }
  return (
    <Modal title="Editions & copies" wide onClose={requestClose}>
      <p className="mb-4 text-[14px] leading-relaxed text-muted">
        {!book.copyInventory
          ? 'Your old format choices did not record quantities. Review these suggested entries, including which edition is owned, borrowed or wanted, before saving.'
          : 'Keep each edition and copy here. Reading progress, notes and history stay with this book.'}
      </p>
      <form
        onSubmit={(e) => {
          e.preventDefault()
          void submit()
        }}
      >
        <fieldset disabled={save.isPending} className="min-w-0 space-y-5">
          {draft.editions.map((edition, index) => (
            <section
              key={edition.id}
              aria-label={`Edition ${index + 1}`}
              className="min-w-0 space-y-3 rounded-[var(--radius-card)] border border-line bg-[var(--card-solid)] p-3"
            >
              <div className="flex items-center justify-between gap-2">
                <h3 className="font-semibold text-ink">Edition {index + 1}</h3>
                <button
                  type="button"
                  className={control}
                  disabled={draft.copies.some((c) => c.editionId === edition.id)}
                  onClick={() =>
                    change({
                      ...draft,
                      editions: draft.editions.filter((e) => e.id !== edition.id),
                    })
                  }
                >
                  Remove edition
                </button>
              </div>
              <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                <Field label="Edition name">
                  <input
                    className={field}
                    maxLength={160}
                    placeholder="e.g. Signed anniversary edition"
                    value={edition.label}
                    onChange={(e) => editionChange(edition.id, { label: e.target.value })}
                  />
                </Field>
                <Field label="Format">
                  <select
                    className={field}
                    value={edition.format}
                    onChange={(e) =>
                      editionChange(edition.id, {
                        format: e.target.value as LibraryEdition['format'],
                      })
                    }
                  >
                    {EDITION_FORMATS.map((format) => (
                      <option key={format} value={format}>
                        {EDITION_FORMAT_LABELS[format]}
                      </option>
                    ))}
                  </select>
                </Field>
              </div>
              <details>
                <summary className="min-h-11 cursor-pointer py-3 text-[14px] font-semibold text-ink">
                  Edition details
                </summary>
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <Field label="ISBN (optional)">
                    <input
                      className={field}
                      maxLength={32}
                      value={edition.isbn}
                      onChange={(e) => editionChange(edition.id, { isbn: e.target.value })}
                    />
                  </Field>
                  <Field label="Publisher">
                    <input
                      className={field}
                      maxLength={160}
                      value={edition.publisher}
                      onChange={(e) => editionChange(edition.id, { publisher: e.target.value })}
                    />
                  </Field>
                  <Field label="Publication date">
                    <input
                      className={field}
                      placeholder="YYYY, YYYY-MM or YYYY-MM-DD"
                      maxLength={10}
                      value={edition.published}
                      onChange={(e) => editionChange(edition.id, { published: e.target.value })}
                    />
                  </Field>
                  <Field label="Pages">
                    <input
                      className={field}
                      type="number"
                      min={1}
                      max={20000}
                      step={1}
                      value={edition.pages ?? ''}
                      onChange={(e) =>
                        editionChange(edition.id, {
                          pages: e.target.value === '' ? null : Number(e.target.value),
                        })
                      }
                    />
                  </Field>
                  <div className="sm:col-span-2">
                    <Field label="Cover image link (HTTPS)">
                      <input
                        className={field}
                        type="url"
                        maxLength={2048}
                        value={edition.cover}
                        onChange={(e) => editionChange(edition.id, { cover: e.target.value })}
                      />
                    </Field>
                  </div>
                </div>
              </details>
              <div className="space-y-3 border-t border-line pt-3">
                {draft.copies
                  .filter((copy) => copy.editionId === edition.id)
                  .map((copy, copyIndex) => (
                    <fieldset key={copy.id} className="grid min-w-0 gap-3 sm:grid-cols-2">
                      <legend className="mb-2 text-[14px] font-semibold text-ink">
                        Copy {copyIndex + 1}
                      </legend>
                      <Field label="Possession">
                        <select
                          className={field}
                          value={copy.state}
                          onChange={(e) =>
                            change({
                              ...draft,
                              copies: draft.copies.map((c) =>
                                c.id === copy.id
                                  ? { ...c, state: e.target.value as typeof c.state }
                                  : c,
                              ),
                            })
                          }
                        >
                          {COPY_STATES.map((state) => (
                            <option key={state} value={state}>
                              {stateLabel[state]}
                            </option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Copy name">
                        <input
                          className={field}
                          placeholder="e.g. Signed copy"
                          maxLength={160}
                          value={copy.label}
                          onChange={(e) =>
                            change({
                              ...draft,
                              copies: draft.copies.map((c) =>
                                c.id === copy.id ? { ...c, label: e.target.value } : c,
                              ),
                            })
                          }
                        />
                      </Field>
                      <Field label="Location (private)">
                        <input
                          className={field}
                          placeholder="e.g. Living room shelf"
                          maxLength={160}
                          value={copy.location}
                          onChange={(e) =>
                            change({
                              ...draft,
                              copies: draft.copies.map((c) =>
                                c.id === copy.id ? { ...c, location: e.target.value } : c,
                              ),
                            })
                          }
                        />
                      </Field>
                      <button
                        type="button"
                        className={`${control} self-end`}
                        onClick={() =>
                          change({ ...draft, copies: draft.copies.filter((c) => c.id !== copy.id) })
                        }
                      >
                        Remove copy {copyIndex + 1}
                      </button>
                    </fieldset>
                  ))}
                <button
                  type="button"
                  className={control}
                  disabled={draft.copies.length >= 500}
                  onClick={() =>
                    change({ ...draft, copies: [...draft.copies, newCopy(edition.id)] })
                  }
                >
                  Add another copy
                </button>
                <p className="text-[12px] text-muted">
                  Remove an edition’s copies first to remove the edition. Changes apply when you
                  save.
                </p>
              </div>
            </section>
          ))}
          <button
            type="button"
            className={control}
            disabled={draft.editions.length >= 100 || draft.copies.length >= 500}
            onClick={() => {
              const edition = newEdition()
              change({
                ...draft,
                editions: [...draft.editions, edition],
                copies: [...draft.copies, newCopy(edition.id)],
              })
            }}
          >
            Add another edition
          </button>
          {error && (
            <p role="alert" className="text-[14px] leading-relaxed text-ink">
              {error}
            </p>
          )}
          {confirmClose && (
            <div className="space-y-2 border-t border-line pt-3">
              <p className="text-[14px] text-ink">Discard these unsaved copy changes?</p>
              <button type="button" className={control} onClick={onClose}>
                Discard changes
              </button>{' '}
              <button type="button" className={control} onClick={() => setConfirmClose(false)}>
                Keep editing
              </button>
            </div>
          )}
          <div className="flex flex-wrap gap-2 border-t border-line pt-4">
            <button type="submit" className={control}>
              {save.isPending ? 'Saving…' : 'Save editions & copies'}
            </button>
            <button type="button" className={control} onClick={requestClose}>
              Cancel
            </button>
          </div>
        </fieldset>
      </form>
    </Modal>
  )
}
