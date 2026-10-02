import { fireEvent, render, screen, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ReadingModeProvider } from './ReadingMode'
import { keyFor, readReadingMode, useReadingMode } from './useReadingMode'
import { ReadingModeChoice } from '../components/ReadingModeChoice'
import { ReadingSection } from '../components/ReadingSection'
import { useState } from 'react'
import { GuidanceChoice } from '../guidance/Guide'
import { beardKeyFor, readBeardAppearance } from './beardAppearance'

function Draft() {
  const [text, setText] = useState('')
  return (
    <input
      aria-label="Unsent note"
      value={text}
      onChange={(event) => setText(event.target.value)}
    />
  )
}
function Mode() {
  return <p data-testid="mode">{useReadingMode().mode}</p>
}
beforeEach(() => localStorage.clear())
afterEach(() => vi.restoreAllMocks())

function blockStorageWrites() {
  // jsdom's native Storage proxy keeps methods on its prototype. The Node 26 test fallback
  // owns them directly; spying on the proxy itself does not intercept writes under CI's Node 22.
  const storage = window.localStorage
  const methods = Object.hasOwn(storage, 'setItem')
    ? storage
    : (Object.getPrototypeOf(storage) as Storage)
  const blocked = vi.spyOn(methods, 'setItem').mockImplementation(() => {
    throw new Error('blocked')
  })
  expect(() => storage.setItem('storage-probe', 'unwritten')).toThrow('blocked')
  return blocked
}

describe('Reading mode', () => {
  it('keeps an active task and its draft visible when the interface becomes simpler', () => {
    function Task() {
      const [working, setWorking] = useState(false)
      return (
        <ReadingSection id="task" title="Import" alwaysOpen={working}>
          <Draft />
          <button onClick={() => setWorking(true)}>Begin task</button>
          {working && <p role="status">Importing — keep this task open</p>}
        </ReadingSection>
      )
    }
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
        <Task />
      </ReadingModeProvider>,
    )
    const draft = screen.getByLabelText('Unsent note')
    fireEvent.change(draft, { target: { value: 'Review this import' } })
    fireEvent.click(screen.getByText('Begin task'))
    fireEvent.click(screen.getByLabelText(/Bearded Mode/i))
    expect(screen.getByRole('status')).toBeVisible()
    expect(screen.getByLabelText('Unsent note')).toBe(draft)
    expect(draft).toBeVisible()
    expect(draft).toHaveValue('Review this import')
  })
  it('cancels a portrait preview without saving it', () => {
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
      </ReadingModeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose your beard' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose your beard' })
    fireEvent.click(within(dialog).getByLabelText('Braided'))
    fireEvent.click(within(dialog).getByLabelText('Copper'))
    expect(readBeardAppearance('one')).toEqual({ style: 'classic', color: 'room' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }))
    expect(localStorage.getItem(beardKeyFor('one'))).toBeNull()
  })
  it('saves a beard without changing mode or an open draft', () => {
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
        <Mode />
        <Draft />
      </ReadingModeProvider>,
    )
    fireEvent.change(screen.getByLabelText('Unsent note'), { target: { value: 'Keep my note' } })
    fireEvent.click(screen.getByRole('button', { name: 'Choose your beard' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose your beard' })
    fireEvent.click(within(dialog).getByLabelText('Braided'))
    fireEvent.click(within(dialog).getByLabelText('Rainbow'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this beard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readBeardAppearance('one')).toEqual({ style: 'braided', color: 'rainbow' })
    expect(readBeardAppearance('two')).toEqual({ style: 'classic', color: 'room' })
    expect(screen.getByTestId('mode')).toHaveTextContent('standard')
    expect(screen.getByLabelText('Unsent note')).toHaveValue('Keep my note')
  })
  it('keeps a beard draft visible when storage fails and permits an explicit retry', () => {
    const blocked = blockStorageWrites()
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
      </ReadingModeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Choose your beard' }))
    const dialog = screen.getByRole('dialog', { name: 'Choose your beard' })
    fireEvent.click(within(dialog).getByLabelText('Snow'))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this beard' }))
    expect(within(dialog).getByRole('status')).toHaveTextContent('until you leave or reload')
    expect(within(dialog).getByLabelText('Snow')).toBeChecked()
    blocked.mockRestore()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Use this beard' }))
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
    expect(readBeardAppearance('one')).toEqual({ style: 'classic', color: 'snow' })
  })
  it('rejects malformed or newer beard documents without changing them', () => {
    for (const doc of [
      { version: 2, style: 'full', color: 'snow' },
      { version: 1, style: 'unknown', color: 'copper' },
    ]) {
      const saved = JSON.stringify(doc)
      localStorage.setItem(beardKeyFor('one'), saved)
      expect(readBeardAppearance('one')).toEqual({ style: 'classic', color: 'room' })
      expect(localStorage.getItem(beardKeyFor('one'))).toBe(saved)
    }
  })
  it('offers a genuine walkthrough or independent exploration without saving either itself', () => {
    const choose = vi.fn()
    localStorage.setItem(keyFor('one'), JSON.stringify({ version: 1, mode: 'bearded' }))
    render(
      <ReadingModeProvider accountId="one">
        <GuidanceChoice onChoose={choose} />
      </ReadingModeProvider>,
    )
    fireEvent.click(screen.getByRole('button', { name: 'Show me how to add a book' }))
    expect(choose).toHaveBeenLastCalledWith('full', true)
    fireEvent.click(screen.getByRole('button', { name: 'Explore on my own' }))
    expect(choose).toHaveBeenLastCalledWith('full', false)
    expect(localStorage.getItem(keyFor('one'))).toContain('bearded')
  })
  it('isolates accounts, rejects newer documents, and never reads a global flag', () => {
    localStorage.setItem('midniht.reading-mode', 'bearded')
    localStorage.setItem(keyFor('one'), JSON.stringify({ version: 1, mode: 'bearded' }))
    localStorage.setItem(keyFor('future'), JSON.stringify({ version: 2, mode: 'bearded' }))
    expect(readReadingMode('one')).toBe('bearded')
    expect(readReadingMode('two')).toBe('standard')
    expect(readReadingMode('future')).toBe('standard')
    expect(localStorage.getItem(keyFor('future'))).toContain('"version":2')
  })

  it('switches only the browser view and keeps a mounted form draft', () => {
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
        <Mode />
        <ReadingSection id="extra" title="Extra details">
          <Draft />
        </ReadingSection>
      </ReadingModeProvider>,
    )
    fireEvent.change(screen.getByLabelText('Unsent note'), { target: { value: 'Keep this draft' } })
    fireEvent.click(screen.getByRole('radio', { name: /Bearded Mode/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('bearded')
    fireEvent.click(screen.getByRole('radio', { name: /Full interface/ }))
    expect(screen.getByLabelText('Unsent note')).toHaveValue('Keep this draft')
    expect(Object.keys(localStorage)).not.toContain('arrangement')
    expect(readReadingMode('one')).toBe('standard')
  })

  it('does not paint a departed account preference', () => {
    const view = render(
      <ReadingModeProvider key="one" accountId="one">
        <ReadingModeChoice />
        <Mode />
      </ReadingModeProvider>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Bearded Mode/i }))
    view.rerender(
      <ReadingModeProvider key="two" accountId="two">
        <Mode />
      </ReadingModeProvider>,
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('standard')
    view.rerender(
      <ReadingModeProvider key="one" accountId="one">
        <Mode />
      </ReadingModeProvider>,
    )
    expect(screen.getByTestId('mode')).toHaveTextContent('bearded')
  })

  it('keeps the choice usable and explains when storage fails', () => {
    blockStorageWrites()
    render(
      <ReadingModeProvider accountId="one">
        <ReadingModeChoice />
        <Mode />
      </ReadingModeProvider>,
    )
    fireEvent.click(screen.getByRole('radio', { name: /Bearded Mode/i }))
    expect(screen.getByTestId('mode')).toHaveTextContent('bearded')
    expect(screen.getByRole('status')).toHaveTextContent('until you leave or reload')
  })

  it('synchronizes only this account storage events without recreating the draft', () => {
    render(
      <ReadingModeProvider accountId="one">
        <Mode />
        <ReadingSection id="extra" title="Extra details">
          <Draft />
        </ReadingSection>
      </ReadingModeProvider>,
    )
    fireEvent.change(screen.getByLabelText('Unsent note'), { target: { value: 'From this tab' } })
    localStorage.setItem(keyFor('two'), JSON.stringify({ version: 1, mode: 'bearded' }))
    fireEvent(window, new StorageEvent('storage', { key: keyFor('two') }))
    expect(screen.getByTestId('mode')).toHaveTextContent('standard')
    localStorage.setItem(keyFor('one'), JSON.stringify({ version: 1, mode: 'bearded' }))
    fireEvent(window, new StorageEvent('storage', { key: keyFor('one') }))
    localStorage.setItem(keyFor('one'), JSON.stringify({ version: 1, mode: 'standard' }))
    fireEvent(window, new StorageEvent('storage', { key: keyFor('one') }))
    expect(screen.getByLabelText('Unsent note')).toHaveValue('From this tab')
  })
})
