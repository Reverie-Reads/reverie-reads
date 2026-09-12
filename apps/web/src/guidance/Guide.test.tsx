import type { ReactNode } from 'react'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { Guidance } from './model'
import { GuideScreen } from './Guide'
import { registerGuideChapterDetails, type GuideChapterDetailsProps } from './chapterDetailsSlot'

const state = vi.hoisted(() => ({
  guidance: null as Guidance | null,
  isError: false,
  mutate: vi.fn(),
}))
vi.mock('../data/profile', () => ({
  useProfile: () => ({ data: { guidance: state.guidance }, isError: state.isError }),
}))
vi.mock('./data', () => ({ useUpdateGuidance: () => ({ mutate: state.mutate }) }))
vi.mock('@tanstack/react-router', () => ({
  Link: ({ to, children }: { to: string; children: ReactNode }) => <a href={to}>{children}</a>,
}))

let unregister: (() => void) | undefined
beforeEach(() => {
  state.guidance = {
    version: 1,
    mode: 'full',
    setupComplete: true,
    milestones: [],
    revealed: [],
    tour: null,
  }
  state.isError = false
  state.mutate.mockClear()
})
afterEach(() => {
  cleanup()
  unregister?.()
  unregister = undefined
})

function ExtraDetails({ chapterId, expanded }: GuideChapterDetailsProps) {
  return (
    <details open={expanded}>
      <summary>Extra tools for {chapterId}</summary>Reader guidance
    </details>
  )
}

describe('guide chapter extensions', () => {
  it('keeps the complete core guide usable without an extension', () => {
    render(<GuideScreen />)
    expect(screen.getByRole('heading', { name: 'Bring your books home' })).toBeTruthy()
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a stop' }), {
      target: { value: 'privacy' },
    })
    expect(screen.getByRole('link', { name: 'Open Settings' }).getAttribute('href')).toBe(
      '/settings',
    )
    expect(screen.queryByText(/Extra tools/)).toBeNull()
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it('follows the selected chapter without saving progress or altering the core tour', () => {
    unregister = registerGuideChapterDetails(ExtraDetails)
    render(<GuideScreen />)
    expect(screen.getByText('Extra tools for books').closest('details')?.open).toBe(false)
    fireEvent.change(screen.getByRole('combobox', { name: 'Choose a stop' }), {
      target: { value: 'choose' },
    })
    expect(screen.getByText('Extra tools for choose')).toBeTruthy()
    expect(screen.queryByText('Extra tools for books')).toBeNull()
    expect(screen.getByRole('link', { name: 'Open Next read' }).getAttribute('href')).toBe('/match')
    expect(state.mutate).not.toHaveBeenCalled()
  })

  it.each(['full', 'gentle'] as const)(
    'opens explanations only for the full active tour: %s',
    (mode) => {
      state.guidance = { ...state.guidance!, mode, tour: 'books' }
      unregister = registerGuideChapterDetails(ExtraDetails)
      render(<GuideScreen />)
      expect(screen.getByText('Extra tools for books').closest('details')?.open).toBe(
        mode === 'full',
      )
      expect(screen.getByText(`Walkthrough · Stop 1 of ${mode === 'gentle' ? 4 : 10}`)).toBeTruthy()
    },
  )

  it('does not mount optional content when the profile cannot be loaded', () => {
    state.isError = true
    unregister = registerGuideChapterDetails(ExtraDetails)
    render(<GuideScreen />)
    expect(screen.getByRole('alert').textContent).toContain('Your guide could not be loaded')
    expect(screen.queryByText(/Extra tools/)).toBeNull()
  })
})
