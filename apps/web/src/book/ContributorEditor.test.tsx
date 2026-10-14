import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import type { Contributor } from '@reverie/core'
import { ContributorEditor } from './ContributorEditor'

function Editor() {
  const [value, setValue] = useState<Contributor[]>([
    { name: 'Parker Lennox', role: 'co_author', position: 0 },
    { name: 'Bree Greenwich', role: 'author', position: 1 },
  ])
  return <ContributorEditor value={value} onChange={setValue} />
}
describe('contributor ordering', () => {
  it('moves the displayed names and roles in both directions', () => {
    render(<Editor />)
    fireEvent.click(screen.getByRole('button', { name: 'Move Bree Greenwich up' }))
    expect(screen.getByLabelText('Contributor 1 name')).toHaveValue('Bree Greenwich')
    expect(screen.getByLabelText('Contributor 1 role')).toHaveValue('author')
    fireEvent.click(screen.getByRole('button', { name: 'Move Bree Greenwich down' }))
    expect(screen.getByLabelText('Contributor 1 name')).toHaveValue('Parker Lennox')
    expect(screen.getByLabelText('Contributor 2 role')).toHaveValue('author')
  })
})
