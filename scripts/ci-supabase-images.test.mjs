import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import {
  acquireImages,
  assertImage,
  validateBundle,
  validatePlan,
  verifyImages,
} from './ci-supabase-images.mjs'

const actualPlan = JSON.parse(
  readFileSync(new URL('../.github/supabase-images.json', import.meta.url), 'utf8'),
)
const plan = { ...actualPlan, images: [actualPlan.images[0]] }
const expected = plan.images[0]
const image = { Id: expected.imageId, Os: 'linux', Architecture: 'amd64' }
function fixture({ primaryFails = false, allFail = false, existing = null, pulled = image } = {}) {
  const calls = [],
    images = new Map()
  const ref = `public.ecr.aws/supabase/${expected.name}:${expected.tag}`
  if (existing) images.set(ref, existing)
  const run = (args) => {
    calls.push(args)
    if (args[1] === 'inspect') {
      if (!images.has(args[2]))
        throw Object.assign(new Error('Missing'), { stderr: 'Error: No such image' })
      return JSON.stringify([images.get(args[2])])
    }
    if (args[1] === 'pull') {
      if (allFail || (primaryFails && args.at(-1).startsWith('public.ecr.aws/'))) {
        throw Object.assign(new Error('Registry unavailable'), { status: 1 })
      }
      images.set(args.at(-1), pulled)
    } else if (args[1] === 'tag') images.set(args[3], images.get(args[2]))
    else throw Error(`Unexpected docker command ${args[1]}`)
    return ''
  }
  return { run, calls }
}
test('the committed plan has bounded distinct identities and immutable content pins', () => {
  assert.equal(validatePlan(actualPlan), actualPlan)
  assert.equal(actualPlan.images.length, 10)
  for (const invalid of [
    { ...plan, platform: 'linux/arm64' },
    { ...plan, images: [expected, expected] },
    { ...plan, images: [{ ...expected, name: '../other' }] },
    { ...plan, images: [{ ...expected, manifestDigest: 'latest' }] },
    { ...plan, images: [{ ...expected, tag: 'version;command' }] },
  ])
    assert.throws(() => validatePlan(invalid))
})
test('a cold pull uses the same immutable manifest at the approved mirror once, then verifies before tagging', () => {
  const f = fixture({ primaryFails: true })
  acquireImages(plan, f.run, () => {})
  assert.deepEqual(
    f.calls.filter((a) => a[1] === 'pull').map((a) => a.at(-1)),
    [
      `public.ecr.aws/supabase/postgres@${expected.manifestDigest}`,
      `ghcr.io/supabase/postgres@${expected.manifestDigest}`,
    ],
  )
  verifyImages(plan, f.run)
})
test('unavailable registries fail visibly with a bounded attempt count and no success tag', () => {
  const f = fixture({ allFail: true }),
    report = []
  assert.throws(
    () => acquireImages(plan, f.run, (message) => report.push(message)),
    /All approved image sources failed/,
  )
  assert.equal(f.calls.filter((a) => a[1] === 'pull').length, 2)
  assert.equal(f.calls.filter((a) => a[1] === 'tag').length, 0)
  assert.equal(report.filter((line) => line.startsWith('Image acquisition failed')).length, 2)
})
test('a digest or platform mismatch is an integrity failure, never silently repaired through another source', () => {
  for (const pulled of [
    { ...image, Id: `sha256:${'0'.repeat(64)}` },
    { ...image, Architecture: 'arm64' },
  ]) {
    const f = fixture({ pulled })
    assert.throws(() => acquireImages(plan, f.run, () => {}))
    assert.equal(f.calls.filter((a) => a[1] === 'pull').length, 1)
    assert.equal(f.calls.filter((a) => a[1] === 'tag').length, 0)
  }
  assert.throws(() => assertImage(null, expected), /Missing acquired image/)
})
test('an existing image must match exactly; an intact image avoids registry acquisition', () => {
  const intact = fixture({ existing: image })
  acquireImages(plan, intact.run)
  assert.ok(intact.calls.every((a) => a[1] === 'inspect'))
  const wrong = fixture({ existing: { ...image, Id: 'other' } })
  assert.throws(() => acquireImages(plan, wrong.run), /Unexpected content/)
  assert.equal(wrong.calls.length, 1)
  assert.throws(() => verifyImages(plan, fixture().run), /Required image missing/)
})
test('daemon and credential failures cannot masquerade as an absent image', () => {
  assert.throws(
    () =>
      acquireImages(plan, () => {
        throw Object.assign(new Error('Docker unavailable'), { stderr: 'Cannot connect to daemon' })
      }),
    /Docker unavailable/,
  )
})
test('cache corruption and a different plan are rejected before loading any image', () => {
  const text = JSON.stringify(plan)
  const receipt = {
    schemaVersion: 1,
    planSha256: createHash('sha256').update(text).digest('hex'),
    archiveSha256: 'reviewed-archive',
  }
  validateBundle(text, receipt, 'reviewed-archive')
  assert.throws(() => validateBundle(`${text} `, receipt, 'reviewed-archive'), /plan changed/)
  assert.throws(() => validateBundle(text, receipt, 'tampered-archive'), /archive is corrupt/)
})
