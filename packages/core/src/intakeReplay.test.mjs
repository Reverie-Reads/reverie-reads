import { readFileSync, mkdtempSync, rmSync, statSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'
import { describe, expect, it } from 'vitest'
import { replayIntakeEvidence } from '../../../scripts/intake-resolver-replay.mjs'

const fixture = () =>
  JSON.parse(
    readFileSync(
      new URL('../../../scripts/fixtures/intake-evidence.json', import.meta.url),
      'utf8',
    ),
  )
describe('offline intake replay', () => {
  it('executes the documented CLI, writes private output and refuses to overwrite it', () => {
    const root = fileURLToPath(new URL('../../../', import.meta.url))
    const temp = mkdtempSync(join(tmpdir(), 'intake-replay-'))
    try {
      const output = join(temp, 'report.json')
      const args = [
        'node_modules/vite-node/vite-node.mjs',
        '--script',
        'scripts/intake-resolver-replay.mjs',
        '--',
        'scripts/fixtures/intake-evidence.json',
        output,
      ]
      const run = () =>
        spawnSync(process.execPath, args, { cwd: root, encoding: 'utf8', timeout: 30000 })
      const first = run()
      expect(first.status, first.stderr).toBe(0)
      expect(JSON.parse(first.stdout).passed).toBe(17)
      const frozen = readFileSync(output, 'utf8')
      expect(JSON.parse(frozen).summary.cases).toBe(17)
      expect(statSync(output).mode & 0o777).toBe(0o600)
      expect(run().status).toBe(1)
      expect(readFileSync(output, 'utf8')).toBe(frozen)
    } finally {
      rmSync(temp, { recursive: true, force: true })
    }
  }, 60000)
  it('recovers eight formatting cases and retains the three identity holds', () => {
    const input = fixture()
    input.cases = input.cases.filter((c) => c.id.startsWith('format-'))
    expect(replayIntakeEvidence(input).summary).toMatchObject({
      cases: 11,
      passed: 11,
      failed: 0,
      workResolved: 8,
      workReview: 3,
      unexpectedWorkResolutions: 0,
      unexpectedEditionResolutions: 0,
    })
  })
  it('holds mixed identities and retains the four distinct contributor credit patterns', () => {
    const result = replayIntakeEvidence(fixture())
    expect(result.summary).toMatchObject({
      cases: 17,
      passed: 17,
      failed: 0,
      writes: 0,
      requests: 0,
    })
    expect(
      result.cases
        .filter((c) => c.id.startsWith('mixed-'))
        .every((c) => c.result.work.state === 'review'),
    ).toBe(true)
    const credits = result.cases
      .filter((c) => c.id.startsWith('credits-'))
      .map((c) => c.result.fields.find((f) => f.field === 'contributors').proposed)
    expect(credits.map((c) => c?.length)).toEqual([2, 2, 3, undefined])
    expect(credits[2].map((c) => c.role)).toEqual([
      'playwright',
      'original_story',
      'original_story',
    ])
    const anthology = result.cases.find((c) => c.id === 'credits-anthology').result
    expect(anthology.work.state).toBe('review')
    expect(
      anthology.request.observations[0].identity.contributors.map((c) => [c.role, c.scope]),
    ).toEqual([
      ['editor', 'whole'],
      ['author', 'part'],
      ['foreword', 'whole'],
    ])
  })
  it('detects a known bad answer instead of treating any successful run as accuracy', () => {
    const input = fixture()
    input.cases = input.cases.filter((c) => c.id.startsWith('mixed-'))
    input.cases[0].expected.work = 'resolved'
    expect(replayIntakeEvidence(input).summary.failed).toBe(1)
  })
  it('does not let expected answers change decisions', () => {
    const input = fixture()
    input.cases = [input.cases[0]]
    const before = replayIntakeEvidence(input).cases[0].result
    input.cases[0].expected.work = 'review'
    expect(replayIntakeEvidence(input).cases[0].result).toEqual(before)
  })
  it('rejects duplicate case IDs and private data attached to the manifest', () => {
    const input = fixture()
    input.cases.push(input.cases[0])
    expect(() => replayIntakeEvidence(input)).toThrow()
    expect(() => replayIntakeEvidence({ ...fixture(), reader: 'private' })).toThrow()
  })
})
