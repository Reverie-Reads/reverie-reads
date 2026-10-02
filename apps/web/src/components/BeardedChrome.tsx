import { useEffect, useState } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { APP_NAME } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { useReadingMode } from '../design/useReadingMode'
import {
  arrangementsEqual,
  DEFAULT_ARRANGEMENT_PRESET,
  type ArrangementConfig,
} from '../design/arrangements'
import { BeardChooser } from './BeardChooser'
import { Modal } from './Modal'
import { NavigationGlyph } from './NavigationGlyph'
import {
  NAVIGATION_ITEMS,
  navigationLabelForPath,
  priorityNavigationItems,
  type NavigationItem,
} from './navigation'
import './beardedMode.css'

const PRIMARY: readonly NavigationItem[] = [
  { label: 'Home', to: '/', icon: 'home' },
  { label: 'My books', to: '/library', icon: 'library' },
  { label: 'Next read', to: '/match', icon: 'match' },
]

function SimpleLink({ item, onClick }: { item: NavigationItem; onClick?: () => void }) {
  return (
    <Link
      to={item.to}
      onClick={onClick}
      activeOptions={{ exact: item.to === '/' }}
      className="bearded-nav-link"
      activeProps={{ className: 'bearded-nav-active' }}
    >
      <NavigationGlyph name={item.icon} className="h-6 w-6 shrink-0" />
      <span>{item.label}</span>
    </Link>
  )
}

/** Only chrome changes: the content remains in the same mounted main, preserving open drafts. */
export function BeardedChrome({
  householdAdd,
  mobile = false,
  arrangement,
}: {
  householdAdd: boolean
  mobile?: boolean
  arrangement?: ArrangementConfig
}) {
  const priority =
    arrangement && !arrangementsEqual(arrangement, DEFAULT_ARRANGEMENT_PRESET.config)
      ? priorityNavigationItems(arrangement.destinations).map((item) =>
          item.to === '/library' ? { ...item, label: 'My books' } : item,
        )
      : PRIMARY
  const other = NAVIGATION_ITEMS.filter(
    (item) => !priority.some((primary) => primary.to === item.to),
  )
  const [open, setOpen] = useState(false)
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { signOut } = useAuth()
  const { setMode } = useReadingMode()
  useEffect(() => setOpen(false), [pathname])
  const add = (
    <Link
      to="/add"
      search={householdAdd ? { scope: 'household' } : {}}
      data-testid="persistent-add"
      data-book-tour="add-book"
      className="bearded-add skin-control skin-btn-primary"
    >
      <span aria-hidden="true">＋</span>
      {householdAdd ? 'Add to household' : 'Add a book'}
    </Link>
  )
  return (
    <>
      {mobile ? (
        <div className="bearded-mobile lg:hidden">
          <header className="bearded-mobile-header">
            <div className="flex items-center gap-3">
              <BeardChooser className="h-12 w-12" />
              <Link to="/" aria-label={`${APP_NAME} home`}>
                <strong className="block text-[20px]">{APP_NAME}</strong>
                <span className="block text-[13px] text-muted">Bearded Mode</span>
              </Link>
            </div>
            {add}
          </header>
          <nav aria-label="Primary" className="bearded-mobile-dock">
            {priority.map((item) => (
              <SimpleLink key={item.to} item={item} />
            ))}
            <button
              type="button"
              className="bearded-nav-link"
              onClick={() => setOpen(true)}
              aria-haspopup="dialog"
            >
              <span aria-hidden="true" className="text-2xl">
                ⋯
              </span>
              <span>More</span>
            </button>
          </nav>
        </div>
      ) : (
        <aside className="bearded-sidebar hidden lg:flex">
          <div className="bearded-brand">
            <BeardChooser className="h-24 w-20" />
            <Link to="/" aria-label={`${APP_NAME} home`}>
              <strong>{APP_NAME}</strong>
            </Link>
            <span>Bearded Mode</span>
          </div>
          {add}
          <nav aria-label="Primary" className="mt-6 grid gap-2">
            {priority.map((item) => (
              <SimpleLink key={item.to} item={item} />
            ))}
          </nav>
          <button
            type="button"
            className="bearded-nav-link mt-2"
            onClick={() => setOpen(true)}
            aria-haspopup="dialog"
          >
            <span aria-hidden="true" className="text-2xl">
              ⋯
            </span>
            <span>More tools</span>
          </button>
          <Link to="/settings" className="bearded-nav-link mt-auto">
            <NavigationGlyph name="settings" className="h-6 w-6" />
            Settings
          </Link>
        </aside>
      )}
      {open && (
        <Modal title="More tools" onClose={() => setOpen(false)}>
          <p className="mt-2 text-[14px] text-muted">
            You are in {navigationLabelForPath(pathname)}.
          </p>
          <nav aria-label="More destinations" className="mt-4 grid gap-1">
            {other.map((item) => (
              <SimpleLink key={item.to} item={item} onClick={() => setOpen(false)} />
            ))}
            <SimpleLink
              item={{ label: 'Appearance', to: '/skins', icon: 'skins' }}
              onClick={() => setOpen(false)}
            />
            <SimpleLink
              item={{ label: 'Settings', to: '/settings', icon: 'settings' }}
              onClick={() => setOpen(false)}
            />
          </nav>
          <div className="mt-4 grid gap-2 border-t border-line pt-4">
            <button
              type="button"
              className="bearded-nav-link"
              onClick={() => {
                setOpen(false)
                setMode('standard')
              }}
            >
              Use full interface
            </button>
            <button
              type="button"
              className="bearded-nav-link"
              onClick={() => {
                setOpen(false)
                void signOut()
              }}
            >
              Sign out
            </button>
          </div>
        </Modal>
      )}
    </>
  )
}
