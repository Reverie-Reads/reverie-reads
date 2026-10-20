import type { SkinId } from '@reverie/core'
import { useSkin } from '../../src/skin/useSkin'

// Extra entry in browser-test builds only, sharing the application's actual store instance.
export async function setAppearance(skin: SkinId, mode: 'light' | 'dark'): Promise<void> {
  useSkin.getState().setSkin(skin)
  useSkin.getState().setMode(mode)
  await document.fonts.ready
}
