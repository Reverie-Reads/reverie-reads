import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { CorpusCoverReviewToggle } from '../components/CorpusCoverReviewToggle'
import { corpusCoverReviewIsUnavailable } from './BookDetailRoute'

describe('CorpusCoverReviewToggle', () => {
  it('treats paused or otherwise unloaded query state as unavailable', () => {
    expect(
      corpusCoverReviewIsUnavailable({
        data: undefined,
        isFetching: false,
        isError: false,
        fetchStatus: 'paused',
      }),
    ).toBe(true)
    expect(
      corpusCoverReviewIsUnavailable({
        data: false,
        isFetching: false,
        isError: false,
        fetchStatus: 'paused',
      }),
    ).toBe(true)
    expect(
      corpusCoverReviewIsUnavailable({
        data: undefined,
        isFetching: false,
        isError: false,
        fetchStatus: 'idle',
      }),
    ).toBe(true)
    expect(
      corpusCoverReviewIsUnavailable({
        data: false,
        isFetching: false,
        isError: false,
        fetchStatus: 'idle',
      }),
    ).toBe(false)
  })

  it('starts off and publishes only after the administrator explicitly turns it on', () => {
    const review = vi.fn()
    render(
      <CorpusCoverReviewToggle
        reviewed={false}
        loading={false}
        unavailable={false}
        saving={false}
        onReview={review}
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Review personal cover for corpus' })
    expect(toggle).toHaveAttribute('aria-checked', 'false')
    expect(screen.getByText(/Off until an administrator explicitly reviews/)).toBeInTheDocument()

    fireEvent.click(toggle)
    expect(review).toHaveBeenCalledOnce()
  })

  it('shows the reviewed state as an accepted one-way corpus option', () => {
    const review = vi.fn()
    render(
      <CorpusCoverReviewToggle
        reviewed
        loading={false}
        unavailable={false}
        saving={false}
        onReview={review}
      />,
    )

    const toggle = screen.getByRole('switch', { name: 'Personal cover reviewed for corpus' })
    expect(toggle).toHaveAttribute('aria-checked', 'true')
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/available as a shared cover option/)).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(review).not.toHaveBeenCalled()
  })

  it('cannot submit while review state is loading or a publication is pending', () => {
    const review = vi.fn()
    const { rerender } = render(
      <CorpusCoverReviewToggle
        reviewed={false}
        loading
        unavailable={false}
        saving={false}
        onReview={review}
      />,
    )
    expect(screen.getByRole('switch')).toBeDisabled()

    rerender(
      <CorpusCoverReviewToggle
        reviewed={false}
        loading={false}
        unavailable={false}
        saving
        onReview={review}
      />,
    )
    expect(screen.getByRole('switch')).toBeDisabled()
  })

  it('refuses review when the accepted-option query failed instead of presenting a false off state', () => {
    const review = vi.fn()
    render(
      <CorpusCoverReviewToggle
        reviewed={false}
        loading={false}
        unavailable
        saving={false}
        onReview={review}
      />,
    )

    const toggle = screen.getByRole('switch', {
      name: 'Personal cover review status unavailable',
    })
    expect(toggle).toBeDisabled()
    expect(screen.getByText(/Review status is unavailable/)).toBeInTheDocument()
    fireEvent.click(toggle)
    expect(review).not.toHaveBeenCalled()
  })
})

it('opens the cover picker for a saved display-only image without submitting a corpus review', () => {
  const review = vi.fn()
  const choose = vi.fn()
  render(
    <CorpusCoverReviewToggle
      reviewed={false}
      loading={false}
      saving={false}
      unavailable={false}
      onReview={review}
      onChooseImage={choose}
    />,
  )
  expect(screen.getByText(/This cover is saved in your library/)).toBeVisible()
  expect(screen.getByRole('switch')).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Open cover picker' }))
  expect(choose).toHaveBeenCalledOnce()
  expect(review).not.toHaveBeenCalled()
})
