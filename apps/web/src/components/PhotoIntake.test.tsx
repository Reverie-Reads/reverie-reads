import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { PhotoIntake } from './PhotoIntake'
import type { LocalPhoto } from '../scanning/photoInput'
const { load, decode } = vi.hoisted(() => ({ load: vi.fn(), decode: vi.fn() }))
vi.mock('../scanning/photoInput', () => ({ loadLocalPhoto: load, photoCropCanvas: vi.fn() }))
vi.mock('../scanning/barcodeDecoder', () => ({ createBarcodeDecoder: async () => decode }))
const source = (): LocalPhoto => ({
  original: new File(['source'], 'photo.jpg'),
  originalSha256: 'a'.repeat(64),
  normalizedSha256: 'b'.repeat(64),
  orientation: 1,
  encodedWidth: 800,
  encodedHeight: 1200,
  canvas: Object.assign(document.createElement('canvas'), { width: 800, height: 1200 }),
  url: 'blob:private-photo',
  dispose: vi.fn(),
})
beforeEach(() => {
  load.mockReset()
  decode.mockReset().mockResolvedValue(['9780306406157'])
})
async function upload(photo = source()) {
  load.mockResolvedValueOnce(photo)
  fireEvent.click(screen.getByLabelText('I have permission to process these photos locally.'))
  fireEvent.change(screen.getByLabelText('Title-page photo'), {
    target: { files: [new File(['private'], 'page.jpg', { type: 'image/jpeg' })] },
  })
  await screen.findByAltText('title source pixels')
  return photo
}
describe('photo review boundary', () => {
  it('requires pixel review and valid selected identity, never deriving edition facts or auto-searching', async () => {
    const search = vi.fn(),
      review = vi.fn()
    render(<PhotoIntake onSearch={search} onReview={review} />)
    await upload()
    expect(search).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
    expect(screen.getByLabelText('Reviewed title')).toHaveValue('')
    expect(screen.getByLabelText('Selected edition ISBN (optional)')).toHaveValue('')
    fireEvent.change(screen.getByLabelText('Reviewed title'), {
      target: { value: 'Quiet Gardens' },
    })
    fireEvent.change(screen.getByLabelText('Whole-work authors, one full name per line'), {
      target: { value: 'Jane Mira Vale\nAvery Reader' },
    })
    fireEvent.click(screen.getByRole('button', { name: 'Use observed ISBN 9780306406157' }))
    expect(screen.getByRole('button', { name: 'Review in Add' })).toBeDisabled()
    fireEvent.click(screen.getByLabelText(/I inspected the source pixels/))
    fireEvent.click(screen.getByRole('button', { name: 'Search for candidates' }))
    expect(search).toHaveBeenCalledWith('9780306406157')
    expect(review).not.toHaveBeenCalled()
    fireEvent.click(screen.getByRole('button', { name: 'Review in Add' }))
    expect(review).toHaveBeenCalledExactlyOnceWith({
      title: 'Quiet Gardens',
      authors: ['Jane Mira Vale', 'Avery Reader'],
      isbn: '9780306406157',
    })
    fireEvent.change(screen.getByLabelText('Selected edition ISBN (optional)'), {
      target: { value: '9780306406158' },
    })
    expect(screen.getByRole('button', { name: 'Review in Add' })).toBeDisabled()
  })
  it('retains unsent identity across replacement and requires renewed review without counting extra copies', async () => {
    render(<PhotoIntake onSearch={vi.fn()} onReview={vi.fn()} />)
    const prior = await upload()
    fireEvent.change(screen.getByLabelText('Reviewed title'), {
      target: { value: 'My deliberate title' },
    })
    fireEvent.click(screen.getByLabelText(/I inspected the source pixels/))
    load.mockResolvedValueOnce(source())
    fireEvent.change(screen.getByLabelText('Title-page photo'), {
      target: { files: [new File(['second'], 'page.jpg')] },
    })
    await waitFor(() => expect(prior.dispose).toHaveBeenCalledTimes(1))
    expect(screen.getAllByAltText('title source pixels')).toHaveLength(1)
    expect(screen.getByLabelText('Reviewed title')).toHaveValue('My deliberate title')
    expect(screen.getByLabelText(/I inspected the source pixels/)).not.toBeChecked()
  })
  it('discards a late decode after the account-keyed component unmounts', async () => {
    const photo = source()
    let finish!: (value: LocalPhoto) => void
    load.mockImplementationOnce(() => new Promise<LocalPhoto>((r) => (finish = r)))
    const review = vi.fn(),
      search = vi.fn(),
      view = render(<PhotoIntake key="account-a" onSearch={search} onReview={review} />)
    fireEvent.click(screen.getByLabelText('I have permission to process these photos locally.'))
    fireEvent.change(screen.getByLabelText('Cover photo'), {
      target: { files: [new File(['private'], 'cover.jpg')] },
    })
    view.rerender(<PhotoIntake key="account-b" onSearch={search} onReview={review} />)
    await act(async () => finish(photo))
    expect(photo.dispose).toHaveBeenCalledTimes(1)
    expect(decode).not.toHaveBeenCalled()
    expect(search).not.toHaveBeenCalled()
    expect(review).not.toHaveBeenCalled()
    expect(screen.queryByAltText('cover source pixels')).not.toBeInTheDocument()
  })
  it('keeps failed recognition distinct from absence and source pixels available for manual review', async () => {
    decode.mockRejectedValueOnce(new Error('decoder unavailable'))
    render(<PhotoIntake onSearch={vi.fn()} onReview={vi.fn()} />)
    await upload()
    expect(screen.getByText(/Barcode recognition failed/)).toBeVisible()
    expect(screen.queryByText(/No readable book barcode observed/)).not.toBeInTheDocument()
    expect(screen.getByLabelText('Reviewed title')).toBeEnabled()
  })
})
