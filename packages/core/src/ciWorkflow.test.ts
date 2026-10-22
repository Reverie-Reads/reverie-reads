import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')
const jobs = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length)
function job(name: string): string {
  const start = jobs.indexOf(`  ${name}:\n`)
  expect(start).toBeGreaterThanOrEqual(0)
  const next = jobs.slice(start + 1).search(/^ {2}[a-z][a-z-]*:$/m)
  return jobs.slice(start, next === -1 ? undefined : start + 1 + next)
}

describe('CI workflow topology', () => {
  it('preserves the three required browser checks while sharing images and offering an explicit full run', () => {
    const jobKeys = [...jobs.matchAll(/^ {2}([a-z][a-z-]*):$/gm)].map((match) => match[1])
    const matrixNames = [...workflow.matchAll(/^ {10}- name: (e2e(?:-a11y|-mobile)?)$/gm)].map(
      (match) => match[1],
    )

    expect(jobKeys).toEqual(['changes', 'gate', 'supabase-images', 'browser', 'full-browser'])
    expect(matrixNames).toEqual(['e2e', 'e2e-a11y', 'e2e-mobile'])
    expect(workflow).toContain('name: ${{ matrix.name }}')
    expect(workflow).toContain('fail-fast: false')
    expect(workflow).toMatch(/- name: e2e\n\s+project: rest\n(?:\s+#.*\n)+\s+timeout: 50/)
    const browser = job('browser')
    expect(browser).toContain("if: always() && github.event_name == 'pull_request'")
    expect(browser).not.toContain(
      "if: github.event_name == 'pull_request' && needs.changes.outputs.docs_only != 'true'",
    )
    expect(browser).toContain('needs: [changes, supabase-images]')
    expect(browser.match(/if: needs\.changes\.outputs\.docs_only != 'true'/g)).toHaveLength(8)
  })

  it('keeps secrets in gate and pgTAP on the already-migrated rest database', () => {
    const gate = job('gate')
    const prettier = gate.indexOf('      - name: Prettier')
    const secretScan = gate.indexOf('      - name: Full-history secret scan')
    const start = jobs.indexOf('      - name: Start Supabase')
    const pgtap = jobs.indexOf('      - name: pgTAP (supabase/tests)')
    const browser = jobs.indexOf('      - name: e2e (${{ matrix.project }})')

    expect(gate).toContain('fetch-depth: 0')
    expect(gate).toContain('GITLEAKS_VERSION: 8.30.1')
    expect(gate).toContain(
      'GITLEAKS_SHA256: 551f6fc83ea457d62a0d98237cbad105af8d557003051f41f3e7ca7b3f2470eb',
    )
    expect(gate).toContain('sha256sum --check -')
    expect(gate).toContain('gitleaks" git --config .gitleaks.toml --redact --no-color --verbose .')
    expect(gate).not.toContain('uses: gitleaks/gitleaks-action@v2')
    expect(secretScan).toBeGreaterThan(prettier)
    expect(gate.slice(secretScan)).toContain('if: always()')
    expect(start).toBeGreaterThan(-1)
    expect(pgtap).toBeGreaterThan(start)
    expect(browser).toBeGreaterThan(pgtap)
    expect(jobs).toContain(
      "if: needs.changes.outputs.docs_only != 'true' && matrix.project == 'rest'",
    )
    expect(jobs).toContain('run: supabase test db')
    expect(jobs).toContain(
      "if: always() && needs.changes.outputs.docs_only != 'true' && steps.supabase.outcome == 'success'",
    )
  })

  it('warms the shared browser cache in main gate and keeps per-project failure artifacts', () => {
    expect(workflow).toContain('Warm Playwright browser cache after merge')
    expect(workflow).toContain("if: github.event_name == 'push' && github.ref == 'refs/heads/main'")
    expect(workflow).toContain('name: ${{ matrix.artifact }}')
  })

  it('acquires public images once with an exact cache key and validates the bundle before stack startup', () => {
    const acquisition = job('supabase-images'),
      browser = job('browser')
    expect(acquisition).toContain("if: needs.changes.outputs.docs_only != 'true'")
    expect(acquisition).toContain(
      "hashFiles('.github/supabase-images.json', 'scripts/ci-supabase-images.mjs', 'supabase/config.toml')",
    )
    expect(acquisition).not.toContain('restore-keys:')
    expect(acquisition).not.toContain('packages: write')
    expect(acquisition).toContain('Verify the warm-bundle path after cold acquisition')
    expect(acquisition).toContain('retention-days: 1')
    expect(browser.indexOf('uses: ./.github/actions/load-supabase-images')).toBeLessThan(
      browser.indexOf('- name: Start Supabase'),
    )
    expect(browser).toContain('node scripts/ci-supabase-images.mjs verify-running')
    expect(browser).not.toContain('GHCR_TOKEN:')
    const loader = readFileSync(
      join(__dirname, '../../../.github/actions/load-supabase-images/action.yml'),
      'utf8',
    )
    expect(loader).toContain('name: supabase-images')
    expect(loader).toContain('node scripts/ci-supabase-images.mjs load .ci-supabase-images')
    expect(loader).not.toContain('run-id:')
  })

  it('keeps the complete dedicated-runner gate opt-in, fresh, one-worker and zero-retry', () => {
    const full = job('full-browser')
    expect(full).toContain(
      "contains(github.event.pull_request.labels.*.name, 'verify-full-browser')",
    )
    expect(full).toContain("needs.changes.outputs.docs_only != 'true'")
    expect(full).toContain('E2E_WORKERS: 1')
    expect(full).toContain('pnpm e2e --retries=0')
    expect(full).toContain('supabase start -x studio,vector,edge-runtime,imgproxy')
    expect(full).toContain('node scripts/ci-supabase-images.mjs verify-running')
    expect(full).toContain('run: supabase test db')
    expect(full).not.toContain('db:seed')
    expect(full).not.toContain('actions/cache')
  })
})
