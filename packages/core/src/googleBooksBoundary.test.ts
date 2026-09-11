import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { describe, expect, it } from 'vitest'

const FUNCTIONS = join(process.cwd(), '../../supabase/functions')

function* sourceFiles(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name)
    if (statSync(path).isDirectory()) yield* sourceFiles(path)
    else if (path.endsWith('.ts')) yield path
  }
}

describe('Google Books request boundary', () => {
  it('keeps the live Volumes API in explicit search only', () => {
    const requesters = [...sourceFiles(FUNCTIONS)]
      .filter((file) => /www\.googleapis\.com\/books\/v1\/volumes/.test(readFileSync(file, 'utf8')))
      .map((file) => relative(FUNCTIONS, file))

    expect(requesters).toEqual(['search/index.ts'])
  })
})
