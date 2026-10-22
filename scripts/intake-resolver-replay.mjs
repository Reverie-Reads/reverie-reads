import { readFile, writeFile, stat, mkdir } from 'node:fs/promises'
import { resolve, dirname } from 'node:path'
import { pathToFileURL } from 'node:url'
import { resolveIntakeEvidence } from '../packages/core/src/intakeResolver.ts'
import {
  intakeOutcomeDiagnostics,
  summarizeIntakeOutcomes,
} from '../packages/core/src/intakeOutcomeDiagnostics.ts'

const exact = (v, fields) =>
  v &&
  typeof v === 'object' &&
  !Array.isArray(v) &&
  Object.keys(v).length === fields.length &&
  fields.every((k) => Object.hasOwn(v, k))
const sorted = (values) => JSON.stringify([...values].sort())

/** Offline development replay. Expected answers never enter the resolver's request. */
export function replayIntakeEvidence(input) {
  if (
    !exact(input, ['version', 'basis', 'cases']) ||
    input.version !== 1 ||
    !['synthetic_regression', 'reviewed_case_reconstruction'].includes(input.basis) ||
    !Array.isArray(input.cases) ||
    !input.cases.length ||
    input.cases.length > 500
  )
    throw new Error('Invalid intake replay manifest')
  const ids = new Set()
  const cases = input.cases.map((c) => {
    if (
      !exact(c, [
        'id',
        'request',
        'expected',
        ...(c?.diagnostics === undefined ? [] : ['diagnostics']),
      ]) ||
      typeof c.id !== 'string' ||
      !c.id.trim() ||
      c.id.length > 200 ||
      ids.has(c.id) ||
      !exact(c.expected, ['work', 'edition', 'proposedFields']) ||
      !['resolved', 'review', 'unresolved'].includes(c.expected.work) ||
      !['resolved', 'review', 'unknown'].includes(c.expected.edition) ||
      !Array.isArray(c.expected.proposedFields) ||
      c.expected.proposedFields.some((f) => typeof f !== 'string') ||
      new Set(c.expected.proposedFields).size !== c.expected.proposedFields.length
    )
      throw new Error('Invalid intake replay case')
    ids.add(c.id)
    const result = resolveIntakeEvidence(c.request)
    if (c.expected.proposedFields.some((f) => !result.fields.some((x) => x.field === f)))
      throw new Error('Invalid expected field')
    const proposedFields = result.fields.filter((f) => f.state === 'proposed').map((f) => f.field)
    const passed =
      result.work.state === c.expected.work &&
      result.edition.state === c.expected.edition &&
      sorted(proposedFields) === sorted(c.expected.proposedFields)
    const diagnostics = intakeOutcomeDiagnostics(result, c.diagnostics)
    return { id: c.id, passed, expected: c.expected, result, diagnostics }
  })
  return {
    version: 1,
    mode: 'review_only',
    basis: input.basis,
    summary: {
      cases: cases.length,
      passed: cases.filter((c) => c.passed).length,
      failed: cases.filter((c) => !c.passed).length,
      workResolved: cases.filter((c) => c.result.work.state === 'resolved').length,
      workReview: cases.filter((c) => c.result.work.state === 'review').length,
      editionResolved: cases.filter((c) => c.result.edition.state === 'resolved').length,
      unexpectedWorkResolutions: cases.filter(
        (c) => c.expected.work !== 'resolved' && c.result.work.state === 'resolved',
      ).length,
      unexpectedEditionResolutions: cases.filter(
        (c) => c.expected.edition !== 'resolved' && c.result.edition.state === 'resolved',
      ).length,
      writes: 0,
      requests: 0,
      outcomes: summarizeIntakeOutcomes(cases.map((c) => c.diagnostics)),
    },
    cases,
  }
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const supplied = process.argv.slice(2).filter((a) => a !== '--')
    const aggregateOnly = supplied[0] === '--aggregate-only'
    const args = aggregateOnly ? supplied.slice(1) : supplied
    if (args.length !== 2)
      throw new Error(
        'Usage: pnpm intake:replay [--aggregate-only] input.json /absolute/private/output.json',
      )
    const [input, output] = args.map((p) => resolve(p))
    if ((await stat(input)).size > 8 * 1024 * 1024)
      throw new Error('Intake replay input exceeds 8 MiB')
    const report = replayIntakeEvidence(JSON.parse(await readFile(input, 'utf8')))
    await mkdir(dirname(output), { recursive: true, mode: 0o700 })
    // Explicit export allowlist: future full-report fields cannot silently enter this boundary.
    const aggregate = {
      version: report.version,
      mode: report.mode,
      basis: report.basis,
      summary: report.summary,
    }
    await writeFile(output, JSON.stringify(aggregateOnly ? aggregate : report, null, 2) + '\n', {
      flag: 'wx',
      mode: 0o600,
    })
    console.log(JSON.stringify({ basis: report.basis, ...report.summary }))
    if (report.summary.failed) process.exitCode = 1
  } catch (error) {
    // Do not echo potentially private malformed values or parse-error excerpts.
    console.error(error instanceof SyntaxError ? 'Invalid intake replay JSON' : error.message)
    process.exitCode = 1
  }
}
