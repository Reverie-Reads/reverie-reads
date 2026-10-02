import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import type { HouseholdMember } from '../data/household'
import { AddDestinationPicker } from './AddDestinationPicker'

const members: HouseholdMember[] = [
  {
    householdId: 'house-1',
    householdName: 'Readers',
    userId: 'reader-a',
    displayName: 'Avery',
    role: 'owner',
    allowMemberLibraryAdds: false,
  },
  {
    householdId: 'house-1',
    householdName: 'Readers',
    userId: 'reader-b',
    displayName: 'Blake',
    role: 'member',
    allowMemberLibraryAdds: true,
  },
  {
    householdId: 'house-1',
    householdName: 'Readers',
    userId: 'reader-c',
    displayName: 'Casey',
    role: 'member',
    allowMemberLibraryAdds: false,
  },
]

describe('AddDestinationPicker', () => {
  it('states personal, shared, combined, and only opted-in delegated destinations', () => {
    render(
      <AddDestinationPicker
        value="both"
        onChange={vi.fn()}
        members={members}
        currentReaderId="reader-a"
      />,
    )

    expect(screen.getByRole('radio', { name: /My library \+ Household/ })).toBeChecked()
    expect(screen.getByRole('radio', { name: /My library only/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Household only/ })).toBeInTheDocument()
    expect(screen.getByRole('radio', { name: /Blake’s library \+ Household/ })).toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Casey’s library/ })).not.toBeInTheDocument()
    expect(screen.getByText(/no ownership or reading state/i)).toBeInTheDocument()
  })

  it('reports the exact destination selected by the reader', () => {
    const onChange = vi.fn()
    render(
      <AddDestinationPicker
        value="both"
        onChange={onChange}
        members={members}
        currentReaderId="reader-a"
      />,
    )

    fireEvent.click(screen.getByRole('radio', { name: /Household only/ }))
    expect(onChange).toHaveBeenCalledWith('household')
    expect(onChange).toHaveBeenCalledTimes(1)
  })

  it('records deliberate confirmation of the selected default before household loading finishes', () => {
    const onChange = vi.fn()
    render(
      <AddDestinationPicker
        value="mine"
        onChange={onChange}
        members={[]}
        currentReaderId="reader-a"
      />,
    )
    fireEvent.click(screen.getByRole('radio', { name: /My library only/ }))
    expect(onChange).toHaveBeenCalledExactlyOnceWith('mine')
  })

  it('keeps imports to the two destinations that create the reader’s personal rows', () => {
    render(
      <AddDestinationPicker
        value="mine"
        onChange={vi.fn()}
        members={members}
        currentReaderId="reader-a"
        importOnly
      />,
    )

    expect(screen.getAllByRole('radio')).toHaveLength(2)
    expect(screen.queryByRole('radio', { name: /Household only/ })).not.toBeInTheDocument()
    expect(screen.queryByRole('radio', { name: /Blake/ })).not.toBeInTheDocument()
  })
})
