import { fireEvent, render, screen } from '@testing-library/react'
import { afterEach, expect, it, vi } from 'vitest'
import { ShelfDragHandle } from './ShelfDragHandle'

afterEach(() => vi.restoreAllMocks())
it('commits a touch reorder only on release and cancels an interrupted gesture', () => {
  const drop = vi.fn()
  render(
    <div data-shelf-reorder>
      <div data-shelf-book="a">
        <ShelfDragHandle title="First book" onDrop={drop} />
      </div>
      <div data-shelf-book="b" data-testid="target">
        Second book
      </div>
    </div>,
  )
  const handle = screen.getByRole('button', { name: 'Drag First book to reorder' })
  handle.setPointerCapture = vi.fn()
  handle.releasePointerCapture = vi.fn()
  Object.defineProperty(document, 'elementFromPoint', {
    configurable: true,
    value: vi.fn(() => screen.getByTestId('target')),
  })
  // jsdom does not implement PointerEvent; MouseEvent supplies the button and coordinates.
  vi.stubGlobal('PointerEvent', MouseEvent)
  fireEvent.pointerDown(handle, { button: 0, pointerId: 1 })
  fireEvent.pointerMove(handle, { clientX: 150, clientY: 200, pointerId: 1 })
  expect(drop).not.toHaveBeenCalled()
  fireEvent.pointerCancel(handle)
  fireEvent.pointerUp(handle, { pointerId: 1 })
  expect(drop).not.toHaveBeenCalled()
  fireEvent.pointerDown(handle, { button: 0, pointerId: 2 })
  fireEvent.pointerMove(handle, { clientX: 150, clientY: 200, pointerId: 2 })
  fireEvent.pointerUp(handle, { pointerId: 2 })
  expect(drop).toHaveBeenCalledExactlyOnceWith('b')
  vi.unstubAllGlobals()
})
