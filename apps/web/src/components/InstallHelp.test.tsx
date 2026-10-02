import { act, fireEvent, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { InstallHelp } from './InstallHelp'

let standalone = false
let mediaEvents: EventTarget
function device(userAgent: string, platform = '', maxTouchPoints = 0, iosStandalone = false) {
  vi.stubGlobal('navigator', { userAgent, platform, maxTouchPoints, standalone: iosStandalone })
}
beforeEach(() => {
  standalone = false
  mediaEvents = new EventTarget()
  device('Desktop browser')
  vi.stubGlobal('matchMedia', (media: string) => ({
    media,
    get matches() {
      return standalone
    },
    addEventListener: mediaEvents.addEventListener.bind(mediaEvents),
    removeEventListener: mediaEvents.removeEventListener.bind(mediaEvents),
  }))
})
afterEach(() => vi.unstubAllGlobals())

function openHelp() {
  const summary = screen.getByText(/Add .* to your Home Screen/)
  fireEvent.click(summary)
  return summary.closest('details')!
}

describe('optional installation help', () => {
  it('waits for explicit disclosure and permits manual device selection without storage writes', () => {
    const storage = window.localStorage
    const write = vi.spyOn(
      Object.hasOwn(storage, 'setItem') ? storage : (Object.getPrototypeOf(storage) as Storage),
      'setItem',
    )
    render(<InstallHelp />)
    expect(screen.getByRole('radio', { name: 'Computer', hidden: true })).not.toBeVisible()
    expect(openHelp()).toHaveAttribute('open')
    expect(screen.getByRole('radio', { name: 'Computer' })).toBeChecked()
    fireEvent.click(screen.getByRole('radio', { name: 'iPhone or iPad' }))
    expect(screen.getByText(/In Safari’s compact layout, open the Page Menu/)).toBeVisible()
    expect(screen.getByText(/Scroll to Edit Actions/)).toBeVisible()
    expect(screen.getByRole('link', { name: /Apple’s illustrated instructions/ })).toHaveAttribute(
      'href',
      'https://support.apple.com/guide/iphone/iphea86e5236/ios',
    )
    fireEvent.click(screen.getByRole('radio', { name: 'Android' }))
    expect(screen.getByText(/Choose Install and create shortcut/)).toBeVisible()
    expect(write).not.toHaveBeenCalled()
    write.mockRestore()
  })

  it.each([
    ['iPhone Safari', 'iPhone', 0],
    ['Macintosh Safari', 'MacIntel', 5],
  ])(
    'suggests Apple steps for %s while retaining manual alternatives',
    (agent, platform, touches) => {
      device(agent, platform, touches)
      render(<InstallHelp />)
      openHelp()
      expect(screen.getByRole('radio', { name: 'iPhone or iPad' })).toBeChecked()
      expect(screen.getByText(/Turn on Open as Web App if offered/)).toBeVisible()
      fireEvent.click(screen.getByRole('radio', { name: 'Computer' }))
      expect(screen.getByText(/Cast, save, and share/)).toBeVisible()
    },
  )

  it('suggests Android steps and keeps the browser fallback available', () => {
    device('Android Chrome')
    render(<InstallHelp />)
    openHelp()
    expect(screen.getByRole('radio', { name: 'Android' })).toBeChecked()
    expect(screen.getByText(/bookmark this page instead/)).toBeVisible()
  })

  it('hides the optional offer in standalone view but retains Settings help', () => {
    standalone = true
    const view = render(<InstallHelp />)
    expect(view.container).toBeEmptyDOMElement()
    view.rerender(<InstallHelp hideWhenInstalled={false} />)
    fireEvent.click(screen.getByText('Install and Home Screen help'))
    expect(screen.getByText(/already using the app view/)).toBeVisible()
    expect(screen.getByRole('radio', { name: 'iPhone or iPad' })).toBeVisible()
  })

  it('recognizes iOS standalone even without a display-mode match', () => {
    device('iPhone Safari', 'iPhone', 0, true)
    const view = render(<InstallHelp />)
    expect(view.container).toBeEmptyDOMElement()
  })

  it('responds to a display-mode change and detaches its listener on exit', () => {
    const detach = vi.spyOn(mediaEvents, 'removeEventListener')
    const view = render(<InstallHelp />)
    expect(screen.getByText(/Add .* to your Home Screen/)).toBeVisible()
    act(() => {
      standalone = true
      mediaEvents.dispatchEvent(new Event('change'))
    })
    expect(view.container).toBeEmptyDOMElement()
    view.unmount()
    expect(detach).toHaveBeenCalledWith('change', expect.any(Function))
  })
})
