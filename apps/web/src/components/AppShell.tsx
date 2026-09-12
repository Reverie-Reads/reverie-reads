import { useEffect, useRef, useState, type ReactNode } from 'react'
import { Link, useRouterState } from '@tanstack/react-router'
import { APP_NAME, SKINS } from '@reverie/core'
import { useAuth } from '../auth/AuthProvider'
import { useSkin } from '../skin/useSkin'
import { useEffectiveSkin } from '../skin/labels'
import { SkinDivider } from './SkinDivider'
import { SkinEvolveReveal } from './SkinEvolveReveal'
import { ThemeToggle } from './ThemeToggle'
import { Surface } from './Surface'
import { PowerGlyph } from './PowerGlyph'
import { PlusGlyph } from './PlusGlyph'
import { isHouseholdAddContext } from './appShellScope'
import { NavigationGlyph } from './NavigationGlyph'
import { ReverieMark } from './ReverieMark'
import { navigationLabelForPath, type NavigationItem } from './navigation'
import { useProfile } from '../data/profile'
import { GuidanceObserver } from '../guidance/data'
import { GuidanceTrail } from '../guidance/Guide'
import { guidedNavigation } from '../guidance/navigation'
import { type Guidance } from '../guidance/model'
import { DEFAULT_ARRANGEMENT_PRESET, type ArrangementConfig } from '../design/arrangements'

const COLLAPSE_KEY = 'reverie.sidebar.collapsed'

function readCollapsed(): boolean {
  try {
    return typeof window !== 'undefined' && window.localStorage?.getItem(COLLAPSE_KEY) === '1'
  } catch {
    return false
  }
}

/** The active skin's display label (adaptive resolves to "Adaptive"). */
function useSkinLabel(): string {
  const skin = useSkin((s) => s.skin)
  const effective = useEffectiveSkin()
  return skin === 'adaptive' ? 'Adaptive' : SKINS[effective].label
}

const navBase =
  'rv-nav-item relative flex min-h-11 items-center gap-3 px-3 py-2.5 text-[14px] font-medium'

function NavLinks({
  collapsed,
  arrangement,
  guidance,
}: {
  collapsed: boolean
  arrangement: ArrangementConfig
  guidance?: Guidance | null
}) {
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const { priority, other } = guidedNavigation(arrangement, guidance, pathname)
  const groups = [
    { label: 'Close at hand', items: priority },
    {
      label: 'Everything else',
      items: other,
    },
  ]
  return (
    <nav
      className="rv-primary-nav flex flex-1 flex-col gap-4 overflow-y-auto overflow-x-hidden"
      aria-label="Primary"
    >
      {groups.map((group) => (
        <div key={group.label} className="rv-nav-group flex flex-col gap-0.5">
          {!collapsed ? (
            <div className="rv-nav-group-label skin-label px-3 pb-1 text-[12px] leading-[1.35] text-muted">
              {group.label}
            </div>
          ) : null}
          {group.items.map((item) => (
            <Link
              key={item.to}
              to={item.to}
              activeOptions={{ exact: item.to === '/' }}
              title={collapsed ? item.label : undefined}
              aria-label={collapsed ? item.label : undefined}
              className={`${navBase} ${collapsed ? 'justify-center' : ''}`}
              style={{ color: 'var(--muted)' }}
              activeProps={{
                className: 'rv-nav-item-active',
                style: {
                  color: 'var(--ink)',
                  fontWeight: 650,
                },
              }}
            >
              <span className="rv-nav-glyph grid w-5 shrink-0 place-items-center" aria-hidden>
                <NavigationGlyph name={item.icon} className="h-[18px] w-[18px]" />
              </span>
              {!collapsed ? <span className="break-words">{item.label}</span> : null}
            </Link>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** Persistent desktop rail: brand, primary nav, and skin / theme / account controls. */
function Sidebar({
  householdAdd,
  arrangement,
  guidance,
}: {
  householdAdd: boolean
  arrangement: ArrangementConfig
  guidance?: Guidance | null
}) {
  const { signOut } = useAuth()
  const skinLabel = useSkinLabel()
  const effective = useEffectiveSkin()
  const chromeLine = SKINS[effective].chromeLine
  const [collapsed, setCollapsed] = useState(readCollapsed)

  useEffect(() => {
    try {
      window.localStorage?.setItem(COLLAPSE_KEY, collapsed ? '1' : '0')
    } catch {
      /* private mode / denied */
    }
  }, [collapsed])

  return (
    <div
      data-collapsed={collapsed ? 'true' : 'false'}
      className="rv-nav-surface rv-sidebar sticky top-0 hidden h-dvh shrink-0 flex-col px-3.5 py-4 backdrop-blur-lg transition-[width] duration-200 ease-out motion-reduce:transition-none lg:flex"
      style={{
        width: collapsed ? 76 : 232,
      }}
    >
      {/* Brand */}
      {/* The CHROME (chunk-4 composed screens): the brand block names the ROOM, not the widget —
          "Reverie · The standing invitation / The night office / Up too late…" — and wears the
          skin's chrome material as a rail beneath (`.rv-chrome`, per-skin rules in skin-kit.css). */}
      <Link
        to="/"
        className="rv-chrome rv-nav-brand flex items-center gap-2.5 px-1 py-1 pb-2.5"
        aria-label={`${APP_NAME} home`}
      >
        <span
          className="rv-nav-monogram grid h-[38px] w-[38px] shrink-0 place-items-center text-[18px] italic"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
        >
          <ReverieMark className="h-6 w-6" />
        </span>
        {!collapsed && (
          <span className="min-w-0 flex-1">
            <span
              className="rv-nav-wordmark block text-[18px] leading-none text-ink"
              style={{ fontFamily: 'var(--font-display)', fontWeight: 600 }}
            >
              {APP_NAME}
            </span>
            <span
              data-testid="sidebar-chrome-line"
              className="skin-label mt-1.5 block break-words text-[12px] leading-[1.4] text-muted"
            >
              {chromeLine}
            </span>
          </span>
        )}
      </Link>

      {!collapsed && <SkinDivider className="my-3" />}

      {/* Add — primary action */}
      <Link
        to="/add"
        data-testid="persistent-add"
        search={householdAdd ? { scope: 'household' } : {}}
        title={collapsed ? (householdAdd ? 'Add to household' : 'Add a book') : undefined}
        aria-label={householdAdd ? 'Add to household' : 'Add a book'}
        className={`rv-sidebar-primary skin-control skin-btn-primary mb-3 flex h-11 items-center justify-center gap-1.5 text-[13.5px] ${
          collapsed ? 'px-0' : 'px-4'
        }`}
      >
        <PlusGlyph className="h-[17px] w-[17px] shrink-0" />
        {!collapsed && <span>{householdAdd ? 'Add to household' : 'Add a book'}</span>}
      </Link>

      <NavLinks collapsed={collapsed} arrangement={arrangement} guidance={guidance} />

      {/* Footer controls */}
      <div
        className="rv-sidebar-footer mt-3 flex flex-col gap-2 border-t pt-3"
        style={{ borderColor: 'var(--line)' }}
      >
        <div className={`flex items-center gap-1.5 ${collapsed ? 'flex-col' : ''}`}>
          <Link
            to="/skins"
            title="Appearance"
            aria-label="Appearance"
            className={`rv-sidebar-utility skin-control skin-btn-secondary flex min-h-11 items-center justify-center gap-2 py-1 text-[13px] ${
              collapsed ? 'w-11' : 'flex-1'
            }`}
          >
            <span
              aria-hidden
              className="h-3 w-3 shrink-0 rounded-[4px]"
              style={{ background: 'linear-gradient(135deg, var(--primary), var(--gold))' }}
            />
            {!collapsed && (
              <span className="break-words text-center leading-tight">{skinLabel}</span>
            )}
          </Link>
          <ThemeToggle compact />
        </div>

        <div className={`flex items-center gap-1.5 ${collapsed ? 'flex-col' : ''}`}>
          <Link
            to="/settings"
            title="Settings"
            aria-label="Settings"
            className={`rv-sidebar-utility skin-control skin-btn-secondary flex h-11 items-center justify-center gap-2 text-[13px] ${
              collapsed ? 'w-11' : 'flex-1'
            }`}
          >
            <span aria-hidden>⚙</span>
            {!collapsed && <span>Settings</span>}
          </Link>
          <button
            type="button"
            onClick={() => void signOut()}
            title="Sign out"
            aria-label="Sign out"
            className={`rv-sidebar-utility skin-control skin-btn-secondary flex h-11 items-center justify-center text-[13px] ${
              collapsed ? 'w-11' : 'px-3'
            }`}
          >
            <span className={collapsed ? '' : 'hidden'}>
              <PowerGlyph />
            </span>
            <span className={collapsed ? 'hidden' : ''}>Sign out</span>
          </button>
        </div>

        <button
          type="button"
          onClick={() => setCollapsed((v) => !v)}
          className={`skin-control skin-btn-secondary flex min-h-11 items-center gap-2 px-2 py-1.5 text-[13px] ${
            collapsed ? 'justify-center' : ''
          }`}
          aria-pressed={collapsed}
          aria-label={collapsed ? 'Expand sidebar' : 'Collapse sidebar'}
        >
          <span aria-hidden>{collapsed ? '⟩' : '⟨'}</span>
          {!collapsed && <span>Collapse</span>}
        </button>
      </div>
    </div>
  )
}

/** Compact top bar for narrow screens — brand and theme only. Navigation lives in the tab bar. */
function MobileBar({ pathname }: { pathname: string }) {
  const skinLabel = useSkinLabel()
  const pageLabel = navigationLabelForPath(pathname)

  return (
    <header className="rv-mobile-header flex min-h-[66px] items-center justify-between gap-3 px-4 py-2.5 lg:hidden">
      <Link to="/" className="min-w-0" aria-label={`${APP_NAME} home`}>
        <span
          className="rv-mobile-wordmark flex items-center gap-2 text-[24px] italic leading-[1.2] text-ink"
          style={{ fontFamily: 'var(--font-display)', fontWeight: 600, letterSpacing: '0.5px' }}
        >
          <ReverieMark className="h-6 w-6" />
          {APP_NAME}
        </span>
        <span
          data-testid="mobile-chrome-context"
          className="skin-label mt-1 block break-words text-[12px] leading-[1.35] text-muted"
        >
          {pageLabel} · {skinLabel}
        </span>
      </Link>
      <ThemeToggle compact />
    </header>
  )
}

const tabLink =
  'rv-mobile-tab flex min-h-[58px] min-w-0 flex-col items-center justify-center gap-1 px-1 pb-1.5 pt-2 text-center text-[12px] font-semibold'

function TabLink({ item }: { item: NavigationItem }) {
  return (
    <Link
      to={item.to}
      activeOptions={{ exact: item.to === '/' }}
      className={tabLink}
      style={{ color: 'var(--muted)' }}
      activeProps={{ className: 'rv-mobile-tab-active', style: { color: 'var(--primary)' } }}
    >
      <span className="rv-mobile-tab-glyph leading-none" aria-hidden>
        <NavigationGlyph name={item.icon} className="h-[19px] w-[19px]" />
      </span>
      <span className="skin-label block w-full leading-[1.25]">{item.label}</span>
    </Link>
  )
}

/** Bottom tab bar for narrow screens — the app-like navigation a PWA install expects. The old
 *  scrollable pill row clipped nine of ten destinations invisibly behind the Add button. */
function MobileTabBar({
  householdAdd,
  arrangement,
  guidance,
}: {
  householdAdd: boolean
  arrangement: ArrangementConfig
  guidance?: Guidance | null
}) {
  const { signOut } = useAuth()
  const [moreOpen, setMoreOpen] = useState(false)
  const pathname = useRouterState({ select: (s) => s.location.pathname })
  const { priority: tabItems, other } = guidedNavigation(arrangement, guidance, pathname)
  const moreItems: NavigationItem[] = [
    ...other,
    { label: 'Appearance', to: '/skins', icon: 'skins' },
    { label: 'Settings', to: '/settings', icon: 'settings' },
  ]

  // navigating anywhere closes the sheet; Escape closes it too
  useEffect(() => setMoreOpen(false), [pathname])
  useEffect(() => {
    if (!moreOpen) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [moreOpen])

  const moreActive = moreItems.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  )

  return (
    <>
      {moreOpen && (
        <button
          type="button"
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
          className="fixed inset-0 z-30 cursor-default lg:hidden"
          style={{ background: 'color-mix(in srgb, var(--bg) 45%, transparent)' }}
        />
      )}

      {/* tone="card-solid" replaces the hand-rolled gradient this sheet carried — §7.4's collapse.
          The gradient faked opacity by stacking --card over --bg; --card-solid is the AUTHORED
          opaque plate, and in marrow/dark the two genuinely differ (composite (22,19,21) vs
          #212328, maxΔ=19) — meaning this sheet and Modal wore different colours there until now.
          radius="panel": the sheet is floating tray chrome (marrow's own token comment: "trays are
          chamfer-cut"), not a content card — the held site was never radius-ruled by batch 3. */}
      {moreOpen && (
        <Surface
          id="mobile-more-sheet"
          tone="card-solid"
          radius="panel"
          pad={0}
          raised
          className="fixed inset-x-3 z-50 p-2 lg:hidden"
          style={{ bottom: 'calc(76px + env(safe-area-inset-bottom))' }}
        >
          <nav
            className="grid grid-cols-2 gap-1 min-[480px]:grid-cols-3"
            aria-label="More destinations"
          >
            {moreItems.map((item) => (
              <Link
                key={item.to}
                to={item.to}
                className="rv-nav-item flex min-h-[62px] min-w-0 flex-col items-center justify-center gap-1.5 px-2 py-2.5 text-[13px] font-medium"
                style={{ color: 'var(--muted)' }}
                activeProps={{
                  className: 'rv-nav-item-active',
                  style: {
                    color: 'var(--ink)',
                  },
                }}
              >
                <span className="rv-nav-glyph leading-none" aria-hidden>
                  <NavigationGlyph name={item.icon} className="h-5 w-5" />
                </span>
                <span className="skin-label">{item.label}</span>
              </Link>
            ))}
          </nav>
          <div className="mt-1 border-t pt-1" style={{ borderColor: 'var(--line)' }}>
            <button
              type="button"
              onClick={() => void signOut()}
              className="skin-control skin-btn-secondary flex min-h-11 w-full items-center justify-center gap-2 px-2 py-2.5 text-[13px] font-semibold"
            >
              <PowerGlyph /> Sign out
            </button>
          </div>
        </Surface>
      )}

      <nav
        aria-label="Primary"
        className="rv-mobile-dock fixed inset-x-0 bottom-0 z-40 backdrop-blur-lg lg:hidden"
        style={{
          paddingBottom: 'env(safe-area-inset-bottom)',
        }}
      >
        <div className="rv-mobile-dock-grid grid grid-cols-5">
          <TabLink item={tabItems[0]!} />
          <TabLink item={tabItems[1]!} />
          <div className="relative flex min-h-[58px] items-start justify-center">
            <Link
              to="/add"
              data-testid="persistent-add"
              search={householdAdd ? { scope: 'household' } : {}}
              aria-label={householdAdd ? 'Add to household' : 'Add a book'}
              className="rv-mobile-add skin-control skin-btn-primary grid h-12 w-12 -translate-y-3 place-items-center text-[20px]"
            >
              <PlusGlyph className="h-5 w-5" />
            </Link>
            <span
              aria-hidden
              className="skin-label absolute bottom-1.5 text-[12px] font-semibold text-muted"
            >
              Add
            </span>
          </div>
          <TabLink item={tabItems[2]!} />
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            aria-controls="mobile-more-sheet"
            className={`${tabLink} ${moreOpen || moreActive ? 'rv-mobile-tab-active' : ''}`}
            style={{ color: moreOpen || moreActive ? 'var(--primary)' : 'var(--muted)' }}
          >
            <span className="text-[17px] leading-none" aria-hidden>
              ⋯
            </span>
            <span className="skin-label">More</span>
          </button>
        </div>
      </nav>
    </>
  )
}

export function AppShell({ children }: { children: ReactNode }) {
  const profile = useProfile().data
  const arrangement = profile?.arrangement ?? DEFAULT_ARRANGEMENT_PRESET.config
  const guidance = profile?.guidance
  const mainRef = useRef<HTMLElement>(null)
  const location = useRouterState({ select: (s) => s.location })
  const pathname = location.pathname
  const householdAdd = isHouseholdAddContext(pathname, location.search)

  // Move focus to the main content on navigation so keyboard/screen-reader users land there.
  useEffect(() => {
    mainRef.current?.focus()
  }, [pathname])

  return (
    <div className="relative flex min-h-dvh">
      <a
        href="#main"
        className="skin-control sr-only px-4 py-2 text-[13px] font-semibold focus:not-sr-only focus:absolute focus:left-3 focus:top-3 focus:z-50"
        style={{ background: 'var(--accent-fill)', color: 'var(--on-primary)' }}
      >
        Skip to content
      </a>

      <Sidebar householdAdd={householdAdd} arrangement={arrangement} guidance={guidance} />
      {guidance?.mode === 'gentle' && <GuidanceObserver key={profile?.id} />}

      <div className="flex min-w-0 flex-1 flex-col">
        <MobileBar pathname={pathname} />
        <div className="relative z-[1] px-4 lg:px-5">
          <SkinEvolveReveal />
        </div>
        <main
          ref={mainRef}
          id="main"
          tabIndex={-1}
          className="relative z-[1] flex flex-1 flex-col pb-[calc(72px+env(safe-area-inset-bottom))] outline-none lg:pb-0"
        >
          <GuidanceTrail />
          {children}
        </main>
      </div>

      <MobileTabBar householdAdd={householdAdd} arrangement={arrangement} guidance={guidance} />
    </div>
  )
}
