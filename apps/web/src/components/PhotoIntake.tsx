import { useEffect, useRef, useState } from 'react'
import { bookBarcode, validPhotoBox, type PhotoBox } from '@reverie/core'
import { createBarcodeDecoder } from '../scanning/barcodeDecoder'
import { loadLocalPhoto, photoCropCanvas, type LocalPhoto } from '../scanning/photoInput'
import { Surface } from './Surface'

type Kind = 'cover' | 'title' | 'copyright'
type Capture = {
  kind: Kind
  photo: LocalPhoto
  crop: PhotoBox
  barcodeStatus: string
  isbns: string[]
}
export interface ReviewedPhotoIdentity {
  title: string
  authors: string[]
  isbn?: string
}
const control = 'skin-control skin-btn-secondary min-h-11 px-3 text-sm'
const field = 'skin-field min-h-11 w-full border border-line px-3 text-sm text-ink'

/** Development-only host. Local pixels never become cover bytes or a resolver-approved Book. */
export function PhotoIntake({
  onSearch,
  onReview,
  disabled = false,
}: {
  onSearch: (query: string) => void
  onReview: (identity: ReviewedPhotoIdentity) => void
  disabled?: boolean
}) {
  const [captures, setCaptures] = useState<Capture[]>([])
  const [busy, setBusy] = useState(false),
    [error, setError] = useState('')
  const [title, setTitle] = useState(''),
    [authors, setAuthors] = useState(''),
    [isbn, setIsbn] = useState('')
  const [text, setText] = useState(''),
    [permission, setPermission] = useState(false),
    [checked, setChecked] = useState(false)
  const generation = useRef(0),
    current = useRef<Capture[]>([]),
    active = useRef(true)
  // Keep originals page-session only, account-separated by the host key. Stop late decoder work.
  useEffect(() => {
    active.current = true
    const hide = () => {
      if (document.hidden) {
        generation.current++
        setBusy(false)
      }
    }
    document.addEventListener('visibilitychange', hide)
    return () => {
      document.removeEventListener('visibilitychange', hide)
      active.current = false
      // Generation is a cancellation counter, not a DOM ref captured by this effect.
      // eslint-disable-next-line react-hooks/exhaustive-deps
      generation.current++
      current.current.forEach((c) => c.photo.dispose())
      current.current = []
    }
  }, [])
  const change = (next: Capture[]) => {
    current.current = next
    setCaptures(next)
    setChecked(false)
  }
  const upload = async (file: File, kind: Kind) => {
    const run = ++generation.current
    setBusy(true)
    setError('')
    setChecked(false)
    let photo: LocalPhoto | null = null
    try {
      photo = await loadLocalPhoto(file)
      if (!active.current || run !== generation.current) {
        photo.dispose()
        return
      }
      let isbns: string[] = [],
        barcodeStatus = 'Barcode recognition failed; enter the printed ISBN or retry explicitly.'
      try {
        const decode = await createBarcodeDecoder()
        const values = await decode(photo.canvas)
        isbns = [...new Set(values.map(bookBarcode).filter(Boolean))]
        barcodeStatus = isbns.length
          ? 'Observed book barcodes; choose only the ISBN for this edition.'
          : 'No readable book barcode observed. This does not mean the book has no ISBN.'
      } catch {
        /* A decoder failure stays distinct from successful absence. */
      }
      if (!active.current || run !== generation.current) {
        photo.dispose()
        return
      }
      const prior = current.current.find((c) => c.kind === kind)
      change([
        ...current.current.filter((c) => c.kind !== kind),
        {
          kind,
          photo,
          crop: { x: 0, y: 0, width: photo.canvas.width, height: photo.canvas.height },
          barcodeStatus,
          isbns,
        },
      ])
      prior?.photo.dispose()
    } catch (cause) {
      photo?.dispose()
      if (active.current && run === generation.current) setError((cause as Error).message)
    } finally {
      if (active.current && run === generation.current) setBusy(false)
    }
  }
  const invalidIsbn = !!isbn.trim() && !bookBarcode(isbn)
  const canReview =
    !!title.trim() &&
    permission &&
    checked &&
    !!captures.length &&
    !invalidIsbn &&
    !busy &&
    !disabled
  return (
    <Surface tone="card" radius="card" pad={3} className="my-4 space-y-3">
      <h2 className="text-lg text-ink">Review one book from photos · local pilot</h2>
      <p className="text-sm text-muted">
        Photos and transcription stay on this page until you leave or reload. Nothing here saves a
        book, uploads an original, changes a cover, or counts copies. Replacing a photo never means
        another copy.
      </p>
      <label className="flex items-start gap-2 text-sm text-ink">
        <input
          type="checkbox"
          checked={permission}
          disabled={disabled || busy}
          onChange={(e) => {
            setPermission(e.target.checked)
            setChecked(false)
          }}
        />
        I have permission to process these photos locally.
      </label>
      <p className="text-sm text-muted">
        Use static PNG or JPEG, at most 20 MB and 16 million pixels each. HEIC requires the local
        photo preparation command first. Recognition is local barcode detection; browser text
        recognition is unavailable. Enter text you checked against the pixels. Local Apple Vision
        OCR is available in the separate preparation command; there is no model fallback.
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        {(['cover', 'title', 'copyright'] as Kind[]).map((kind) => (
          <label key={kind} className="text-sm text-ink">
            {kind === 'cover'
              ? 'Cover photo'
              : kind === 'title'
                ? 'Title-page photo'
                : 'Copyright-page photo'}
            <input
              className="mt-1 block w-full text-xs"
              type="file"
              accept="image/png,image/jpeg"
              capture="environment"
              disabled={!permission || busy || disabled}
              onChange={(e) => {
                const f = e.target.files?.[0]
                e.target.value = ''
                if (f) void upload(f, kind)
              }}
            />
          </label>
        ))}
      </div>
      {busy && (
        <p role="status" className="text-sm text-ink">
          Preparing private pixels and reading barcodes…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-ink">
          {error}
        </p>
      )}
      {captures.map((c) => (
        <figure key={c.kind} className="space-y-2 border-t border-line pt-3">
          <figcaption className="text-sm text-ink">
            {c.kind} · {c.photo.canvas.width} × {c.photo.canvas.height}. Full-photo crop proposed;
            adjust only after inspecting the whole photo.
          </figcaption>
          <div className="relative mx-auto max-w-sm">
            <img src={c.photo.url} alt={`${c.kind} source pixels`} className="block w-full" />
            {validPhotoBox(c.crop, c.photo.canvas) && (
              <div
                aria-hidden="true"
                className="pointer-events-none absolute border-2 border-ink"
                style={{
                  left: `${(100 * c.crop.x) / c.photo.canvas.width}%`,
                  top: `${(100 * c.crop.y) / c.photo.canvas.height}%`,
                  width: `${(100 * c.crop.width) / c.photo.canvas.width}%`,
                  height: `${(100 * c.crop.height) / c.photo.canvas.height}%`,
                }}
              />
            )}
          </div>
          <details>
            <summary className="min-h-11 cursor-pointer text-sm text-ink">
              Crop coordinates and provenance
            </summary>
            <p className="text-sm text-muted">
              Top-left normalized pixels, no scaling. Original EXIF orientation:{' '}
              {c.photo.orientation}. Cropping leaves the original intact; these coordinates do not
              certify book identity.
            </p>
            <div className="grid grid-cols-2 gap-2">
              {(['x', 'y', 'width', 'height'] as const).map((k) => (
                <label key={k} className="text-sm text-ink">
                  {c.kind} crop {k}
                  <input
                    className={field}
                    type="number"
                    value={c.crop[k]}
                    min={k === 'x' || k === 'y' ? 0 : 1}
                    disabled={busy || disabled}
                    onChange={(e) =>
                      change(
                        current.current.map((p) =>
                          p === c ? { ...p, crop: { ...p.crop, [k]: Number(e.target.value) } } : p,
                        ),
                      )
                    }
                  />
                </label>
              ))}
            </div>
            <p className="break-all text-xs text-muted">
              Original SHA-256: {c.photo.originalSha256}
              <br />
              Normalized SHA-256: {c.photo.normalizedSha256}
            </p>
            <button
              className={control}
              type="button"
              disabled={busy || disabled || !validPhotoBox(c.crop, c.photo.canvas)}
              onClick={async () => {
                const run = ++generation.current
                setBusy(true)
                setError('')
                let canvas: HTMLCanvasElement | null = null
                try {
                  canvas = photoCropCanvas(c.photo, c.crop)
                  const decode = await createBarcodeDecoder()
                  const values = await decode(canvas)
                  if (active.current && run === generation.current)
                    change(
                      current.current.map((p) =>
                        p === c
                          ? {
                              ...p,
                              isbns: [...new Set(values.map(bookBarcode).filter(Boolean))],
                              barcodeStatus:
                                'Crop barcode check completed; a crop may omit other ISBNs.',
                            }
                          : p,
                      ),
                    )
                } catch {
                  if (active.current && run === generation.current)
                    setError('Crop barcode recognition failed. Your photos and draft remain here.')
                } finally {
                  if (canvas) canvas.width = canvas.height = 0
                  if (active.current && run === generation.current) setBusy(false)
                }
              }}
            >
              Read this crop again
            </button>
          </details>
          {!validPhotoBox(c.crop, c.photo.canvas) && (
            <p role="alert" className="text-sm text-ink">
              Crop must remain inside the photo.
            </p>
          )}
          <p className="text-sm text-ink">{c.barcodeStatus}</p>
          {c.isbns.map((code) => (
            <button
              key={code}
              type="button"
              className={control}
              disabled={disabled || busy}
              onClick={() => {
                setIsbn(code)
                setChecked(false)
              }}
            >
              Use observed ISBN {code}
            </button>
          ))}
        </figure>
      ))}
      {!!captures.length && (
        <fieldset disabled={disabled || busy} className="space-y-3">
          <legend className="text-sm font-semibold text-ink">
            Identity to review beside the source pixels
          </legend>
          <label className="block text-sm text-ink">
            Checked transcription
            <textarea
              className={field}
              value={text}
              maxLength={12000}
              onChange={(e) => {
                setText(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <p className="text-sm text-muted">
            Transcription is an observation. Editors, translators, narrators and named-part credits
            are separate from whole-work authors. Multiple printed ISBNs, dates and conflicting
            credits remain unresolved until you select the correct edition. Matching artwork alone
            cannot identify it.
          </p>
          <label className="block text-sm text-ink">
            Reviewed title
            <input
              className={field}
              value={title}
              maxLength={1000}
              onChange={(e) => {
                setTitle(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <label className="block text-sm text-ink">
            Whole-work authors, one full name per line
            <textarea
              className={field}
              value={authors}
              maxLength={4000}
              onChange={(e) => {
                setAuthors(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          <label className="block text-sm text-ink">
            Selected edition ISBN (optional)
            <input
              className={field}
              value={isbn}
              maxLength={32}
              aria-invalid={invalidIsbn || undefined}
              onChange={(e) => {
                setIsbn(e.target.value)
                setChecked(false)
              }}
            />
          </label>
          {invalidIsbn && (
            <p role="alert" className="text-sm text-ink">
              Enter a checksum-valid book ISBN, or leave it unknown.
            </p>
          )}
          <label className="flex items-start gap-2 text-sm text-ink">
            <input
              type="checkbox"
              checked={checked}
              onChange={(e) => setChecked(e.target.checked)}
            />
            I inspected the source pixels and checked this title, author scope and selected ISBN.
            Unsupported edition facts remain unknown.
          </label>
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              className={control}
              disabled={!canReview || captures.some((c) => !validPhotoBox(c.crop, c.photo.canvas))}
              onClick={() =>
                onSearch(
                  bookBarcode(isbn) || [title.trim(), authors.trim()].filter(Boolean).join(' '),
                )
              }
            >
              Search for candidates
            </button>
            <button
              type="button"
              className={control}
              disabled={!canReview || captures.some((c) => !validPhotoBox(c.crop, c.photo.canvas))}
              onClick={() =>
                onReview({
                  title: title.trim(),
                  authors: authors
                    .split('\n')
                    .map((a) => a.trim())
                    .filter(Boolean),
                  isbn: bookBarcode(isbn) || undefined,
                })
              }
            >
              Review in Add
            </button>
          </div>
          <p className="text-sm text-muted">
            Search chooses nothing. Review in Add opens the usual editable draft, duplicate
            decisions and confirmation. Possession, format, reading history and copy quantity are
            your choices. After saving, use the book’s existing Cover Studio or cover photo/upload
            control separately; the source photo is never selected as your cover here.
          </p>
        </fieldset>
      )}
      {disabled && (
        <p role="status" className="text-sm text-ink">
          Photo evidence remains here while you review the Add draft. Finish or leave that draft
          before changing this identity.
        </p>
      )}
    </Surface>
  )
}
