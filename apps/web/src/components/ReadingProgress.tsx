import { useEffect, useId, useRef, useState, type Ref } from 'react'
import type { Book } from '@reverie/core'
import { useUpdateBook } from '../data/books'
import { Button } from './Button'
import { Modal } from './Modal'
import { ProgressMeter } from './Structure'
import { parseProgress } from './readingProgressValue'

export function ProgressFields({
  value,
  onChange,
  error,
  inputRef,
}: {
  value: string
  onChange: (value: string) => void
  error?: string | null
  inputRef?: Ref<HTMLInputElement>
}) {
  const id = useId()
  const progress = parseProgress(value)
  const meterValue = progress ?? 0
  const change = (next: string) => onChange(next)
  const nudge = (delta: number) => change(String(Math.max(0, Math.min(100, meterValue + delta))))

  return (
    <div>
      <div className="flex items-baseline justify-between gap-3">
        <label htmlFor={`${id}-number`} className="text-[13.5px] font-semibold text-ink">
          Progress (%)
        </label>
        <output className="text-[18px] font-semibold tabular-nums text-ink" aria-live="polite">
          {progress == null ? '—' : `${progress}%`}
        </output>
      </div>
      <ProgressMeter value={meterValue} max={100} className="mt-3" />
      <input
        id={`${id}-range`}
        type="range"
        min={0}
        max={100}
        step={1}
        value={meterValue}
        aria-label="Reading progress slider, percent"
        onChange={(event) => change(event.target.value)}
        className="mt-4 min-h-11 w-full"
        style={{ accentColor: 'var(--primary)' }}
      />
      <div className="mt-2 grid grid-cols-[44px_minmax(0,1fr)_44px] items-end gap-2">
        <Button
          variant="icon"
          onClick={() => nudge(-5)}
          aria-label="Decrease progress by 5 percent"
          disabled={meterValue === 0}
        >
          <span aria-hidden>−</span>
        </Button>
        <input
          id={`${id}-number`}
          type="number"
          min={0}
          max={100}
          step={1}
          inputMode="numeric"
          ref={inputRef}
          value={value}
          aria-invalid={!!error}
          aria-describedby={`${id}-help${error ? ` ${id}-error` : ''}`}
          onChange={(event) => change(event.target.value)}
          className="skin-control h-11 w-full border border-line bg-field px-3 text-center text-[16px] tabular-nums text-ink"
        />
        <Button
          variant="icon"
          onClick={() => nudge(5)}
          aria-label="Increase progress by 5 percent"
          disabled={meterValue === 100}
        >
          <span aria-hidden>+</span>
        </Button>
      </div>
      <p id={`${id}-help`} className="mt-3 text-[12.5px] leading-relaxed text-muted">
        Percent works across print, ebook, and audio. Finishing the book records it in your journal.
      </p>
      {error && (
        <p id={`${id}-error`} role="alert" className="mt-2 text-[13px] font-semibold text-ink">
          {error}
        </p>
      )}
    </div>
  )
}

export function ReadingProgressDialog({
  book,
  onClose,
  onSaved,
}: {
  book: Pick<Book, 'id' | 'title' | 'progress'>
  onClose: () => void
  onSaved?: (progress: number) => void
}) {
  const updateBook = useUpdateBook(book.id)
  const inputRef = useRef<HTMLInputElement>(null)
  const [draft, setDraft] = useState(String(book.progress))
  const [dirty, setDirty] = useState(false)
  const [submitted, setSubmitted] = useState(false)
  const parsed = parseProgress(draft)
  const inputError = submitted && parsed == null ? 'Enter a whole number from 0 to 100.' : null
  const saveError = updateBook.isError ? 'Progress wasn’t saved. Your entry is still here.' : null

  useEffect(() => {
    if (!dirty) setDraft(String(book.progress))
  }, [book.progress, dirty])

  // The nested Modal establishes the native top layer first. This parent effect then puts the
  // caret in the exact entry so keyboard and phone users can begin immediately.
  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  const change = (value: string) => {
    setDraft(value)
    setDirty(value !== String(book.progress))
    setSubmitted(false)
    if (updateBook.isError) updateBook.reset()
  }

  const save = () => {
    setSubmitted(true)
    if (parsed == null || parsed === book.progress) return
    updateBook.mutate(
      { id: book.id, patch: { progress: parsed } },
      {
        onSuccess: () => {
          setDirty(false)
          onSaved?.(parsed)
          onClose()
        },
      },
    )
  }

  const close = () => {
    if (!updateBook.isPending) onClose()
  }

  return (
    <Modal title="Update progress" onClose={close}>
      <form
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          save()
        }}
      >
        <p className="-mt-2 mb-5 break-words text-[14px] text-muted">{book.title}</p>
        <ProgressFields
          value={draft}
          onChange={change}
          error={inputError ?? saveError}
          inputRef={inputRef}
        />
        <div className="mt-5 flex flex-wrap justify-end gap-2">
          <Button variant="ghost" onClick={close} disabled={updateBook.isPending}>
            Cancel
          </Button>
          <Button
            type="submit"
            disabled={updateBook.isPending || (parsed != null && parsed === book.progress)}
          >
            {updateBook.isPending ? 'Saving…' : updateBook.isError ? 'Try again' : 'Save progress'}
          </Button>
        </div>
      </form>
    </Modal>
  )
}
