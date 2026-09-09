import { renderHook } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useProfile } from '../data/profile'
import { useSkinSync } from './controls'
import { useSkin } from './useSkin'

vi.mock('../data/profile', () => ({ useProfile: vi.fn(), useUpdateProfile: vi.fn() }))

const mockedProfile = vi.mocked(useProfile)

describe('useSkinSync', () => {
  beforeEach(() => {
    localStorage.clear()
    useSkin.getState().hydrate('folio', 'dark', null)
    document.documentElement.setAttribute('data-appearance-pending', '')
    document.documentElement.classList.add('gold-brand')
    mockedProfile.mockReturnValue({
      data: undefined,
      isError: false,
      isFetching: true,
      isSuccess: false,
      refetch: vi.fn(),
    } as unknown as ReturnType<typeof useProfile>)
  })

  afterEach(() => {
    document.documentElement.removeAttribute('data-appearance-pending')
    document.documentElement.classList.remove('gold-brand')
  })

  it('releases a marker left by the signed-out page when a complete local room now exists', () => {
    const { result } = renderHook(() => useSkinSync())

    expect(result.current.ready).toBe(true)
    expect(document.documentElement).not.toHaveAttribute('data-appearance-pending')
    expect(document.documentElement).not.toHaveClass('gold-brand')
  })
})
