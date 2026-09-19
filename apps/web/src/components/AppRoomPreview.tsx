import { APP_NAME } from '@reverie/core'
import { MidnihtMark } from './MidnihtMark'
import { NavigationGlyph } from './NavigationGlyph'
import { NAVIGATION_GROUPS } from './navigation'

const PREVIEW_BOOKS = [
  { id: 'acotar', title: 'A Court of Thorns and Roses' },
  { id: 'everflame', title: 'Spark of the Everflame' },
  { id: 'king-of-wrath', title: 'King of Wrath' },
  { id: 'never-king', title: 'The Never King' },
] as const

/**
 * A publication-safe miniature of the real app shell. Both the signed-out Nine Rooms playground
 * and the authenticated skin picker use this component, so navigation silhouette, iconography,
 * cover arrangement, and type cannot drift into two different products.
 *
 * The parent scopes `data-skin` and `data-mode`; this preview deliberately consumes the same
 * `.rv-nav-*` and token classes as AppShell.
 */
export function AppRoomPreview({ className = '' }: { className?: string }) {
  const firstGroup = NAVIGATION_GROUPS[0]

  return (
    <div
      role="img"
      aria-label={`A miniature ${APP_NAME} library with its skin-specific navigation and cover shelf`}
      className={`overflow-hidden border border-line bg-bg0 ${className}`}
      style={{ borderRadius: 'var(--radius-card)' }}
    >
      <div className="flex h-8 items-center justify-between border-b border-line bg-card px-2.5">
        <span className="skin-label text-[10px] leading-none text-muted">Library room</span>
        <span className="text-[10px] leading-none text-muted">
          {APP_NAME.toLowerCase()} · library
        </span>
      </div>

      <div aria-hidden className="grid min-h-[128px] grid-cols-[62px_1fr]">
        <div className="rv-nav-surface flex flex-col p-2">
          <span
            className="rv-nav-monogram grid h-6 w-6 place-items-center text-[10px] italic"
            style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
          >
            <MidnihtMark className="h-4 w-4" />
          </span>
          <div className="rv-nav-group mt-2 flex flex-col gap-1">
            {firstGroup.items.slice(0, 4).map((item) => (
              <span
                key={item.to}
                className={`rv-nav-item flex h-5 items-center gap-1.5 px-1.5 ${
                  item.to === '/library' ? 'rv-nav-item-active' : ''
                }`}
              >
                <span className="rv-nav-glyph grid w-2.5 place-items-center">
                  <NavigationGlyph name={item.icon} className="h-2.5 w-2.5" />
                </span>
                <span
                  className="h-px flex-1"
                  style={{
                    background: 'currentColor',
                    opacity: item.to === '/library' ? 0.8 : 0.3,
                  }}
                />
              </span>
            ))}
          </div>
        </div>

        <div className="min-w-0 p-2.5">
          <div className="flex items-end justify-between gap-2">
            <div>
              <div className="skin-label text-[10px] leading-none text-muted">Your books</div>
              <div
                className="mt-1.5 text-[12px] leading-none text-ink"
                style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
              >
                Your library
              </div>
            </div>
            <span className="skin-control skin-btn-primary grid h-7 place-items-center px-2 text-[9.5px] leading-none">
              Add
            </span>
          </div>

          <div className="mt-3 grid grid-cols-4 gap-1.5">
            {PREVIEW_BOOKS.map((book) => (
              <div key={book.id} className="min-w-0">
                <div
                  className="skin-card aspect-[2/3] overflow-hidden border border-line bg-card"
                  title={book.title}
                >
                  <img
                    src={`/landing-covers/${book.id}.jpg`}
                    alt=""
                    loading="lazy"
                    decoding="async"
                    className="h-full w-full object-cover"
                  />
                </div>
                <span className="mt-1 block h-px w-4/5 bg-muted opacity-35" />
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}
