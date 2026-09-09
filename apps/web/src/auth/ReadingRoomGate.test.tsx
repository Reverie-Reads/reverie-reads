import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingRoomGate } from './ReadingRoomGate'
import { useSkinSync } from '../skin/controls'

vi.mock('../skin/controls', () => ({ useSkinSync: vi.fn() }))

const mockedSync = vi.mocked(useSkinSync)

describe('ReadingRoomGate', () => {
  beforeEach(() => {
    localStorage.clear()
    document.documentElement.setAttribute('data-appearance-pending', '')
    document.documentElement.classList.add('gold-brand')
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-appearance-pending')
    document.documentElement.classList.remove('gold-brand')
  })

  it('keeps the signed-in application out of the tree until the room is ready', () => {
    mockedSync.mockReturnValue({ ready: false, unavailable: false, retry: vi.fn() })
    render(
      <ReadingRoomGate>
        <p>Private library</p>
      </ReadingRoomGate>,
    )

    expect(screen.getByRole('status')).toHaveTextContent('Opening your reading room')
    expect(screen.queryByText('Private library')).not.toBeInTheDocument()
    expect(screen.getByRole('main')).toHaveAttribute('aria-busy', 'true')
  })

  it('offers recovery without implying that library data was lost', () => {
    const retry = vi.fn()
    mockedSync.mockReturnValue({ ready: false, unavailable: true, retry })
    render(
      <ReadingRoomGate>
        <p>Private library</p>
      </ReadingRoomGate>,
    )

    expect(screen.getByRole('heading', { name: 'Your room is out of reach.' })).toBeVisible()
    expect(screen.getByText(/Your library is unchanged/)).toBeVisible()
    fireEvent.click(screen.getByRole('button', { name: 'Try again' }))
    expect(retry).toHaveBeenCalledOnce()

    fireEvent.click(screen.getByRole('button', { name: 'Use default room' }))
    expect(screen.getByText('Private library')).toBeVisible()
    expect(localStorage.getItem('reverie.skin')).toBe('tryst')
    expect(localStorage.getItem('reverie.mode')).toBe('system')
    expect(document.documentElement).not.toHaveAttribute('data-appearance-pending')
  })

  it('reveals the signed-in application as soon as its room is ready', () => {
    mockedSync.mockReturnValue({ ready: true, unavailable: false, retry: vi.fn() })
    render(
      <ReadingRoomGate>
        <p>Private library</p>
      </ReadingRoomGate>,
    )

    expect(screen.getByText('Private library')).toBeVisible()
    expect(screen.queryByText('Opening your reading room…')).not.toBeInTheDocument()
  })
})
