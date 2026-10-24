import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { IntakeLookupDiagnosticsControl } from './IntakeLookupDiagnosticsControl'
import { intakeLookupDiagnostics as d } from '../lib/intakeLookupDiagnostics'
beforeEach(() => d.reset())
afterEach(() => {
  d.reset()
  vi.restoreAllMocks()
})
it('offers explicit start, stop, local download and discard with an honest unobserved boundary', () => {
  render(<IntakeLookupDiagnosticsControl />)
  expect(screen.getByRole('status')).toHaveTextContent('Diagnostics are off.')
  expect(screen.getByRole('button', { name: 'Download diagnostic counts' })).toBeDisabled()
  fireEvent.click(screen.getByRole('button', { name: 'Start diagnostic session' }))
  expect(screen.getByRole('status')).toHaveTextContent('Counting Add lookups.')
  act(() => {
    d.begin('isbn')({
      result: 'unavailable',
      edition: 'identity_hold',
      candidatesWithoutAuthor: false,
    })
    d.begin('text')
  })
  fireEvent.click(screen.getByRole('button', { name: 'Stop diagnostics' }))
  expect(screen.getByRole('status')).toHaveTextContent('2 of 20 attempts; 0 pending.')
  let downloaded: Record<string, unknown> | undefined
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    downloaded = JSON.parse(decodeURIComponent(this.href.split(',')[1]!))
    expect(this.download).toMatch(/-add-diagnostics.json$/)
  })
  fireEvent.click(screen.getByRole('button', { name: 'Download diagnostic counts' }))
  expect(downloaded).toMatchObject({
    counts: {
      attempted: 2,
      results: { unavailable: 1, unfinished: 1 },
      editions: { identity_hold: 1 },
    },
  })
  expect(
    screen.getByText(/Saving books and spreadsheet imports are not measured/),
  ).toBeInTheDocument()
  fireEvent.click(screen.getByRole('button', { name: 'Discard diagnostic counts' }))
  expect(screen.getByRole('status')).toHaveTextContent('Diagnostics are off. 0 of 20 attempts')
})
