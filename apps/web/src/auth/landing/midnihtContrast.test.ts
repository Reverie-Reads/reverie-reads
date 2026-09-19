// @vitest-environment node
import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

const css = readFileSync(new URL('../../styles/midniht.css', import.meta.url), 'utf8')

function luminance(hex: string) {
  const values = hex.match(/[0-9a-f]{2}/gi)!.map((value) => {
    const x = parseInt(value, 16) / 255
    return x <= 0.04045 ? x / 12.92 : ((x + 0.055) / 1.055) ** 2.4
  })
  return values[0]! * 0.2126 + values[1]! * 0.7152 + values[2]! * 0.0722
}
function contrast(a: string, b: string) {
  const x = luminance(a)
  const y = luminance(b)
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05)
}
describe('Midniht public palette (independent of all nine room palettes)', () => {
  for (const mode of ['dark', 'light'])
    it(mode + ' has readable text, controls and focus boundaries', () => {
      const selector =
        mode === 'dark' ? '.midniht-landing {' : ".midniht-landing[data-midniht-mode='light'] {"
      const block = css.slice(css.indexOf(selector)).split('}')[0]!
      const tokens = Object.fromEntries(
        [...block.matchAll(/(--[\w-]+):\s*(#[0-9a-f]{6})/gi)].map((match) => [match[1], match[2]]),
      )
      for (const background of ['--bg0', '--card']) {
        for (const text of ['--ink', '--muted', '--eyebrow'])
          expect(
            contrast(tokens[text]!, tokens[background]!),
            text + ' on ' + background,
          ).toBeGreaterThanOrEqual(4.5)
        expect(contrast(tokens['--line']!, tokens[background]!)).toBeGreaterThanOrEqual(3)
      }
      expect(contrast(tokens['--on-primary']!, tokens['--primary']!)).toBeGreaterThanOrEqual(4.5)
    })
})
