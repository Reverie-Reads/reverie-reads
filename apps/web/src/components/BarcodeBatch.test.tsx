import { useState } from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { BarcodeCapture } from '@reverie/core'
import { BarcodeBatch } from './BarcodeBatch'
const camera = vi.hoisted(() => ({ state: 'off', error: '', start: vi.fn(), stop: vi.fn() }))
vi.mock('../scanning/useBarcodeCamera', () => ({ useBarcodeCamera: () => camera }))
function Host({ onReview = vi.fn() }: { onReview?: (item: BarcodeCapture) => void }) {
  const [items, setItems] = useState<BarcodeCapture[]>([])
  return <BarcodeBatch items={items} onChange={setItems} onReview={onReview} />
}
function enter(value: string) {
  fireEvent.change(screen.getByLabelText('ISBN or connected scanner input'), { target: { value } })
  fireEvent.click(screen.getByRole('button', { name: 'Capture ISBN' }))
}
beforeEach(() => vi.clearAllMocks())
describe('bulk scan review list', () => {
  it('defaults to page-only storage and lets a durable host report its actual save status', () => {
    const { rerender } = render(<BarcodeBatch items={[]} onChange={vi.fn()} onReview={vi.fn()} />)
    expect(screen.getByText(/Captures stay on this page only/)).toBeInTheDocument()
    rerender(
      <BarcodeBatch
        items={[]}
        onChange={vi.fn()}
        onReview={vi.fn()}
        storageNotice="Saved on this device. Waiting to sync."
      />,
    )
    expect(screen.queryByText(/Captures stay on this page only/)).not.toBeInTheDocument()
    expect(screen.getByText(/Saved on this device. Waiting to sync./)).toBeInTheDocument()
  })
  it('captures typed/wedge input without review or save and rejects invalid input', () => {
    const review = vi.fn()
    render(<Host onReview={review} />)
    enter('9780141439519')
    expect(screen.getByRole('heading', { name: 'Captured books · 0' })).toBeInTheDocument()
    expect(screen.getByRole('status')).toHaveTextContent('not a valid book ISBN')
    enter('9780141439518')
    expect(screen.getByRole('heading', { name: 'Captured books · 1' })).toBeInTheDocument()
    expect(review).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review capture 1: 9780141439518' }))
    expect(review).toHaveBeenCalledWith(
      expect.objectContaining({ isbn: '9780141439518', source: 'manual' }),
    )
  })
  it('ignores a repeat or explicitly retains another copy with a distinct identity', () => {
    const review = vi.fn()
    render(<Host onReview={review} />)
    enter('9780141439518')
    enter('0141439513')
    expect(screen.getByRole('group', { name: 'Repeated ISBN' })).toBeInTheDocument()
    expect(camera.stop).toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Ignore repeat' }))
    expect(screen.getByRole('heading', { name: 'Captured books · 1' })).toBeInTheDocument()
    enter('9780141439518')
    fireEvent.click(screen.getByRole('button', { name: 'Another copy' }))
    expect(screen.getByRole('heading', { name: 'Captured books · 2' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: 'Review capture 1: 9780141439518' }))
    fireEvent.click(screen.getByRole('button', { name: 'Review capture 2: 9780141439518' }))
    expect(review.mock.calls[0]![0].id).not.toBe(review.mock.calls[1]![0].id)
    fireEvent.click(screen.getByRole('button', { name: 'Remove capture 1: 9780141439518' }))
    expect(screen.getByRole('heading', { name: 'Captured books · 1' })).toBeInTheDocument()
  })
})
