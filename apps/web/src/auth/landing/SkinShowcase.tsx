import { useEffect } from 'react'
import { loadAllSkinFonts } from '../../skin/fonts'
import { SKINS, SKIN_LIST, type SkinId, type ResolvedMode } from '@reverie/core'
import { ReadingRoomPreview, type RoomSelection } from './ReadingRoomPreview'
import { GuestLibrary } from './guest/GuestLibrary'

const ATMOSPHERE_NOTE: Record<SkinId, string> = {
  tryst: 'Velvet shadows, warm lamplight, and a little gold.',
  grimoire: 'Vellum pages and illuminated edges, like a book left open in an old study.',
  aphelion: 'A quiet observatory, with a little distance from the everyday.',
  marrow: 'Ash, bone, and a held breath at the edge of the room.',
  umbra: 'Brass, fog, and the hush of a study after midnight.',
  folio: 'Cream paper, penciled margins, and room to linger over a sentence.',
  hearth: 'Warm linen and familiar shelves, with nowhere else you need to be.',
  almanac: 'Field notes and indexed pages for following a question wherever it leads.',
  bloom: 'The first light of a new day, with a little possibility in the margins.',
}

export interface SkinShowcaseProps extends RoomSelection {
  onSkinChange: (skin: SkinId) => void
  onModeChange: (mode: ResolvedMode) => void
}

/** One shared room selection controls every product example, including structural components. */
export function SkinShowcase({
  skin: active,
  mode,
  onSkinChange,
  onModeChange,
}: SkinShowcaseProps) {
  useEffect(loadAllSkinFonts, [])
  const skin = SKINS[active]
  return (
    <section id="skins" className="scroll-mt-24 border-y border-line py-16 sm:py-24">
      <div className="mx-auto max-w-[1280px] px-5 sm:px-8">
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-gold">
          Nine reading rooms
        </p>
        <div className="mt-4 grid gap-6 lg:grid-cols-2 lg:items-end">
          <h2
            className="max-w-[17ch] text-balance text-[clamp(34px,5vw,56px)] leading-[1.14] text-ink"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            Find a room that feels like you.
          </h2>
          <p className="max-w-[58ch] text-base leading-relaxed text-muted">
            The same books, a different place to settle in. Each room is a private reverie: choose
            one to change the live preview below and every example above. Your room never limits the
            genres you can read.
          </p>
        </div>
        <div
          role="tablist"
          aria-label="Reverie reading rooms"
          className="mt-8 grid grid-cols-3 gap-2 sm:gap-3 lg:grid-cols-9"
        >
          {SKIN_LIST.map((room) => {
            const selected = room.id === active
            return (
              <button
                key={room.id}
                id={`room-tab-${room.id}`}
                role="tab"
                type="button"
                aria-selected={selected}
                aria-controls="active-reading-room"
                tabIndex={selected ? 0 : -1}
                data-skin={room.id}
                data-mode={mode}
                onClick={() => onSkinChange(room.id)}
                onKeyDown={(event) => {
                  const index = SKIN_LIST.findIndex((item) => item.id === room.id)
                  const next =
                    event.key === 'Home'
                      ? 0
                      : event.key === 'End'
                        ? SKIN_LIST.length - 1
                        : ['ArrowRight', 'ArrowDown'].includes(event.key)
                          ? (index + 1) % SKIN_LIST.length
                          : ['ArrowLeft', 'ArrowUp'].includes(event.key)
                            ? (index - 1 + SKIN_LIST.length) % SKIN_LIST.length
                            : null
                  if (next === null) return
                  event.preventDefault()
                  onSkinChange(SKIN_LIST[next]!.id)
                  document.getElementById(`room-tab-${SKIN_LIST[next]!.id}`)?.focus()
                }}
                className="relative min-h-24 min-w-0 border px-2 py-3 text-center text-ink"
                style={{
                  background: 'var(--card-solid)',
                  borderColor: selected ? 'var(--primary)' : 'var(--line)',
                  borderRadius: 'var(--radius-card)',
                  boxShadow: selected ? 'inset 0 -3px var(--primary)' : undefined,
                }}
              >
                <span
                  className="block break-words text-[17px] font-semibold leading-[1.3]"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  {room.label}
                </span>
                <span className="mt-2 block text-[11px] leading-[1.4] text-muted">
                  {selected ? 'Viewing ✓' : 'Preview room'}
                </span>
              </button>
            )
          })}
        </div>
        <div className="my-5 flex flex-wrap items-center justify-between gap-3 text-sm leading-relaxed text-muted">
          <p role="status">{skin.label} is now in all three examples. Try Day or Night below.</p>
          <a
            href="#try-next-read"
            className="inline-flex min-h-11 items-center font-semibold text-ink underline underline-offset-4"
          >
            Try this room with the sample ↑
          </a>
        </div>
        <div
          id="active-reading-room"
          role="tabpanel"
          aria-labelledby={`room-tab-${active}`}
          data-testid="active-reading-room"
          data-active-skin={active}
          data-active-mode={mode}
        >
          <ReadingRoomPreview skin={active} mode={mode} className="p-4 sm:p-8">
            <div className="mb-7 flex flex-wrap items-start justify-between gap-5">
              <div className="max-w-[55ch]">
                <p className="text-xs font-semibold leading-relaxed text-muted">
                  LIVE PREVIEW · {skin.genre}
                </p>
                <h3
                  className="mt-2 text-[clamp(30px,4vw,46px)] font-semibold leading-[1.18] text-ink"
                  style={{ fontFamily: 'var(--font-display)' }}
                >
                  The {skin.label} room
                </h3>
                <p className="mt-3 text-sm leading-relaxed text-muted">{ATMOSPHERE_NOTE[active]}</p>
              </div>
              <div role="group" aria-label="Preview time of day" className="flex gap-2">
                {(['dark', 'light'] as const).map((next) => (
                  <button
                    type="button"
                    key={next}
                    onClick={() => onModeChange(next)}
                    aria-pressed={mode === next}
                    className={`skin-control min-h-11 px-4 text-sm font-semibold ${mode === next ? 'skin-btn-primary' : 'skin-btn-secondary'}`}
                  >
                    {next === 'dark' ? 'Night' : 'Day'}
                  </button>
                ))}
              </div>
            </div>
            <GuestLibrary skin={active} mode={mode} />
          </ReadingRoomPreview>
        </div>
        <p className="mx-auto mt-6 max-w-[70ch] text-sm leading-relaxed text-muted">
          Stay in the room you love, or let Adaptive follow your reading tastes. Your books, notes,
          and place in a story always stay yours.
        </p>
      </div>
    </section>
  )
}
