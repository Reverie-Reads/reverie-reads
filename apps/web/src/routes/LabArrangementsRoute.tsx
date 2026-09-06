import { useEffect, useMemo, useState } from 'react'
import { createRoute } from '@tanstack/react-router'
import { SKINS, type ResolvedMode, type SkinId } from '@reverie/core'
import { rootRoute } from './RootRoute'
import { SkinAtmosphereCanvas } from '../components/SkinAtmosphereCanvas'
import { Surface } from '../components/Surface'
import { Frame, ProgressMeter, SectionHeader, SignatureRing } from '../components/Structure'
import { NavigationGlyph } from '../components/NavigationGlyph'
import { ReverieMark } from '../components/ReverieMark'
import { CoverImage } from '../components/CoverImage'
import { GUEST_CATALOG } from '../auth/landing/guest/catalog'
import { loadAllSkinFonts } from '../skin/fonts'
import {
  ARRANGEMENT_DESTINATIONS,
  ARRANGEMENT_PRESETS,
  DEFAULT_ARRANGEMENT_PRESET,
  HOME_MODULES,
  MAX_PRIORITY_DESTINATIONS,
  cloneArrangement,
  hideDestination,
  moveItem,
  restoreDestination,
  type ArrangementConfig,
  type ArrangementDestinationId,
  type ArrangementPresetId,
  type HomeModuleId,
} from '../design/arrangements'

type PreviewWidth = 'compact' | 'phone' | 'desktop'

const STUDY_SKINS: readonly SkinId[] = ['tryst', 'folio', 'aphelion', 'hearth']
const PREVIEW_WIDTHS: readonly { id: PreviewWidth; label: string; width: string }[] = [
  { id: 'compact', label: '320 phone', width: '320px' },
  { id: 'phone', label: '390 phone', width: '390px' },
  { id: 'desktop', label: 'Desktop', width: '100%' },
]

const destinationById = Object.fromEntries(
  ARRANGEMENT_DESTINATIONS.map((item) => [item.id, item]),
) as Record<ArrangementDestinationId, (typeof ARRANGEMENT_DESTINATIONS)[number]>
const moduleById = Object.fromEntries(HOME_MODULES.map((item) => [item.id, item])) as Record<
  HomeModuleId,
  (typeof HOME_MODULES)[number]
>

const sampleBooks = GUEST_CATALOG.slice(0, 5)

function BookCover({ index, className }: { index: number; className: string }) {
  const book = sampleBooks[index % sampleBooks.length]!
  return (
    <div className={`skin-card overflow-hidden border border-line ${className}`}>
      <CoverImage
        book={{ id: `arrangement-${book.key}`, title: book.title, cover: book.cover }}
        reportErrors={false}
      />
    </div>
  )
}

function DockItem({ id }: { id: ArrangementDestinationId }) {
  const item = destinationById[id]
  return (
    <button
      type="button"
      className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-center text-ink"
    >
      <NavigationGlyph name={item.icon} className="h-5 w-5 flex-none" />
      <span className="w-full truncate text-center text-[9px] font-semibold leading-tight">
        {item.label}
      </span>
    </button>
  )
}

function FixedDockItem({ kind }: { kind: 'add' | 'more' }) {
  return (
    <button
      type="button"
      className="flex min-h-14 min-w-0 flex-1 flex-col items-center justify-center gap-1 px-0.5 text-center text-ink"
    >
      <span className="grid h-5 w-5 place-items-center text-[19px] leading-none">
        {kind === 'add' ? '+' : '•••'}
      </span>
      <span className="w-full truncate text-center text-[9px] font-semibold leading-tight">
        {kind === 'add' ? 'Add' : 'More'}
      </span>
    </button>
  )
}

function ReadingModule({ skin }: { skin: SkinId }) {
  return (
    <div className="min-w-0">
      <SectionHeader skin={skin} label="Reading now" readout="1" />
      <Frame skin={skin} className="mt-3 flex min-w-0 gap-3 p-3 sm:p-4">
        <BookCover index={0} className="h-[96px] w-16 flex-none" />
        <div className="min-w-0 flex-1">
          <h3
            className="text-[18px] font-semibold leading-[1.22] text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Jane Eyre
          </h3>
          <p className="mt-1 text-[11px] text-muted">Charlotte Brontë</p>
          <ProgressMeter skin={skin} value={24} max={100} className="mt-4" />
          <p className="mt-1.5 text-[10px] text-muted">24% · Continue reading</p>
        </div>
      </Frame>
    </div>
  )
}

function NextReadModule({ skin }: { skin: SkinId }) {
  return (
    <Surface tone="card" radius="panel" pad={3} raised className="min-w-0 overflow-hidden">
      <SectionHeader skin={skin} label="Choose a next read" readout="12" />
      <div className="mt-3 flex items-center gap-3">
        <BookCover index={1} className="h-[90px] w-[60px] flex-none" />
        <div className="min-w-0 flex-1">
          <p
            className="break-words text-[17px] font-semibold leading-[1.22] text-ink"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            The Left Hand of Darkness
          </p>
          <p className="mt-1 text-[11px] text-muted">12 available · quiet · thoughtful · owned</p>
          <button
            type="button"
            className="skin-control skin-btn-primary mt-3 min-h-11 px-3 text-[11px]"
          >
            See my shortlist
          </button>
        </div>
      </div>
    </Surface>
  )
}

function PriorityModule({ skin }: { skin: SkinId }) {
  return (
    <div className="min-w-0 overflow-hidden">
      <SectionHeader skin={skin} label="Priority shelf" readout="5 books" />
      <div className="mt-3 flex gap-2 overflow-hidden">
        {[2, 3, 4].map((index) => (
          <BookCover key={index} index={index} className="h-[108px] w-[72px] flex-none" />
        ))}
      </div>
      <p className="mt-2 text-[10px] text-muted">The books you meant to keep close.</p>
    </div>
  )
}

function ReleasesModule({ skin }: { skin: SkinId }) {
  return (
    <Surface tone="card" radius="card" pad={3}>
      <SectionHeader skin={skin} label="Coming soon" readout="2" />
      <div className="mt-3 grid gap-2 text-[11px] text-ink sm:grid-cols-2">
        <p className="border-l-2 border-primary pl-3">September 18 · A saved new release</p>
        <p className="border-l-2 border-primary pl-3">October · Date not yet confirmed</p>
      </div>
    </Surface>
  )
}

function YearModule({ skin }: { skin: SkinId }) {
  return (
    <Surface tone="card" radius="panel" pad={3} className="flex items-center gap-4">
      <SignatureRing skin={skin} value={18} max={24} size={72} />
      <div>
        <SectionHeader skin={skin} label="Your reading year" />
        <p className="mt-2 text-[12px] text-ink">18 books, kept for you alone.</p>
        <p className="mt-1 text-[10px] text-muted">Six books from your private goal.</p>
      </div>
    </Surface>
  )
}

function HomeModulePreview({ id, skin }: { id: HomeModuleId; skin: SkinId }) {
  if (id === 'reading') return <ReadingModule skin={skin} />
  if (id === 'next-read') return <NextReadModule skin={skin} />
  if (id === 'priority') return <PriorityModule skin={skin} />
  if (id === 'releases') return <ReleasesModule skin={skin} />
  return <YearModule skin={skin} />
}

function DesktopRail({ config }: { config: ArrangementConfig }) {
  const secondary = ARRANGEMENT_DESTINATIONS.filter(
    (item) => !config.destinations.includes(item.id),
  )
  return (
    <aside className="flex w-[174px] flex-none flex-col border-r border-line px-3 py-4">
      <div className="flex items-center gap-2 px-2 text-ink">
        <ReverieMark className="h-6 w-6" />
        <span className="text-[15px]" style={{ fontFamily: 'var(--font-display)' }}>
          Reverie
        </span>
      </div>
      <button
        type="button"
        className="skin-control skin-btn-primary mt-5 min-h-11 px-3 text-[11px]"
      >
        + Add a book
      </button>
      <p className="skin-label mb-1 mt-6 px-2 text-[9px] text-muted">Close at hand</p>
      {config.destinations.map((id, index) => {
        const item = destinationById[id]
        return (
          <button
            key={id}
            type="button"
            className={`mt-1 flex min-h-11 items-center gap-2 px-2 text-left text-[11px] ${index === 0 ? 'skin-control skin-btn-secondary' : 'text-ink'}`}
          >
            <NavigationGlyph name={item.icon} className="h-4 w-4" />
            {item.label}
          </button>
        )
      })}
      <p className="skin-label mb-1 mt-5 px-2 text-[9px] text-muted">The rest of Reverie</p>
      {secondary.map((item) => (
        <button
          key={item.id}
          type="button"
          className="flex min-h-9 items-center gap-2 px-2 text-left text-[10px] text-muted"
        >
          <NavigationGlyph name={item.icon} className="h-3.5 w-3.5" />
          {item.label}
        </button>
      ))}
      <button type="button" className="mt-auto min-h-11 px-2 text-left text-[10px] text-muted">
        Appearance · Settings
      </button>
    </aside>
  )
}

function LibraryPreview({
  config,
  skin,
  mode,
  viewport,
}: {
  config: ArrangementConfig
  skin: SkinId
  mode: ResolvedMode
  viewport: PreviewWidth
}) {
  const desktop = viewport === 'desktop'
  return (
    <div
      className="relative mx-auto overflow-hidden border border-line"
      style={{
        width: PREVIEW_WIDTHS.find((item) => item.id === viewport)!.width,
        maxWidth: '100%',
        minHeight: desktop ? 670 : 700,
        borderRadius: 'var(--radius-panel)',
        background: 'var(--bg0)',
        boxShadow: 'var(--shadow)',
      }}
    >
      <SkinAtmosphereCanvas skin={skin} mode={mode} />
      <div className={`relative flex min-h-[inherit] ${desktop ? '' : 'pb-16'}`}>
        {desktop && <DesktopRail config={config} />}
        <main className="min-w-0 flex-1 px-4 py-5 sm:px-5">
          <div className="flex items-start justify-between gap-3">
            <div>
              <p className="skin-label text-[9px] text-muted">Saturday · Your private room</p>
              <h2
                className="mt-1 text-[24px] font-semibold leading-[1.08] text-ink sm:text-[28px]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                Welcome back.
              </h2>
              <p className="mt-2 max-w-[48ch] text-[11px] leading-relaxed text-muted">
                Continue reading or choose something from your library.
              </p>
            </div>
            {!desktop && (
              <button
                type="button"
                aria-label="Search your library"
                className="skin-control skin-btn-icon grid h-11 w-11 flex-none place-items-center text-[17px]"
              >
                ⌕
              </button>
            )}
          </div>
          <div className={`mt-6 grid gap-6 ${desktop ? 'xl:grid-cols-2' : ''}`}>
            {config.homeModules.map((id) => (
              <HomeModulePreview key={id} id={id} skin={skin} />
            ))}
          </div>
        </main>
      </div>
      {!desktop && (
        <nav
          aria-label="Preview phone dock"
          className="absolute inset-x-0 bottom-0 z-10 flex border-t border-line px-1"
          style={{ background: 'color-mix(in srgb, var(--card-solid) 94%, transparent)' }}
        >
          {config.destinations.map((id) => (
            <DockItem key={id} id={id} />
          ))}
          <FixedDockItem kind="add" />
          <FixedDockItem kind="more" />
        </nav>
      )}
    </div>
  )
}

function MoveRow({
  label,
  description,
  index,
  count,
  locked,
  onMove,
  onHide,
}: {
  label: string
  description?: string
  index: number
  count: number
  locked?: boolean
  onMove: (direction: -1 | 1) => void
  onHide: () => void
}) {
  return (
    <li className="flex min-w-0 items-center gap-2 border-b border-line py-2 last:border-0">
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] font-semibold text-ink">{label}</span>
        {description && (
          <span className="mt-0.5 block text-[10px] leading-relaxed text-muted">{description}</span>
        )}
      </span>
      <button
        type="button"
        aria-label={`Move ${label} earlier`}
        disabled={index === 0}
        onClick={() => onMove(-1)}
        className="skin-control skin-btn-icon grid h-11 w-11 place-items-center disabled:opacity-35"
      >
        ↑
      </button>
      <button
        type="button"
        aria-label={`Move ${label} later`}
        disabled={index === count - 1}
        onClick={() => onMove(1)}
        className="skin-control skin-btn-icon grid h-11 w-11 place-items-center disabled:opacity-35"
      >
        ↓
      </button>
      <button
        type="button"
        disabled={locked}
        onClick={onHide}
        className="skin-control skin-btn-secondary min-h-11 px-2 text-[10px] disabled:opacity-45"
      >
        {locked ? 'Anchor' : 'Hide'}
      </button>
    </li>
  )
}

function ArrangementLab() {
  const [skin, setSkin] = useState<SkinId>('tryst')
  const [mode, setMode] = useState<ResolvedMode>('dark')
  const [viewport, setViewport] = useState<PreviewWidth>('phone')
  const [saved, setSaved] = useState<ArrangementConfig>(() =>
    cloneArrangement(DEFAULT_ARRANGEMENT_PRESET.config),
  )
  const [draft, setDraft] = useState<ArrangementConfig>(() =>
    cloneArrangement(DEFAULT_ARRANGEMENT_PRESET.config),
  )
  const [announcement, setAnnouncement] = useState('Previewing Find my next read.')

  useEffect(() => loadAllSkinFonts(), [])

  const dirty = JSON.stringify(draft) !== JSON.stringify(saved)
  const matchingPresetId = ARRANGEMENT_PRESETS.find(
    (preset) => JSON.stringify(preset.config) === JSON.stringify(draft),
  )?.id
  const hiddenDestinations = useMemo(
    () => ARRANGEMENT_DESTINATIONS.filter((item) => !draft.destinations.includes(item.id)),
    [draft.destinations],
  )
  const hiddenModules = useMemo(
    () => HOME_MODULES.filter((item) => !draft.homeModules.includes(item.id)),
    [draft.homeModules],
  )

  const choosePreset = (id: ArrangementPresetId) => {
    const preset = ARRANGEMENT_PRESETS.find((item) => item.id === id)!
    setDraft(cloneArrangement(preset.config))
    setAnnouncement(`Previewing ${preset.label}. Save to keep this arrangement.`)
  }

  const updateDestinationOrder = (index: number, direction: -1 | 1) =>
    setDraft((current) => ({
      ...cloneArrangement(current),
      destinations: moveItem(current.destinations, index, direction),
    }))
  const updateModuleOrder = (index: number, direction: -1 | 1) =>
    setDraft((current) => ({
      ...cloneArrangement(current),
      homeModules: moveItem(current.homeModules, index, direction),
    }))

  return (
    <main
      data-skin={skin}
      data-mode={mode}
      className="min-h-dvh text-ink"
      style={{ background: 'var(--bg0)' }}
    >
      <div className="mx-auto max-w-[1440px] px-4 py-8 sm:px-6 lg:px-8">
        <header className="max-w-[880px]">
          <p className="skin-label text-[11px] text-muted">Design study · Account arrangements</p>
          <h1
            className="mt-2 text-[34px] font-semibold leading-[1.04] text-ink sm:text-[48px]"
            style={{ fontFamily: 'var(--font-display)' }}
          >
            Let the library open where you live in it.
          </h1>
          <p className="mt-4 max-w-[70ch] text-[15px] leading-relaxed text-muted">
            Navigation answers “where can I go?” Home answers “what greets me?” They are saved
            separately so changing one never rearranges the other. This study writes no account
            data.
          </p>
        </header>

        <section className="mt-8 grid gap-6 xl:grid-cols-[390px_minmax(0,1fr)]">
          <Surface
            tone="card"
            radius="panel"
            pad={4}
            raised
            className="self-start xl:sticky xl:top-4"
          >
            <fieldset>
              <legend className="skin-label text-[11px] text-muted">Starting arrangement</legend>
              <div className="mt-3 grid gap-2">
                {ARRANGEMENT_PRESETS.map((preset) => (
                  <button
                    key={preset.id}
                    type="button"
                    aria-pressed={matchingPresetId === preset.id}
                    onClick={() => choosePreset(preset.id)}
                    className={`skin-control min-h-11 px-3 py-2 text-left ${matchingPresetId === preset.id ? 'skin-btn-primary' : 'skin-btn-secondary'}`}
                  >
                    <span className="block text-[12px] font-semibold">{preset.label}</span>
                    <span className="mt-0.5 block text-[10px] leading-relaxed opacity-80">
                      {preset.description}
                    </span>
                  </button>
                ))}
              </div>
            </fieldset>

            <fieldset className="mt-6">
              <legend className="flex w-full items-baseline justify-between gap-3">
                <span className="skin-label text-[11px] text-muted">Close at hand</span>
                <span className="text-[10px] text-muted">
                  {draft.destinations.length}/{MAX_PRIORITY_DESTINATIONS} phone slots
                </span>
              </legend>
              <p className="mt-1 text-[10px] leading-relaxed text-muted">
                Library stays anchored. Add and More remain fixed outside these three choices.
              </p>
              <ol className="mt-2">
                {draft.destinations.map((id, index) => (
                  <MoveRow
                    key={id}
                    label={destinationById[id].label}
                    index={index}
                    count={draft.destinations.length}
                    locked={id === 'library'}
                    onMove={(direction) => updateDestinationOrder(index, direction)}
                    onHide={() => setDraft((current) => hideDestination(current, id))}
                  />
                ))}
              </ol>
              {hiddenDestinations.length > 0 && (
                <div className="mt-3">
                  <p className="text-[10px] text-muted">Still available from More</p>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {hiddenDestinations.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        disabled={draft.destinations.length >= MAX_PRIORITY_DESTINATIONS}
                        onClick={() => setDraft((current) => restoreDestination(current, item.id))}
                        className="skin-control skin-btn-secondary min-h-11 px-3 text-[10px] disabled:opacity-40"
                      >
                        + {item.label}
                      </button>
                    ))}
                  </div>
                  {draft.destinations.length >= MAX_PRIORITY_DESTINATIONS && (
                    <p className="mt-2 text-[10px] text-muted">Hide one priority to make room.</p>
                  )}
                </div>
              )}
            </fieldset>

            <fieldset className="mt-6">
              <legend className="skin-label text-[11px] text-muted">Home modules</legend>
              <ol className="mt-2">
                {draft.homeModules.map((id, index) => (
                  <MoveRow
                    key={id}
                    label={moduleById[id].label}
                    description={moduleById[id].description}
                    index={index}
                    count={draft.homeModules.length}
                    onMove={(direction) => updateModuleOrder(index, direction)}
                    onHide={() =>
                      setDraft((current) => ({
                        ...cloneArrangement(current),
                        homeModules: current.homeModules.filter((moduleId) => moduleId !== id),
                      }))
                    }
                  />
                ))}
              </ol>
              {hiddenModules.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-2">
                  {hiddenModules.map((item) => (
                    <button
                      key={item.id}
                      type="button"
                      onClick={() =>
                        setDraft((current) => ({
                          ...cloneArrangement(current),
                          homeModules: [...current.homeModules, item.id],
                        }))
                      }
                      className="skin-control skin-btn-secondary min-h-11 px-3 text-[10px]"
                    >
                      + {item.label}
                    </button>
                  ))}
                </div>
              )}
            </fieldset>

            <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
              <button
                type="button"
                disabled={!dirty}
                onClick={() => {
                  setSaved(cloneArrangement(draft))
                  setAnnouncement('Arrangement saved in this design preview.')
                }}
                className="skin-control skin-btn-primary min-h-11 px-4 text-[11px] disabled:opacity-45"
              >
                Save preview
              </button>
              <button
                type="button"
                disabled={!dirty}
                onClick={() => {
                  setDraft(cloneArrangement(saved))
                  setAnnouncement('Unsaved changes cancelled.')
                }}
                className="skin-control skin-btn-secondary min-h-11 px-4 text-[11px] disabled:opacity-45"
              >
                Cancel
              </button>
              <button
                type="button"
                onClick={() => {
                  setDraft(cloneArrangement(DEFAULT_ARRANGEMENT_PRESET.config))
                  setAnnouncement('Default arrangement restored in the preview. Save to keep it.')
                }}
                className="min-h-11 px-2 text-[10px] font-semibold text-muted underline underline-offset-4"
              >
                Restore default
              </button>
            </div>
            <p aria-live="polite" className="mt-3 text-[10px] leading-relaxed text-muted">
              {announcement}
            </p>
          </Surface>

          <div className="min-w-0">
            <Surface tone="card" radius="panel" pad={3} className="mb-4">
              <div className="flex flex-wrap items-end gap-4">
                <label className="text-[10px] text-muted">
                  <span className="skin-label block">Room</span>
                  <select
                    value={skin}
                    onChange={(event) => setSkin(event.target.value as SkinId)}
                    className="skin-field mt-1 h-11 border border-line px-3 text-[12px] text-ink"
                    style={{ background: 'var(--field)' }}
                  >
                    {STUDY_SKINS.map((id) => (
                      <option key={id} value={id}>
                        {SKINS[id].label}
                      </option>
                    ))}
                  </select>
                </label>
                <fieldset>
                  <legend className="skin-label text-[10px] text-muted">Light</legend>
                  <div className="mt-1 flex gap-1">
                    {(['light', 'dark'] as const).map((value) => (
                      <button
                        key={value}
                        type="button"
                        aria-pressed={mode === value}
                        onClick={() => setMode(value)}
                        className={`skin-control min-h-11 px-3 text-[11px] ${mode === value ? 'skin-btn-primary' : 'skin-btn-secondary'}`}
                      >
                        {value === 'light' ? 'Day' : 'Night'}
                      </button>
                    ))}
                  </div>
                </fieldset>
                <fieldset className="min-w-0">
                  <legend className="skin-label text-[10px] text-muted">Preview</legend>
                  <div className="mt-1 flex flex-wrap gap-1">
                    {PREVIEW_WIDTHS.map((item) => (
                      <button
                        key={item.id}
                        type="button"
                        aria-pressed={viewport === item.id}
                        onClick={() => setViewport(item.id)}
                        className={`skin-control min-h-11 px-3 text-[11px] ${viewport === item.id ? 'skin-btn-primary' : 'skin-btn-secondary'}`}
                      >
                        {item.label}
                      </button>
                    ))}
                  </div>
                </fieldset>
              </div>
            </Surface>
            <LibraryPreview config={draft} skin={skin} mode={mode} viewport={viewport} />
            <Surface tone="card" radius="card" pad={3} className="mt-4">
              <p className="skin-label text-[10px] text-muted">Reachability contract</p>
              <p className="mt-2 text-[12px] leading-relaxed text-ink">
                Hidden destinations stay in More on phones and in the complete desktop rail. Hidden
                Home modules retain their books and history. Search, Add, Appearance, and Settings
                never depend on the arrangement.
              </p>
            </Surface>
          </div>
        </section>
      </div>
    </main>
  )
}

export const labArrangementsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: 'lab/arrangements',
  component: ArrangementLab,
})
