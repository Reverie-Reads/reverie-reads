import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'

const workflow = readFileSync(join(__dirname, '../../../.github/workflows/ci.yml'), 'utf8')
const jobs = workflow.slice(workflow.indexOf('\njobs:\n') + '\njobs:\n'.length)

describe('CI workflow topology', () => {
  it('has three job definitions and preserves the three browser check names in one matrix', () => {
    const jobKeys = [...jobs.matchAll(/^ {2}([a-z][a-z-]*):$/gm)].map((match) => match[1])
    const matrixNames = [...workflow.matchAll(/^ {10}- name: (e2e(?:-a11y|-mobile)?)$/gm)].map(
      (match) => match[1],
    )

    expect(jobKeys).toEqual(['changes', 'gate', 'browser'])
    expect(matrixNames).toEqual(['e2e', 'e2e-a11y', 'e2e-mobile'])
    expect(workflow).toContain('name: ${{ matrix.name }}')
    expect(workflow).toContain('fail-fast: false')
    expect(workflow).toMatch(/- name: e2e\n\s+project: rest\n(?:\s+#.*\n)+\s+timeout: 42/)
    expect(workflow).toContain("if: github.event_name == 'pull_request'")
    expect(workflow).not.toContain(
      "if: github.event_name == 'pull_request' && needs.changes.outputs.docs_only != 'true'",
    )
    expect(workflow.match(/if: needs\.changes\.outputs\.docs_only != 'true'/g)).toHaveLength(8)
  })

  it('keeps secrets in gate and pgTAP on the already-migrated rest database', () => {
    const gate = jobs.slice(jobs.indexOf('  gate:'), jobs.indexOf('  browser:'))
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
})
