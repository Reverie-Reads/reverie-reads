import { createContext, useContext } from 'react'
import { useRouter, type ParsedLocation } from '@tanstack/react-router'
import { navigationLabelForPath } from './navigation'

export interface AddOrigin {
  href: string
  label: string
  index: number
  addKey: string | undefined
}

/** Only an observed, in-app entry is remembered. No URL-supplied return target or persistence. */
export function addOrigin(
  from: ParsedLocation<Record<string, unknown>> | undefined,
  to: ParsedLocation,
): AddOrigin | null {
  if (!from || to.pathname !== '/add' || from.pathname === '/add') return null
  if (
    !/^\/(?:$|library$|shelves$|shelf\/|book\/|planner$|match$|discover$|series(?:\/|$)|tropes(?:\/|$)|moods\/|clubs?$|club\/|list\/|indie$|skins$|settings(?:\/|$)|covers$|stats$)/.test(
      from.pathname,
    )
  )
    return null
  return {
    href: from.href,
    label:
      from.pathname === '/library'
        ? from.search.scope === 'household'
          ? 'Return to your household'
          : 'Return to your library'
        : `Return to ${navigationLabelForPath(from.pathname)}`,
    index: from.state.__TSR_index,
    addKey: to.state.__TSR_key,
  }
}

export const AddReturnContext = createContext<{ current: AddOrigin | null } | null>(null)

export function useAddReturn() {
  const memory = useContext(AddReturnContext)
  const router = useRouter()
  const origin = memory?.current
  return origin
    ? {
        label: origin.label,
        returnToOrigin: () => {
          // Returning through the actual entry restores its scroll and history state. Replaced or
          // intervening entries use the captured internal URL without guessing how many steps to undo.
          if (router.state.location.state.__TSR_index === origin.index + 1) router.history.back()
          else void router.navigate({ href: origin.href, replace: true })
        },
      }
    : null
}
