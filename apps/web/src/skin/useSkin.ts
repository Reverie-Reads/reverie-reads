import { create } from 'zustand'
import {
  ADAPTIVE_CARRY_KEYS,
  ADAPTIVE_COLOR_KEYS,
  DEFAULT_SKIN,
  isActiveSkin,
  isMode,
  type ActiveSkin,
  type AdaptiveBundle,
  type Mode,
  type ResolvedMode,
} from '@reverie/core'
import { adaptiveVars } from './adaptive'
import { loadSkinFont } from './fonts'
import type { SkinId } from '@reverie/core'

// Skin and light/dark MODE are independent axes, both persisted. localStorage gives an instant,
// flash-free apply (the index.html boot script reads the same keys pre-paint); the profile is the
// cross-device source of truth and is reconciled on sign-in via hydrate(). The adaptive skin is a
// generated palette applied as inline custom properties on <html> (no stylesheet block exists).
const SKIN_KEY = 'reverie.skin'
const MODE_KEY = 'reverie.mode'
const APPEARANCE_PENDING_ATTRIBUTE = 'data-appearance-pending'
const GOLD_BRAND_CLASS = 'gold-brand'
const ADAPTIVE_VAR_KEYS = [...ADAPTIVE_COLOR_KEYS, ...ADAPTIVE_CARRY_KEYS]

function safeStorage(): Storage | null {
  try {
    if (typeof window !== 'undefined' && window.localStorage) return window.localStorage
  } catch {
    /* private mode / denied */
  }
  return null
}

function systemMode(): ResolvedMode {
  return typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-color-scheme: light)').matches
      ? 'light'
      : 'dark'
    : 'dark'
}

export function resolveMode(mode: Mode): ResolvedMode {
  return mode === 'system' ? systemMode() : mode
}

function readInitialSkin(): ActiveSkin {
  const s = safeStorage()?.getItem(SKIN_KEY)
  return isActiveSkin(s) ? s : DEFAULT_SKIN
}
function readInitialMode(): Mode {
  const m = safeStorage()?.getItem(MODE_KEY)
  return isMode(m) ? m : 'system'
}

/** Whether this device can paint the reader's last room without waiting for their profile.
 * Both axes matter: a saved room with an unknown mode can still produce the wrong first surface. */
export function hasStoredAppearance(): boolean {
  const storage = safeStorage()
  if (!storage) return false
  const skin = storage.getItem(SKIN_KEY)
  // Adaptive's generated palette lives in the profile, not localStorage. Its id alone cannot
  // reconstruct the room, so it follows the same profile-first entry path as a new device.
  return isActiveSkin(skin) && skin !== 'adaptive' && isMode(storage.getItem(MODE_KEY))
}

/** Release index.html's neutral first-paint treatment after the saved room has been applied. */
export function finishAppearanceBootstrap(): void {
  if (typeof document === 'undefined') return
  document.documentElement.removeAttribute(APPEARANCE_PENDING_ATTRIBUTE)
  document.documentElement.classList.remove(GOLD_BRAND_CLASS)
}

/** Reflect the active skin + resolved mode onto <html>; for adaptive, paint the generated palette. */
function apply(skin: ActiveSkin, mode: Mode, bundle: AdaptiveBundle | null): void {
  if (typeof document === 'undefined') return
  const root = document.documentElement
  const resolved = resolveMode(mode)
  root.dataset.skin = skin
  root.dataset.mode = resolved
  // Load only this skin's font pairing (adaptive borrows its dominant Tier-1 skin's type).
  loadSkinFont(
    skin === 'adaptive' ? ((bundle?.dominant as SkinId) ?? DEFAULT_SKIN) : (skin as SkinId),
  )
  if (skin === 'adaptive' && bundle) {
    const vars = adaptiveVars(bundle, resolved)
    for (const k of ADAPTIVE_VAR_KEYS) {
      const v = vars[k]
      if (v) root.style.setProperty(k, v)
    }
  } else {
    for (const k of ADAPTIVE_VAR_KEYS) root.style.removeProperty(k)
  }
}

interface SkinState {
  skin: ActiveSkin
  mode: Mode
  resolvedMode: ResolvedMode
  /** the generated adaptive palette (loaded from the profile), needed to paint the adaptive skin */
  adaptiveBundle: AdaptiveBundle | null
  setSkin: (skin: ActiveSkin) => void
  setMode: (mode: Mode) => void
  setAdaptiveBundle: (bundle: AdaptiveBundle | null) => void
  /** Apply a profile-sourced choice (sign-in reconciliation); persists to localStorage too. */
  hydrate: (skin: ActiveSkin, mode: Mode, bundle: AdaptiveBundle | null) => void
}

export const useSkin = create<SkinState>((set, get) => ({
  skin: readInitialSkin(),
  mode: readInitialMode(),
  resolvedMode: resolveMode(readInitialMode()),
  adaptiveBundle: null,
  setSkin: (skin) => {
    apply(skin, get().mode, get().adaptiveBundle)
    safeStorage()?.setItem(SKIN_KEY, skin)
    set({ skin })
  },
  setMode: (mode) => {
    apply(get().skin, mode, get().adaptiveBundle)
    safeStorage()?.setItem(MODE_KEY, mode)
    set({ mode, resolvedMode: resolveMode(mode) })
  },
  setAdaptiveBundle: (bundle) => {
    apply(get().skin, get().mode, bundle)
    set({ adaptiveBundle: bundle })
  },
  hydrate: (skin, mode, bundle) => {
    apply(skin, mode, bundle)
    safeStorage()?.setItem(SKIN_KEY, skin)
    safeStorage()?.setItem(MODE_KEY, mode)
    set({ skin, mode, resolvedMode: resolveMode(mode), adaptiveBundle: bundle })
  },
}))

// Apply once on load (mirrors the pre-paint boot script), and keep 'system' mode live.
apply(useSkin.getState().skin, useSkin.getState().mode, useSkin.getState().adaptiveBundle)
if (typeof window !== 'undefined' && typeof window.matchMedia === 'function') {
  window.matchMedia('(prefers-color-scheme: light)').addEventListener?.('change', () => {
    const { mode, skin, adaptiveBundle } = useSkin.getState()
    if (mode === 'system') {
      apply(skin, 'system', adaptiveBundle)
      useSkin.setState({ resolvedMode: systemMode() })
    }
  })
}
