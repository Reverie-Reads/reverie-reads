import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'
import { afterEach, describe, expect, it, vi } from 'vitest'

const html = readFileSync('index.html', 'utf8')
const script = html.match(/<script id="boot-recovery-script">([\s\S]*?)<\/script>/)![1]!
const cleanup: (() => void)[] = []
afterEach(() => {
  cleanup.splice(0).forEach((fn) => fn())
  document.body.innerHTML = ''
  vi.useRealTimers()
})

function harness() {
  vi.useFakeTimers()
  document.body.innerHTML = html.slice(html.indexOf('<body>') + 6, html.indexOf('</body>'))
  const unregister = vi.fn().mockResolvedValue(true)
  const unrelatedUnregister = vi.fn()
  const removeCache = vi.fn().mockResolvedValue(true)
  const reload = vi.fn()
  const caches = {
    keys: vi
      .fn()
      .mockResolvedValue(['reverie-shell-v2', 'midniht-shell-v3', 'reader-uploads', 'another-app']),
    delete: removeCache,
  }
  const serviceWorker = {
    getRegistrations: vi.fn().mockResolvedValue([
      { active: { scriptURL: 'https://midniht.app/sw.js?v=old' }, unregister },
      { active: { scriptURL: 'https://midniht.app/other/sw.js' }, unregister: unrelatedUnregister },
    ]),
  }
  runInNewContext(script, {
    document,
    window: {
      caches,
      addEventListener: (type: string, listener: EventListener, capture: boolean) => {
        window.addEventListener(type, listener, capture)
        cleanup.push(() => window.removeEventListener(type, listener, capture))
      },
    },
    navigator: { serviceWorker },
    caches,
    location: { origin: 'https://midniht.app', reload },
    URL,
    HTMLScriptElement,
    MutationObserver: class extends MutationObserver {
      constructor(callback: MutationCallback) {
        super(callback)
        cleanup.push(() => this.disconnect())
      }
    },
    setTimeout,
    clearTimeout,
  })
  return {
    panel: document.getElementById('boot-recovery')!,
    root: document.getElementById('root')!,
    button: document.getElementById('boot-recovery-reload')! as HTMLButtonElement,
    caches,
    reload,
    unregister,
    unrelatedUnregister,
    removeCache,
  }
}

describe('pre-module startup recovery', () => {
  it('offers recovery after a stalled boot, then gets out of the way if the app mounts', async () => {
    const { panel, root } = harness()
    expect(panel.hidden).toBe(true)
    await vi.advanceTimersByTimeAsync(15000)
    expect(panel.hidden).toBe(false)
    root.innerHTML = '<main>Your library</main>'
    await Promise.resolve()
    expect(panel.hidden).toBe(true)
  })

  it('does not interrupt an app which rendered successfully', async () => {
    const { panel, root } = harness()
    root.innerHTML = '<main><input value="Unsaved draft" /></main>'
    await vi.advanceTimersByTimeAsync(15000)
    expect(panel.hidden).toBe(true)
    expect(root.querySelector('input')?.value).toBe('Unsaved draft')
  })

  it('shows recovery immediately when the entry module fails to load', () => {
    const { panel } = harness()
    const entry = document.createElement('script')
    entry.type = 'module'
    document.body.appendChild(entry)
    entry.dispatchEvent(new Event('error'))
    expect(panel.hidden).toBe(false)
  })

  it('refreshes only owned app-shell caches and worker after explicit action', async () => {
    const { button, reload, removeCache, unregister, unrelatedUnregister } = harness()
    localStorage.setItem('recovery-test-session', 'preserve')
    sessionStorage.setItem('recovery-test-draft', 'preserve')
    await vi.advanceTimersByTimeAsync(15000)
    expect(removeCache).not.toHaveBeenCalled()
    button.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(removeCache.mock.calls).toEqual([['reverie-shell-v2'], ['midniht-shell-v3']])
    expect(unregister).toHaveBeenCalledOnce()
    expect(unrelatedUnregister).not.toHaveBeenCalled()
    expect(reload).toHaveBeenCalledOnce()
    expect(localStorage.getItem('recovery-test-session')).toBe('preserve')
    expect(sessionStorage.getItem('recovery-test-draft')).toBe('preserve')
    localStorage.removeItem('recovery-test-session')
    sessionStorage.removeItem('recovery-test-draft')
  })

  it('keeps a retry available if app-file refresh fails', async () => {
    const { button, caches, reload } = harness()
    caches.keys.mockRejectedValue(new Error('storage unavailable'))
    await vi.advanceTimersByTimeAsync(15000)
    button.click()
    await vi.advanceTimersByTimeAsync(0)
    expect(button.disabled).toBe(false)
    expect(document.getElementById('boot-recovery-status')?.textContent).toContain(
      'could not be refreshed',
    )
    expect(reload).not.toHaveBeenCalled()
  })
})
