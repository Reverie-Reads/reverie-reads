import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import type { Book } from '@reverie/core'
import { SpineShelf } from './SpineShelf'

const book = (over: Partial<Book>): Book => ({
  id: 'b1',
  title: 'A Probe',
  first: 'Nell',
  last: 'Marrow',
  contributors: [],
  series: '',
  position: '',
  seriesCount: null,
  status: 'standalone',
  genre: 'fantasy',
  subgenre: '',
  subgenres: [],
  genres: [],
  tags: [],
  tropes: [],
  moods: [],
  intensity: null,
  darkness: null,
  cover: '',
  pages: null,
  isbn: '',
  fave: false,
  ownership: 'owned',
  borrowed: false,
  wishlist: false,
  owned: { physical: false, ebook: false, audiobook: false },
  format: '',
  rating: 0,
  readStatus: 'unset',
  source: '',
  pub: { y: null, m: null, d: null },
  reads: [],
  plan: { y: null, m: null, d: null },
  progress: 0,
  addedTs: 0,
  ...over,
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

function hoverDuringShelfScroll() {
  vi.useFakeTimers()
  vi.spyOn(HTMLElement.prototype, 'offsetWidth', 'get').mockReturnValue(32)
  vi.spyOn(HTMLElement.prototype, 'offsetHeight', 'get').mockReturnValue(160)
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockReturnValue(200)
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockReturnValue(400)
  vi.spyOn(HTMLElement.prototype, 'offsetLeft', 'get').mockImplementation(function (
    this: HTMLElement,
  ) {
    return this.dataset.spine ? 100 + Number(this.dataset.spine.slice(1)) * 50 : 0
  })
  vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(function (
    this: HTMLElement,
  ) {
    return {
      x: this.offsetLeft,
      y: 0,
      left: this.offsetLeft,
      right: this.offsetLeft + 32,
      top: 0,
      bottom: 160,
      width: 32,
      height: 160,
      toJSON: () => ({}),
    }
  })
  const books = [0, 1, 2].map((i) => book({ id: `b${i}`, title: `Book ${i}` }))
  const { container } = render(<SpineShelf books={books} onOpen={() => {}} />)
  const rail = container.querySelector<HTMLElement>('.overflow-x-auto')!
  rail.scrollTo = vi.fn()
  fireEvent.click(screen.getByRole('button', { name: 'Next book' }))
  expect(rail.scrollTo).toHaveBeenCalledWith({ left: 50, behavior: 'smooth' })
  const move = new Event('pointermove', { bubbles: true })
  Object.assign(move, { pointerType: 'mouse', clientX: 216, clientY: 80 })
  fireEvent(rail, move)
  act(() => {
    vi.advanceTimersByTime(80)
  })
  expect(container.querySelector('[data-spine-picked]')).toHaveAttribute('data-spine', 'b2')
  // Model a stalled frame during the shelf's own smooth scrolling, after hover has settled.
  act(() => {
    vi.advanceTimersByTime(500)
  })
  return { container, rail }
}

function arrive(rail: HTMLElement) {
  rail.scrollLeft = 50
  fireEvent.scroll(rail)
  act(() => {
    vi.advanceTimersByTime(20)
  })
}

it('a late shelf-controlled scroll arrival preserves the reader hover selection', () => {
  const { container, rail } = hoverDuringShelfScroll()
  arrive(rail)
  expect(container.querySelector('[data-spine-picked]')).toHaveAttribute('data-spine', 'b2')
  // The completed glide does not exempt later scrolling from changing the selection.
  rail.scrollLeft = 0
  fireEvent.scroll(rail)
  act(() => {
    vi.advanceTimersByTime(20)
  })
  expect(container.querySelector('[data-spine-picked]')).toHaveAttribute('data-spine', 'b0')
})

it.each(['wheel', 'touchstart', 'pointerdown'])(
  'a reader %s interrupts the glide and lets scrolling select another book',
  (input) => {
    const { container, rail } = hoverDuringShelfScroll()
    fireEvent(rail, new Event(input, { bubbles: true }))
    arrive(rail)
    expect(container.querySelector('[data-spine-picked]')).toHaveAttribute('data-spine', 'b1')
  },
)
