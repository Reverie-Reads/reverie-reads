import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { createHash } from 'node:crypto'
import { render } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { APP_NAME } from '@reverie/core'
import { MidnihtMark } from './MidnihtMark'
import { Wordmark } from '../auth/Wordmark'

describe('Midniht identity', () => {
  it('shares the approved artwork without changing its geometry or accessible name', () => {
    expect(APP_NAME).toBe('Midniht')
    const { container, getByText } = render(<Wordmark />)
    expect(getByText('Midniht')).toBeInTheDocument()
    const image = container.querySelector('img')!
    expect(image).toHaveAttribute('src', '/midniht/midniht-mark.svg')
    expect(image).toHaveAttribute('alt', '')
    expect(image).toHaveAttribute('aria-hidden', 'true')
    expect(container.querySelector('svg')).toBeNull()
  })

  it('keeps the mark square in compact navigation', () => {
    const { container } = render(<MidnihtMark className="h-8 w-8" />)
    expect(container.querySelector('img')).toHaveAttribute('width', '48')
    expect(container.querySelector('img')).toHaveAttribute('height', '48')
    expect(container.querySelector('img')).toHaveClass('object-contain', 'shrink-0')
  })

  it('publishes byte-identical approved exports at current and compatible legacy URLs', () => {
    const assets = JSON.parse(
      readFileSync(resolve('public/brand-assets.generated.json'), 'utf8'),
    ) as {
      sha256: Record<string, string>
    }
    for (const [file, hash] of Object.entries(assets.sha256)) {
      expect(
        createHash('sha256')
          .update(readFileSync(resolve('public', file)))
          .digest('hex'),
        file,
      ).toBe(hash)
    }
    const master = readFileSync(resolve('../../design/midniht/brand-kit/midniht-mark.svg'), 'utf8')
    expect(readFileSync(resolve('public/favicon.svg'), 'utf8')).toBe(master)
    expect(readFileSync(resolve('public/midniht/midniht-mark.svg'), 'utf8')).toBe(master)
    expect(master.match(/<path /g)).toHaveLength(12)
    for (const [file, size] of [
      ['icon-192.png', 192],
      ['icon-512.png', 512],
      ['icon-maskable-512.png', 512],
      ['apple-touch-icon.png', 180],
    ] as const) {
      const bytes = readFileSync(resolve('public', file))
      expect(bytes.readUInt32BE(16), file).toBe(size)
      expect(bytes.readUInt32BE(20), file).toBe(size)
    }
  })

  it('uses the current name and domain for installation and sharing', () => {
    const manifest = JSON.parse(readFileSync(resolve('public/manifest.webmanifest'), 'utf8'))
    expect(manifest).toMatchObject({
      name: 'Midniht',
      short_name: 'Midniht',
      start_url: '/',
      scope: '/',
    })
    const html = readFileSync(resolve('index.html'), 'utf8')
    expect(html).toContain('https://midniht.app/')
    expect(html).not.toContain('https://reveriereads.app')
    // Preference keys deliberately survive the cosmetic rename.
    expect(html).toContain("localStorage.getItem('reverie.skin')")
    expect(html).toContain("localStorage.getItem('reverie.mode')")
  })
})
