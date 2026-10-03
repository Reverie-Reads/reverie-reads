import { fireEvent, render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { Modal } from './Modal'

describe('Modal', () => {
  it('uses the native top layer so a nested editor can appear above a drawer dialog', () => {
    const close = vi.fn()
    render(
      <Modal title="Nested editor" onClose={close}>
        Editor content
      </Modal>,
    )

    const dialog = screen.getByRole('dialog', { name: 'Nested editor' })
    expect(dialog.tagName).toBe('DIALOG')
    expect(dialog).toHaveAttribute('open')
    expect(screen.getByText('Editor content')).toBeVisible()

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(close).toHaveBeenCalledOnce()
  })
  it('keeps focus while details arrive, uses the current close handler, and returns to the opener', () => {
    const opener = document.createElement('button')
    document.body.append(opener)
    opener.focus()
    const oldClose = vi.fn()
    const currentClose = vi.fn()
    const { rerender, unmount } = render(
      <Modal title="Book" onClose={oldClose}>
        <div>
          <button>Keep browsing</button>
        </div>
      </Modal>,
    )
    const action = screen.getByRole('button', { name: 'Keep browsing' })
    action.focus()
    rerender(
      <Modal title="Book" onClose={currentClose}>
        <div>
          <button>Keep browsing</button>
          <p>Description arrived</p>
        </div>
      </Modal>,
    )
    expect(action).toHaveFocus()
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(oldClose).not.toHaveBeenCalled()
    expect(currentClose).toHaveBeenCalledOnce()
    unmount()
    expect(opener).toHaveFocus()
    opener.remove()
  })
  it('Escape closes only the topmost dialog, preserving the form beneath it', () => {
    const closeEdit = vi.fn()
    const closeCover = vi.fn()
    render(
      <>
        <Modal title="Edit" onClose={closeEdit}>
          Unsaved title
        </Modal>
        <Modal title="Cover" onClose={closeCover}>
          Cover choices
        </Modal>
      </>,
    )
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(closeCover).toHaveBeenCalledOnce()
    expect(closeEdit).not.toHaveBeenCalled()
  })
})
