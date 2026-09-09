import { useLayoutEffect, useRef } from 'react'
import type { ActiveSkin, AdaptivePending, Mode } from '@reverie/core'
import { useProfile, useUpdateProfile } from '../data/profile'
import { useBooks } from '../data/books'
import { finishAppearanceBootstrap, hasStoredAppearance, useSkin } from './useSkin'
import { generateAdaptiveBundle, materializeAdaptive } from './adaptive'

/**
 * Setters that apply a skin/mode change locally (instant) AND persist it to the profile
 * (cross-device). Use these from any signed-in surface instead of the raw store setters.
 */
export function useSkinControls() {
  const setSkinLocal = useSkin((s) => s.setSkin)
  const setModeLocal = useSkin((s) => s.setMode)
  const update = useUpdateProfile()
  return {
    setSkin: (id: ActiveSkin) => {
      setSkinLocal(id)
      update.mutate({ skin: id })
    },
    setMode: (mode: Mode) => {
      setModeLocal(mode)
      update.mutate({ mode })
    },
  }
}

/**
 * Adaptive-skin actions: regenerate from the current library, keep (adopt), revert (back to a
 * Tier-1 skin), and lock/unlock (freeze against future auto-evolution). All persist to the profile.
 */
export function useAdaptiveControls() {
  const { data: books } = useBooks()
  const setSkinLocal = useSkin((s) => s.setSkin)
  const setBundle = useSkin((s) => s.setAdaptiveBundle)
  const update = useUpdateProfile()

  return {
    /** Recompute the blend from the library, store + adopt it. */
    regenerate: () => {
      const bundle = generateAdaptiveBundle(books ?? [])
      setBundle(bundle)
      setSkinLocal('adaptive')
      update.mutate({ adaptiveSkin: bundle, skin: 'adaptive' })
      return bundle
    },
    /** Adopt the already-generated adaptive skin as active. */
    keep: () => {
      setSkinLocal('adaptive')
      update.mutate({ skin: 'adaptive' })
    },
    /** Switch away from adaptive to a Tier-1 skin (defaults to the blend's dominant). */
    revert: (to: ActiveSkin) => {
      setSkinLocal(to)
      update.mutate({ skin: to })
    },
    setLocked: (locked: boolean) => update.mutate({ adaptiveLocked: locked }),

    /** Reveal "keep": adopt the cron's suggestion (materialize its palette), clear the pending, and
     *  drop any stale dismissal — the adopted taste is the new baseline. */
    acceptPending: (pending: AdaptivePending) => {
      const bundle = materializeAdaptive(pending)
      setBundle(bundle)
      setSkinLocal('adaptive')
      update.mutate({
        adaptiveSkin: bundle,
        skin: 'adaptive',
        adaptivePending: null,
        adaptiveDismissed: null,
      })
    },
    /** Reveal "not now": keep the current skin, clear the pending, and REMEMBER the dismissed signal
     *  so the cron won't re-nag the same shift — it resurfaces only if taste drifts materially past
     *  it (the merge-verdicts "remember the no" pattern). */
    dismissPending: (pending: AdaptivePending) =>
      update.mutate({ adaptivePending: null, adaptiveDismissed: pending }),
    /** Reveal "lock": freeze the current skin; clear pending + dismissal (lock means never ask). */
    lockPending: () =>
      update.mutate({ adaptiveLocked: true, adaptivePending: null, adaptiveDismissed: null }),
  }
}

/** Reconcile the store with the signed-in profile (the cross-device source of truth). Applies
 * whenever the profile's skin/mode/adaptive bundle change — on sign-in, and if another device
 * updates them. No loop: the controls update store + profile together, so an echo is a no-op. */
export function useSkinSync() {
  const profileQuery = useProfile()
  const profile = profileQuery.data
  const hydrate = useSkin((s) => s.hydrate)
  const sig = useRef('')
  const locallyReady = useRef(hasStoredAppearance()).current
  const skin = profile?.skin
  const mode = profile?.mode
  const bundle = profile?.adaptiveSkin ?? null
  // The signed-out landing can create a complete local choice after index.html marked the original
  // load as pending. If sign-in happens in that same document, release the marker before revealing
  // the shell; the store has already applied the reader's local choice.
  useLayoutEffect(() => {
    if (locallyReady) finishAppearanceBootstrap()
  }, [locallyReady])
  // Layout timing is deliberate. On a first sign-in there is no trusted local appearance, so the
  // entry screen stays visible while this query runs. Once data arrives, apply both appearance axes
  // and remove the pre-paint cover before the browser can reveal the signed-in shell.
  useLayoutEffect(() => {
    if (!skin || !mode) return
    const next = `${skin}|${mode}|${bundle ? 'b' : '0'}`
    if (next !== sig.current) {
      sig.current = next
      hydrate(skin, mode, bundle)
    }
    finishAppearanceBootstrap()
  }, [skin, mode, bundle, hydrate])

  return {
    ready: locallyReady || Boolean(skin && mode),
    unavailable:
      !locallyReady &&
      !profileQuery.isFetching &&
      (profileQuery.isError || (profileQuery.isSuccess && (!skin || !mode))),
    retry: () => void profileQuery.refetch(),
  }
}
