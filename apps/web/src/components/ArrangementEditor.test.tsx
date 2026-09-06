import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'

const state = vi.hoisted(() => ({
  mutate: vi.fn(),
  refetch: vi.fn(),
  profilePending: false,
  arrangement: {
    destinations: ['home', 'match', 'library'],
    homeModules: ['next-read', 'reading', 'priority'],
  },
}))

vi.mock('../data/profile', () => ({
  useProfile: () => ({
    data: state.profilePending ? undefined : { id: 'reader', arrangement: state.arrangement },
    isPending: state.profilePending,
    isError: false,
    refetch: state.refetch,
  }),
  useUpdateProfile: () => ({ mutate: state.mutate, isPending: false }),
}))

const { ArrangementEditor } = await import('./ArrangementEditor')

beforeEach(() => {
  vi.clearAllMocks()
  state.profilePending = false
  state.arrangement = {
    destinations: ['home', 'match', 'library'],
    homeModules: ['next-read', 'reading', 'priority'],
  }
  state.mutate.mockImplementation((_value: unknown, options: { onSuccess?: () => void }) =>
    options.onSuccess?.(),
  )
})

describe('ArrangementEditor', () => {
  it('does not accept edits before the account arrangement has loaded', () => {
    state.profilePending = true
    render(<ArrangementEditor />)

    expect(screen.getByRole('status')).toHaveTextContent('Preparing your saved arrangement')
    expect(screen.queryByRole('button', { name: /Remember my reading/ })).not.toBeInTheDocument()
  })

  it('saves a chosen starting arrangement explicitly', () => {
    render(<ArrangementEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Keep my books close/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save arrangement' }))

    expect(state.mutate).toHaveBeenCalledWith(
      {
        arrangement: {
          destinations: ['library', 'home', 'shelves'],
          homeModules: ['priority', 'reading', 'releases'],
        },
      },
      expect.objectContaining({ onSuccess: expect.any(Function), onError: expect.any(Function) }),
    )
    expect(screen.getByText(/follow this account across devices/)).toBeInTheDocument()
  })

  it('keeps the saved confirmation when the profile query refreshes', () => {
    const view = render(<ArrangementEditor />)

    fireEvent.click(screen.getByRole('button', { name: /Remember my reading/ }))
    fireEvent.click(screen.getByRole('button', { name: 'Save arrangement' }))
    state.arrangement = {
      destinations: ['home', 'library', 'stats'],
      homeModules: ['reading', 'year', 'priority'],
    }
    view.rerender(<ArrangementEditor />)

    expect(screen.getByRole('status')).toHaveTextContent('Arrangement saved')
  })

  it('requires a complete trio after hiding a destination', () => {
    render(<ArrangementEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide Home from close at hand' }))
    expect(screen.getByRole('button', { name: 'Save arrangement' })).toBeDisabled()
    expect(screen.getByText(/Choose one more destination/)).toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: '+ Discover' }))
    expect(screen.getByRole('button', { name: 'Save arrangement' })).toBeEnabled()
  })

  it('keeps navigation edits independent from Home modules', () => {
    render(<ArrangementEditor />)

    fireEvent.click(screen.getByRole('button', { name: 'Hide Next read from close at hand' }))
    expect(screen.getByText('Choose a next read')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Hide Choose a next read from Home' })).toBeEnabled()
  })
})
