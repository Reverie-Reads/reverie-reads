import { createContext, useContext } from 'react'
import type { useHouseholdDestinationAuthorization } from '../data/household'

export const DestinationContext = createContext<ReturnType<
  typeof useHouseholdDestinationAuthorization
> | null>(null)

export function useAddDestinations() {
  const household = useContext(DestinationContext)
  if (!household) throw new Error('Add requires the signed-in destination provider')
  return household
}
