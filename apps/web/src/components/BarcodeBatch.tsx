import { useEffect, useRef, useState } from 'react'
import {
  appendBarcode,
  BARCODE_BATCH_LIMIT,
  BarcodeFrameGate,
  bookBarcode,
  type BarcodeCapture,
} from '@reverie/core'
import { useBarcodeCamera } from '../scanning/useBarcodeCamera'
import './barcodeBatch.css'

/** Shared capture only. Hosts own review/save; a scan never writes a book, quantity or possession. */
export function BarcodeBatch({
  items,
  onChange,
  onReview,
  onNoIsbn,
  storageNotice = 'Captures stay on this page only; export before leaving or refreshing.',
}: {
  items: readonly BarcodeCapture[]
  onChange: (items: BarcodeCapture[]) => void
  onReview: (item: BarcodeCapture) => void
  onNoIsbn?: () => void
  /** The host owns persistence and must describe its actual save status. */
  storageNotice?: string
}) {
  const video = useRef<HTMLVideoElement>(null)
  const current = useRef(items)
  const gate = useRef(new BarcodeFrameGate())
  const pending = useRef<BarcodeCapture | null>(null)
  const [repeat, setRepeat] = useState<BarcodeCapture | null>(null)
  const [text, setText] = useState('')
  const [message, setMessage] = useState(
    'Ready to capture. Nothing is added to your library by scanning.',
  )
  useEffect(() => {
    current.current = items
  }, [items])
  const change = (next: BarcodeCapture[]) => {
    current.current = next
    onChange(next)
  }

  const capture = (raw: string, source: BarcodeCapture['source']) => {
    if (pending.current) return
    const isbn = bookBarcode(raw)
    if (!isbn) {
      setMessage('That is not a valid book ISBN. Use the 978 / 979 barcode, or enter an ISBN-10.')
      return
    }
    const item: BarcodeCapture = {
      id: crypto.randomUUID(),
      isbn,
      source,
      capturedAt: new Date().toISOString(),
    }
    const result = appendBarcode(current.current, item)
    if (result.kind === 'repeat') {
      pending.current = item
      setRepeat(item)
      camera.stop()
      setMessage('Already captured. Is this another physical copy?')
    } else if (result.kind === 'full') {
      camera.stop()
      setMessage(
        `This batch has ${BARCODE_BATCH_LIMIT} captures. Review or export them before starting another batch.`,
      )
    } else if (result.kind === 'added') {
      change(result.items)
      if (result.items.length >= BARCODE_BATCH_LIMIT) camera.stop()
      setText('')
      setMessage(`Captured ${isbn}. ${result.items.length} in this batch. Move to the next book.`)
    }
  }
  const camera = useBarcodeCamera(video, (values) => {
    const observation = gate.current.read(values, performance.now())
    if (!observation) return
    if (observation.kind === 'book') capture(observation.isbn, 'camera')
    else
      setMessage(
        observation.kind === 'ambiguous'
          ? 'More than one book barcode is visible. Show one book at a time.'
          : 'This is not a book ISBN. Try the 978 / 979 barcode or enter the ISBN below.',
      )
  })
  const resolveRepeat = (anotherCopy: boolean) => {
    const item = pending.current
    if (!item) return
    if (anotherCopy) {
      const result = appendBarcode(current.current, item, true)
      if (result.kind !== 'added') {
        setMessage('The batch is full. Review or export captures first.')
        return
      }
      change(result.items)
      setMessage(`Another physical copy captured: ${item.isbn}. Restart the camera when ready.`)
    } else
      setMessage('Repeat ignored. Your batch is unchanged. Restart the camera for the next book.')
    pending.current = null
    setRepeat(null)
    setText('')
  }
  const isbnCounts = new Map<string, number>()
  for (const item of items) isbnCounts.set(item.isbn, (isbnCounts.get(item.isbn) ?? 0) + 1)
  const exportBatch = () => {
    const url = URL.createObjectURL(
      new Blob([JSON.stringify({ version: 1, kind: 'barcode-captures', items }, null, 2)], {
        type: 'application/json',
      }),
    )
    const link = document.createElement('a')
    link.href = url
    link.download = 'book-barcode-batch.json'
    link.click()
    setTimeout(() => URL.revokeObjectURL(url), 1000)
  }

  return (
    <section className="barcode-batch" aria-label="Bulk barcode capture">
      <p className="barcode-batch-intro">Scan a stack, then review each book. {storageNotice}</p>
      <div className="barcode-camera-actions">
        <button
          type="button"
          disabled={!!repeat || (camera.state === 'off' && items.length >= BARCODE_BATCH_LIMIT)}
          onClick={() => {
            if (camera.state !== 'off') camera.stop()
            else {
              gate.current = new BarcodeFrameGate()
              void camera.start()
            }
          }}
        >
          {camera.state === 'starting'
            ? 'Cancel camera request'
            : camera.state === 'running'
              ? 'Pause camera'
              : 'Start camera'}
        </button>
        {onNoIsbn && (
          <button
            type="button"
            onClick={() => {
              camera.stop()
              onNoIsbn()
            }}
          >
            No ISBN / identify later
          </button>
        )}
      </div>
      <video
        ref={video}
        muted
        playsInline
        hidden={camera.state === 'off'}
        aria-label="Live barcode camera"
      />
      {camera.state !== 'off' && (
        <p>
          {camera.state === 'starting'
            ? 'Opening camera…'
            : 'Show the whole 978 / 979 barcode in good light. Move each book away after capture.'}
        </p>
      )}
      {camera.error && <p role="alert">{camera.error}</p>}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          capture(text, 'manual')
        }}
      >
        <label>
          ISBN or connected scanner input
          <input
            value={text}
            onChange={(event) => setText(event.target.value)}
            disabled={!!repeat}
            maxLength={40}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
            placeholder="Scan here, then Enter"
          />
        </label>
        <button type="submit" disabled={!!repeat || !text.trim()}>
          Capture ISBN
        </button>
      </form>
      <p role="status" aria-live="polite">
        {message}
      </p>
      {repeat && (
        <div className="barcode-repeat" role="group" aria-label="Repeated ISBN">
          <strong>{repeat.isbn} is already in this batch.</strong>
          <p>
            Keep a separate capture only if you have another physical copy. This does not change
            your library quantity.
          </p>
          <div className="barcode-camera-actions">
            <button type="button" onClick={() => resolveRepeat(true)}>
              Another copy
            </button>
            <button type="button" onClick={() => resolveRepeat(false)}>
              Ignore repeat
            </button>
          </div>
        </div>
      )}
      <div className="barcode-batch-heading">
        <h3>Captured books · {items.length}</h3>
        <button type="button" disabled={!items.length} onClick={exportBatch}>
          Export captures
        </button>
      </div>
      {items.length > 0 && (
        <ol className="barcode-captures">
          {items.map((item, index) => (
            <li key={item.id}>
              <div>
                <strong>{item.isbn}</strong>
                <span>
                  Capture {index + 1}
                  {(isbnCounts.get(item.isbn) ?? 0) > 1 ? ' · repeated ISBN, separate copy' : ''}
                </span>
              </div>
              <div className="barcode-camera-actions">
                <button
                  type="button"
                  disabled={!!repeat}
                  aria-label={`Review capture ${index + 1}: ${item.isbn}`}
                  onClick={() => {
                    camera.stop()
                    onReview(item)
                  }}
                >
                  Review
                </button>
                <button
                  type="button"
                  disabled={!!repeat}
                  aria-label={`Remove capture ${index + 1}: ${item.isbn}`}
                  onClick={() => {
                    change(current.current.filter((entry) => entry.id !== item.id))
                    setMessage(`Removed capture ${index + 1}. No saved book was deleted.`)
                  }}
                >
                  Remove
                </button>
              </div>
            </li>
          ))}
        </ol>
      )}
      <p>
        Capture works without a book lookup. Titles, editions, ownership and duplicate-library
        matches are checked during review.
      </p>
    </section>
  )
}
