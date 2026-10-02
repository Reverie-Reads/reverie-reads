import { useEffect, useRef, type ReactNode } from 'react'
import { useRouter } from '@tanstack/react-router'
import { AddReturnContext, addOrigin, type AddOrigin } from './addReturn'

/** Mounted under the account key: signing out, switching account or reloading forgets the origin. */
export function AddReturnProvider({ children }: { children: ReactNode }) {
  const router = useRouter()
  const origin = useRef<AddOrigin | null>(null)
  useEffect(
    () =>
      router.subscribe('onBeforeNavigate', ({ fromLocation, toLocation }) => {
        if (toLocation.pathname !== '/add' || fromLocation?.pathname === '/add') return
        if (origin.current?.addKey && origin.current.addKey === toLocation.state.__TSR_key) return
        origin.current = addOrigin(fromLocation, toLocation)
      }),
    [router],
  )
  return <AddReturnContext.Provider value={origin}>{children}</AddReturnContext.Provider>
}
