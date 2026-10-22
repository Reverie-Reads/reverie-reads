// Public images only: no containers, volumes, database snapshots or credentials enter the bundle.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import {
  createReadStream,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { stackConfig } from './stack-engine.mjs'

const digest = /^sha256:[a-f0-9]{64}$/
const hash = (value) => createHash('sha256').update(value).digest('hex')
export function validatePlan(plan) {
  assert.equal(plan.schemaVersion, 1)
  assert.match(plan.cliVersion, /^\d+\.\d+\.\d+$/)
  assert.equal(plan.platform, 'linux/amd64')
  assert.ok(Array.isArray(plan.images) && plan.images.length > 0 && plan.images.length <= 24)
  const names = new Set()
  for (const image of plan.images) {
    assert.match(image.name, /^[a-z][a-z0-9_-]{0,40}$/)
    assert.match(image.tag, /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,80}$/)
    assert.match(image.manifestDigest, digest)
    assert.match(image.imageId, digest)
    assert.ok(!names.has(image.name), 'Duplicate image in plan')
    names.add(image.name)
  }
  return plan
}
const canonical = (image) => `public.ecr.aws/supabase/${image.name}:${image.tag}`
export function assertImage(actual, expected) {
  assert.ok(actual, `Missing acquired image: ${expected.name}`)
  assert.equal(actual.Id, expected.imageId, `Unexpected content: ${expected.name}`)
  assert.equal(actual.Os, 'linux')
  assert.equal(actual.Architecture, 'amd64')
}
const docker = (args) =>
  execFileSync('docker', args, {
    encoding: 'utf8',
    timeout: 180_000,
    maxBuffer: 8 * 1024 * 1024,
    stdio: args[1] === 'pull' ? 'inherit' : 'pipe',
  })
function inspect(ref, run) {
  try {
    return JSON.parse(run(['image', 'inspect', ref]))[0]
  } catch (error) {
    if (/no such image/i.test(String(error.stderr))) return null
    throw error
  }
}
export function verifyImages(plan, run = docker) {
  for (const image of plan.images) {
    const actual = inspect(canonical(image), run)
    assert.ok(actual, `Required image missing: ${image.name}`)
    assertImage(actual, image)
  }
}
export function acquireImages(plan, run = docker, report = console.log) {
  for (const image of plan.images) {
    const existing = inspect(canonical(image), run)
    if (existing) {
      assertImage(existing, image)
      continue
    }
    let acquired = false
    for (const registry of ['public.ecr.aws', 'ghcr.io']) {
      const ref = `${registry}/supabase/${image.name}@${image.manifestDigest}`
      report(`Acquiring ${image.name} from ${registry} by immutable digest`)
      try {
        run(['image', 'pull', '--platform', plan.platform, ref])
      } catch (error) {
        report(
          `Image acquisition failed: ${image.name} at ${registry} (status ${error.status ?? 'unavailable'})`,
        )
        continue
      }
      // Content/platform failures are integrity errors, never reasons to silently try a mirror.
      assertImage(inspect(ref, run), image)
      run(['image', 'tag', ref, canonical(image)])
      acquired = true
      break
    }
    assert.ok(acquired, `All approved image sources failed: ${image.name}`)
  }
  verifyImages(plan, run)
}
export function validateBundle(planText, receipt, archiveHash) {
  assert.equal(receipt.schemaVersion, 1)
  assert.equal(receipt.planSha256, hash(planText), 'Image plan changed')
  assert.equal(receipt.archiveSha256, archiveHash, 'Image archive is corrupt')
}
async function hashFile(path) {
  const h = createHash('sha256')
  for await (const chunk of createReadStream(path)) h.update(chunk)
  return h.digest('hex')
}
async function main() {
  assert.equal(process.env.CI, 'true', 'Image bundles are for isolated CI runners only')
  const [command, directory] = process.argv.slice(2)
  assert.ok(['prepare', 'load', 'verify-running'].includes(command), 'Unknown image command')
  const planText = readFileSync(new URL('../.github/supabase-images.json', import.meta.url), 'utf8')
  const plan = validatePlan(JSON.parse(planText))
  const version = execFileSync('supabase', ['--version'], {
    encoding: 'utf8',
    timeout: 30_000,
  }).trim()
  assert.equal(version, plan.cliVersion, 'Supabase CLI does not match the image plan')
  const engine = docker(['info', '--format', '{{.OSType}}/{{.Architecture}}'])
    .trim()
    .replace('/x86_64', '/amd64')
  assert.equal(engine, plan.platform, 'Image bundle requires a native Linux amd64 runner')
  if (command === 'verify-running') {
    const { project } = stackConfig(
      readFileSync(new URL('../supabase/config.toml', import.meta.url), 'utf8'),
    )
    const ids = docker(['ps', '--format', '{{.Names}}'])
      .trim()
      .split('\n')
      .filter((name) => name.startsWith('supabase_') && name.endsWith(`_${project}`))
    assert.ok(ids.length, 'No running project containers')
    const allowed = new Set(plan.images.map((image) => image.imageId))
    for (const container of JSON.parse(docker(['inspect', ...ids]))) {
      assert.ok(allowed.has(container.Image), `Unplanned running image: ${container.Name}`)
    }
    verifyImages(plan)
    console.log('Running test stack uses only the reviewed image content')
    return
  }
  assert.ok(directory, 'Image bundle directory required')
  const dir = resolve(directory)
  mkdirSync(dir, { recursive: true })
  const archive = join(dir, 'images.tar.zst'),
    receipt = join(dir, 'images.json')
  const work = mkdtempSync(join(tmpdir(), 'supabase-images-'))
  const tar = join(work, 'images.tar')
  try {
    if (command === 'load' || existsSync(archive) || existsSync(receipt)) {
      validateBundle(planText, JSON.parse(readFileSync(receipt, 'utf8')), await hashFile(archive))
      execFileSync('zstd', ['-d', archive, '-o', tar], { stdio: 'inherit', timeout: 180_000 })
      execFileSync('docker', ['image', 'load', '--input', tar], {
        stdio: 'inherit',
        timeout: 180_000,
      })
      verifyImages(plan)
      console.log('Verified cached images; no image acquisition required')
      return
    }
    acquireImages(plan)
    execFileSync('docker', ['image', 'save', '--output', tar, ...plan.images.map(canonical)], {
      stdio: 'inherit',
      timeout: 180_000,
    })
    execFileSync('zstd', ['-T2', '-3', tar, '-o', archive], { stdio: 'inherit', timeout: 180_000 })
    writeFileSync(
      receipt,
      JSON.stringify({
        schemaVersion: 1,
        planSha256: hash(planText),
        archiveSha256: await hashFile(archive),
      }) + '\n',
    )
    console.log(
      `Prepared ${plan.images.length} verified public images; database volumes are excluded`,
    )
  } finally {
    rmSync(work, { recursive: true, force: true })
  }
}
if (process.argv[1] === fileURLToPath(import.meta.url)) await main()
