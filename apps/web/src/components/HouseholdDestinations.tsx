import type { ReactNode } from 'react'
import { DestinationContext } from './householdDestinationsContext'
import { useHouseholdDestinationAuthorization } from '../data/household'

/** One account-keyed observer starts before Add, without fetching household books.
 * The full library retains its independent, freshly validated authorization boundary.
 */
export function HouseholdDestinations({ children }: { children: ReactNode }) {
  const household = useHouseholdDestinationAuthorization()
  return <DestinationContext.Provider value={household}>{children}</DestinationContext.Provider>
}
