import { useEffect, useRef, useState } from 'react'
import { mayIngestCover, type Book, type CoverSource } from '@reverie/core'
import { Modal } from './Modal'
import { useUpdateBook } from '../data/books'
import {
  editionSyncPatch,
  useEditionOptions,
  useSetCover,
  type SetCoverError,
} from '../data/coverSheet'
import type { EditionOption } from '../lib/covers'
import {
  clampOffset,
  COVER_ASPECT,
  CROP_MAX_ZOOM,
  CROP_OUT_HEIGHT,
  CROP_OUT_WIDTH,
  sourceRect,
  type CropState,
} from '../lib/cropMath'
import { CoverEditionOption } from './CoverEditionOption'
import { Surface } from './Surface'

// The cover sheet — the cover is the door. Four ways in: shoot your own copy, upload an image, pick
// an edition (with context: format · year · publisher, never a bare image wall), or paste a direct
// image link. Durable sources use the covers Edge Function; arbitrary pasted hosts are validated as
// renderable by the browser and kept as hotlinks, never fetched by the server. Camera + upload pass
// through the 2:3 crop; an edition pick offers (never forces) syncing the book's edition fields.
//
// YOUR COPY LEADS (docs/reference/reverie-metadata-sourcing.md §Why camera capture matters more than it
// looks). A photo of the book on your shelf is simultaneously the most defensible cover we can
// hold — unambiguously the reader's own — and the only one that covers indie, KU, signed and
// special editions, which no database has. It was buried under the edition list; it goes first.

const fieldClass =
  'skin-field h-10 w-full border border-line px-3 text-[14px] text-ink outline-none'
const fieldStyle = { background: 'var(--field)' } as const

const ERROR_COPY: Record<SetCoverError | string, string> = {
  not_an_image: 'That link doesn’t point to an image — paste a direct image URL.',
  too_large: 'That image is too large (8 MB max).',
  fetch_failed: 'Couldn’t fetch that link. Check the URL and try again.',
  bad_url: 'That doesn’t look like a link. Paste a direct image URL.',
  no_cover_available:
    'That source has no real cover for this book — try another edition or add your own.',
  display_only_source:
    'That source can only be linked, not saved. Take a photo or upload an image to keep a copy.',
  failed: 'Couldn’t save that cover. Try again in a moment.',
}

const rendersAsImage = (raw: string): Promise<boolean> =>
  new Promise((resolve) => {
    try {
      const parsed = new URL(raw)
      if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
        resolve(false)
        return
      }
    } catch {
      resolve(false)
      return
    }
    const image = new Image()
    const timeout = window.setTimeout(() => finish(false), 10_000)
    const finish = (ok: boolean) => {
      window.clearTimeout(timeout)
      image.onload = image.onerror = null
      resolve(ok)
    }
    image.onload = () => finish(image.naturalWidth > 0 && image.naturalHeight > 0)
    image.onerror = () => finish(false)
    image.src = raw
  })

function SectionLabel({ children }: { children: string }) {
  return (
    <div className="mb-1.5 mt-5 text-[11px] uppercase tracking-[0.2em] text-muted first:mt-0">
      {children}
    </div>
  )
}

export function CoverSheet({ book, onClose }: { book: Book; onClose: () => void }) {
  const [crop, setCrop] = useState<{ file: File; source: 'camera' | 'upload' } | null>(null)
  const [synced, setSynced] = useState<EditionOption | null>(null) // last applied edition (sync offer)
  const [error, setError] = useState<string | null>(null)
  const [url, setUrl] = useState('')
  const [checkingUrl, setCheckingUrl] = useState(false)
  const cameraRef = useRef<HTMLInputElement>(null)
  const uploadRef = useRef<HTMLInputElement>(null)

  const setCover = useSetCover()
  const updateBook = useUpdateBook()
  const { data: editions, isLoading: editionsLoading } = useEditionOptions(book, !crop)

  const saving = setCover.isPending || checkingUrl

  const apply = (
    input: { source: CoverSource; file?: Blob; url?: string; sourceUrl?: string },
    edition?: EditionOption,
  ) => {
    setError(null)
    setCover.mutate(
      { book, ...input },
      {
        onSuccess: () => {
          setCrop(null)
          setSynced(edition ?? null)
          if (!edition) onClose() // camera/upload/link: done; edition picks stay for the sync offer
        },
        onError: (e) => setError(ERROR_COPY[e.message] ?? ERROR_COPY.failed ?? null),
      },
    )
  }

  const onFile = (input: HTMLInputElement, source: 'camera' | 'upload') => {
    const file = input.files?.[0]
    input.value = ''
    if (!file) return
    setError(null)
    setCrop({ file, source })
  }

  const syncPatch = synced ? editionSyncPatch(book, synced) : {}
  const canSync = synced != null && Object.keys(syncPatch).length > 0

  if (crop) {
    return (
      <Modal title="Crop your cover" onClose={() => (saving ? undefined : setCrop(null))}>
        <CoverCrop
          file={crop.file}
          saving={saving}
          onCancel={() => setCrop(null)}
          onSave={(blob) => apply({ source: crop.source, file: blob })}
        />
        {error && <p className="mt-3 text-[13px] text-primary">{error}</p>}
      </Modal>
    )
  }

  return (
    <Modal title="Cover" onClose={onClose}>
      <p className="-mt-2 mb-3 text-[13px] text-muted">{book.title}</p>

      {synced && (
        <Surface tone="field" radius="card" pad={2} className="mb-4">
          <div className="text-[13.5px] font-semibold text-ink">Cover updated.</div>
          {canSync && (
            <button
              type="button"
              disabled={saving}
              onClick={() => {
                updateBook.mutate({ id: book.id, patch: syncPatch })
                onClose()
              }}
              className="skin-control mt-2 h-9 w-full border border-line text-[13px] font-semibold text-ink disabled:opacity-50"
              style={{ background: 'var(--card)' }}
            >
              Also update edition details
              <span className="block text-[11px] font-normal text-muted">
                {[
                  syncPatch.format,
                  syncPatch.isbn ? `ISBN ${syncPatch.isbn}` : null,
                  syncPatch.pub?.y ? `${syncPatch.pub.y}` : null,
                  syncPatch.pages ? `${syncPatch.pages} pp` : null,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </span>
            </button>
          )}
          <button type="button" onClick={onClose} className="mt-2 text-[12px] text-muted underline">
            Done
          </button>
        </Surface>
      )}

      <SectionLabel>Your copy</SectionLabel>
      <p className="mb-2 text-[12.5px] text-muted">
        The truest cover is the one on your shelf — and the only one that exists for indie, KU and
        special editions.
      </p>
      <input
        ref={cameraRef}
        type="file"
        accept="image/*"
        capture="environment"
        hidden
        onChange={(e) => onFile(e.currentTarget, 'camera')}
      />
      <input
        ref={uploadRef}
        type="file"
        accept="image/*"
        hidden
        onChange={(e) => onFile(e.currentTarget, 'upload')}
      />
      <button
        type="button"
        disabled={saving}
        onClick={() => cameraRef.current?.click()}
        className="skin-control h-12 w-full text-[14px] font-semibold disabled:opacity-50"
        style={{
          background: 'linear-gradient(135deg, var(--primary), var(--gold))',
          color: 'var(--on-primary)',
        }}
      >
        📷 Photograph your copy
      </button>
      <button
        type="button"
        disabled={saving}
        onClick={() => uploadRef.current?.click()}
        className="skin-control mt-2 h-11 w-full border border-line text-[13.5px] font-semibold text-ink disabled:opacity-50"
        style={{ background: 'var(--card)' }}
      >
        Upload an image
      </button>

      <SectionLabel>Other editions</SectionLabel>
      {editionsLoading && <div className="text-[13px] text-muted">Finding editions…</div>}
      {!editionsLoading && (editions ?? []).length === 0 && (
        <div className="text-[13px] text-muted">No other editions found — add your own below.</div>
      )}
      {(editions ?? []).length > 0 && (
        <ul className="flex max-h-64 flex-col gap-1.5 overflow-y-auto pr-1">
          {(editions ?? []).map((e, i) => (
            <li key={`${e.isbn13 || i}:${e.cover}`}>
              <CoverEditionOption
                edition={e}
                isbn={book.isbn}
                disabled={saving}
                onSelect={(selected) =>
                  apply(
                    { source: selected.source, url: selected.cover, sourceUrl: selected.cover },
                    selected,
                  )
                }
              />
            </li>
          ))}
        </ul>
      )}

      <SectionLabel>From a link</SectionLabel>
      <form
        className="flex gap-2"
        onSubmit={async (e) => {
          e.preventDefault()
          const u = url.trim()
          if (!u) return
          if (!mayIngestCover('url', u)) {
            setCheckingUrl(true)
            setError(null)
            const renderable = await rendersAsImage(u)
            setCheckingUrl(false)
            if (!renderable) {
              setError(ERROR_COPY.not_an_image ?? null)
              return
            }
          }
          apply({ source: 'url', url: u, sourceUrl: u })
        }}
      >
        <input
          value={url}
          onChange={(e) => setUrl(e.target.value)}
          placeholder="https://… (a direct image URL)"
          aria-label="Direct image URL"
          inputMode="url"
          className={fieldClass}
          style={fieldStyle}
        />
        <button
          type="submit"
          disabled={saving || !url.trim()}
          className="skin-control h-10 flex-none border border-line px-4 text-[13px] font-semibold text-ink disabled:opacity-40"
          style={{ background: 'var(--card)' }}
        >
          Use
        </button>
      </form>

      {saving && (
        <p className="mt-3 text-[13px] text-muted" role="status">
          Saving cover…
        </p>
      )}
      {error && !crop && (
        <p className="mt-3 text-[13px] text-primary" role="alert">
          {error}
        </p>
      )}
    </Modal>
  )
}

/** The 2:3 crop — drag to position, slider/wheel to zoom. Crop only, kept light (no deskew). */
function CoverCrop({
  file,
  saving,
  onSave,
  onCancel,
}: {
  file: File
  saving: boolean
  onSave: (blob: Blob) => void
  onCancel: () => void
}) {
  const [img, setImg] = useState<{
    el: HTMLImageElement
    url: string
    w: number
    h: number
  } | null>(null)
  const [state, setState] = useState<CropState>({ zoom: 1, tx: 0, ty: 0 })
  const [readError, setReadError] = useState(false)
  const frameRef = useRef<HTMLDivElement>(null)
  const drag = useRef<{ x: number; y: number; tx: number; ty: number } | null>(null)

  const FRAME_W = 240
  const FRAME_H = Math.round(FRAME_W / COVER_ASPECT) // 360

  useEffect(() => {
    // alive-guard: StrictMode double-mounts effects — the aborted first pass revokes its URL while
    // its Image is mid-load, and that stale onerror must not poison the surviving pass's state.
    let alive = true
    const url = URL.createObjectURL(file)
    const el = new Image()
    el.onload = () => alive && setImg({ el, url, w: el.naturalWidth, h: el.naturalHeight })
    el.onerror = () => alive && setReadError(true)
    el.src = url
    return () => {
      alive = false
      el.onload = el.onerror = null
      URL.revokeObjectURL(url)
    }
  }, [file])

  const clamped = img ? clampOffset(state, img.w, img.h, FRAME_W, FRAME_H) : state

  const save = () => {
    if (!img) return
    const r = sourceRect(clamped, img.w, img.h, FRAME_W, FRAME_H)
    const canvas = document.createElement('canvas')
    canvas.width = CROP_OUT_WIDTH
    canvas.height = CROP_OUT_HEIGHT
    const ctx = canvas.getContext('2d')
    if (!ctx) return
    ctx.drawImage(img.el, r.sx, r.sy, r.sw, r.sh, 0, 0, CROP_OUT_WIDTH, CROP_OUT_HEIGHT)
    // JPEG here (Safari can't encode webp from canvas); the ingest pipeline normalizes to webp.
    canvas.toBlob((b) => b && onSave(b), 'image/jpeg', 0.92)
  }

  if (readError) {
    return (
      <div>
        <p className="text-[13px] text-primary" role="alert">
          That file couldn’t be read as an image.
        </p>
        <button type="button" onClick={onCancel} className="mt-3 text-[13px] text-muted underline">
          Back
        </button>
      </div>
    )
  }

  const scale = img ? Math.max(FRAME_W / img.w, FRAME_H / img.h) * clamped.zoom : 1

  return (
    <div className="flex flex-col items-center">
      <div
        ref={frameRef}
        className="relative touch-none overflow-hidden rounded-xl border border-line"
        style={{ width: FRAME_W, height: FRAME_H, background: 'var(--field)' }}
        onPointerDown={(e) => {
          e.currentTarget.setPointerCapture(e.pointerId)
          drag.current = { x: e.clientX, y: e.clientY, tx: clamped.tx, ty: clamped.ty }
        }}
        onPointerMove={(e) => {
          if (!drag.current || !img) return
          const next = {
            ...clamped,
            tx: drag.current.tx + (e.clientX - drag.current.x),
            ty: drag.current.ty + (e.clientY - drag.current.y),
          }
          setState(clampOffset(next, img.w, img.h, FRAME_W, FRAME_H))
        }}
        onPointerUp={() => (drag.current = null)}
        onWheel={(e) => {
          if (!img) return
          const zoom = clamped.zoom * (e.deltaY < 0 ? 1.08 : 1 / 1.08)
          setState(clampOffset({ ...clamped, zoom }, img.w, img.h, FRAME_W, FRAME_H))
        }}
        aria-label="Crop area — drag to position the cover"
        role="img"
      >
        {img && (
          <img
            src={img.url}
            alt=""
            draggable={false}
            className="pointer-events-none absolute max-w-none select-none"
            style={{
              width: img.w * scale,
              height: img.h * scale,
              left: FRAME_W / 2 + clamped.tx - (img.w * scale) / 2,
              top: FRAME_H / 2 + clamped.ty - (img.h * scale) / 2,
            }}
          />
        )}
        {!img && (
          <div className="grid h-full w-full place-items-center text-[13px] text-muted">
            Loading…
          </div>
        )}
      </div>

      <label className="mt-4 flex w-full items-center gap-3">
        <span className="text-[11px] uppercase tracking-[0.15em] text-muted">Zoom</span>
        <input
          type="range"
          min={1}
          max={CROP_MAX_ZOOM}
          step={0.01}
          value={clamped.zoom}
          disabled={!img}
          onChange={(e) => {
            if (!img) return
            setState(
              clampOffset(
                { ...clamped, zoom: Number(e.target.value) },
                img.w,
                img.h,
                FRAME_W,
                FRAME_H,
              ),
            )
          }}
          className="w-full"
          style={{ accentColor: 'var(--primary)' }}
        />
      </label>

      <div className="mt-4 flex w-full gap-2">
        <button
          type="button"
          onClick={onCancel}
          disabled={saving}
          className="skin-control h-11 flex-1 border border-line text-[13.5px] font-semibold text-ink disabled:opacity-50"
          style={{ background: 'var(--card)' }}
        >
          Back
        </button>
        <button
          type="button"
          onClick={save}
          disabled={!img || saving}
          className="skin-control h-11 flex-1 text-[14px] font-semibold disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          {saving ? 'Saving…' : 'Save cover'}
        </button>
      </div>
    </div>
  )
}
