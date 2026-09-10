import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const edge = readFileSync(join(__dirname, '../../../supabase/functions/covers/index.ts'), 'utf8')
const start = edge.indexOf('async function normalizeImage')
const end = edge.indexOf('// ── storage ──', start)
const normalizer = edge.slice(start, end)

describe('cover normalization CPU boundary', () => {
  it('decodes source bytes once and derives outputs from largest to smallest', () => {
    expect(start).toBeGreaterThan(-1)
    expect(end).toBeGreaterThan(start)
    expect(normalizer.match(/ImageMagick\.read\(bytes/g)).toHaveLength(1)
    expect(normalizer).not.toContain('img.clone(')

    const full = normalizer.indexOf('encode(FULL_EDGE, 82)')
    const thumb = normalizer.indexOf('encode(THUMB_EDGE, 78)')
    const color = normalizer.indexOf("timed('normalize.color'")
    expect(full).toBeGreaterThan(normalizer.indexOf('img.autoOrient()'))
    expect(thumb).toBeGreaterThan(full)
    expect(color).toBeGreaterThan(thumb)
    expect(normalizer).toContain('img.strip()')
  })

  it('keeps trace stages separate so decode and derivative cost remain measurable', () => {
    for (const stage of [
      'normalize.decode.source',
      'normalize.prepare',
      'normalize.encode.full',
      'normalize.encode.thumb',
      'normalize.color',
    ]) {
      expect(normalizer).toContain(stage)
    }
    expect(normalizer).not.toContain('normalize.decode.dims')
  })
})
