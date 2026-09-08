import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildPrhCapture,
  buildPrhFrameSpec,
  buildPrhQualificationCandidate,
  prhAuthorNames,
  prhMembershipProposal,
  prhQualificationStrata,
  prhRequestUrl,
  prhUrl,
  sanitizePrhUrl,
} from '../src/authority/prh-qualification.mjs'
import { fetchPrhJson, parsePrhCaptureArgs } from '../src/capture-authority-qualification-prh.mjs'
import {
  mergeQualificationFrames,
  parseQualificationMergeArgs,
} from '../src/merge-authority-qualification-pool.mjs'

const frame = buildPrhFrameSpec({
  frameId: 'prh-us-2025-q1',
  from: '2025-01-01',
  to: '2025-03-31',
})

test('builds a bounded first-party frame without persisting the API key', () => {
  assert.match(frame.url, /domains\/PRH\.US\/works/)
  assert.match(frame.url, /workOnSaleFrom=01%2F01%2F2025/)
  assert.match(frame.url, /rows=0/)
  assert.doesNotMatch(frame.url, /api_key/)
  assert.doesNotMatch(frame.url, /hasSeriesNumber/)
  assert.equal(frame.selectionConstraint, 'all_works_in_date_interval')
  const request = prhRequestUrl(frame.url, 'top-secret')
  assert.equal(request.searchParams.get('api_key'), 'top-secret')
  assert.doesNotMatch(sanitizePrhUrl(request), /top-secret|api_key/)
})

test('can preregister a complete date-bounded numbered-series challenge frame', () => {
  const numberedFrame = buildPrhFrameSpec({
    frameId: 'prh-us-2018-numbered-series',
    from: '2018-01-01',
    to: '2018-12-31',
    numberedSeriesOnly: true,
  })
  assert.equal(numberedFrame.parameters.hasSeriesNumber, true)
  assert.equal(numberedFrame.selectionConstraint, 'numbered_series_works_in_date_interval')
  assert.match(numberedFrame.url, /hasSeriesNumber=true/)
})

test('rejects unbounded or ambiguous capture arguments', () => {
  const options = parsePrhCaptureArgs([
    '--frame-id',
    'prh-us-2025-q1',
    '--from',
    '2025-01-01',
    '--to',
    '2025-03-31',
    '--numbered-series-only',
    '--dry-run',
  ])
  assert.equal(options.dryRun, true)
  assert.equal(options.numberedSeriesOnly, true)
  assert.throws(
    () => parsePrhCaptureArgs(['--frame-id', 'prh-us-2025-q1', '--from', '2025-01-01']),
    /requires --frame-id, --from, and --to/,
  )
  assert.throws(
    () =>
      parsePrhCaptureArgs([
        '--frame-id',
        'prh-us-2025-q1',
        '--from',
        '2025-01-01',
        '--to',
        '2025-03-31',
        '--max',
        '10',
      ]),
    /Unknown argument --max/,
  )
})

test('keeps only primary authors when PRH supplies contributor roles', () => {
  assert.deepEqual(
    prhAuthorNames(
      [
        { display: 'Writer One', contribRoleCode: 'A' },
        { display: 'Translator Two', contribRoleDesc: 'Translator' },
      ],
      'Fallback',
    ),
    ['Writer One'],
  )
})

test('maps catalog categories to qualification coverage without making truth claims', () => {
  assert.deepEqual(
    prhQualificationStrata([
      { description: 'Fiction / Romance / Fantasy' },
      { description: 'Young Adult Fiction / Horror' },
    ]),
    ['bloom', 'grimoire', 'marrow', 'tryst'],
  )
})

test('turns exact structured relationships into review-only proposals', () => {
  const proposed = prhMembershipProposal(
    [
      {
        seriesCode: 'ALP',
        seriesName: 'Alpha Cycle',
        isNumbered: true,
        description: 'This publisher description must not be retained.',
      },
      { seriesCode: 'COL', seriesName: "Collector's Editions", isNumbered: false },
    ],
    { ALP: 2, COL: undefined },
  )
  assert.equal(proposed.memberships.length, 2)
  assert.deepEqual(proposed.memberships[0].positions, [{ value: 2, orderType: 'publication' }])
  assert.ok(proposed.reviewFlags.includes('multi_series'))
  assert.ok(proposed.reviewFlags.includes('possible_marketing_collection'))
  assert.ok(proposed.reviewFlags.includes('unnumbered_series'))
  assert.doesNotMatch(JSON.stringify(proposed), /publisher description/)
})

test('never upgrades a missing series relation to standalone truth', () => {
  const built = buildPrhQualificationCandidate({
    work: {
      workId: 42,
      title: 'A Quiet Book',
      author: 'A. Writer',
      onsale: '2025-02-10',
      seoFriendlyUrl: '/books/42/a-quiet-book-by-a-writer',
    },
    authors: [{ display: 'A. Writer', contribRoleCode: 'A' }],
    categories: [{ description: 'Fiction / Literary' }],
    series: [],
    positionBySeriesCode: {},
    frame,
  })
  assert.equal(built.eligible, true)
  assert.equal(built.case.truth.status, 'candidate')
  assert.equal(built.case.truth.standalone, null)
  assert.deepEqual(built.case.truth.memberships, [])
  assert.deepEqual(built.case.truth.sources, [])
  assert.match(built.case.truth.reviewNote, /unresolved, not standalone evidence/)
})

test('retains series identity, position, quarantine flags, and evidence digests for review', () => {
  const built = buildPrhQualificationCandidate({
    work: {
      workId: 43,
      title: 'Series',
      author: 'B. Writer',
      onsale: '2019-02-10',
      seoFriendlyUrl: '/books/43/series-by-b-writer',
    },
    authors: [{ display: 'B. Writer', contribRoleDesc: 'Author' }],
    categories: [{ description: 'Fiction / Science Fiction' }],
    series: [{ seriesCode: 'SER', seriesName: 'Series', isNumbered: true }],
    positionBySeriesCode: { SER: 1.5 },
    frame,
    evidenceDigests: {
      series: { sha256: 'abc' },
      seriesPositions: {
        SER: {
          url: 'https://api.penguinrandomhouse.com/title/client/Public/domains/PRH.US/series/SER/works?sort=seriesNumber&api_key=should-not-survive',
          sha256: 'def',
        },
      },
    },
  })
  assert.equal(built.case.truth.standalone, false)
  assert.deepEqual(built.case.truth.memberships[0].positions, [
    { value: 1.5, orderType: 'publication' },
  ])
  assert.ok(built.case.reviewMetadata.reviewFlags.includes('self_titled_series'))
  assert.ok(built.case.reviewMetadata.reviewFlags.includes('fractional_position'))
  assert.equal(built.case.reviewMetadata.evidenceDigests.series.sha256, 'abc')
  assert.equal(built.case.truth.sources.length, 2)
  assert.doesNotMatch(JSON.stringify(built.case), /api_key|should-not-survive/)
})

test('requires a complete capture to reconcile every record', () => {
  const candidate = buildPrhQualificationCandidate({
    work: { workId: 44, title: 'Book', author: 'C. Writer', onsale: '2024-01-01' },
    authors: [],
    categories: [],
    series: [{ seriesCode: 'BKS', seriesName: 'Books', isNumbered: true }],
    positionBySeriesCode: { BKS: 1 },
    frame,
  }).case
  const capture = buildPrhCapture({
    frameSpec: frame,
    capturedAt: '2026-09-07T20:00:00.000Z',
    populationCases: 2,
    candidates: [candidate],
    exclusions: [{ reason: 'missing identity', count: 1 }],
  })
  assert.equal(capture.selectionFrames[0].complete, true)
  assert.equal(capture.selectionFrames[0].populationCases, 2)
  assert.equal(capture.selectionFrames[0].eligibleReviewedCases, 1)
  assert.throws(
    () =>
      buildPrhCapture({
        frameSpec: frame,
        capturedAt: '2026-09-07T20:00:00.000Z',
        populationCases: 3,
        candidates: [candidate],
        exclusions: [{ reason: 'missing identity', count: 1 }],
      }),
    /does not reconcile/,
  )
})

test('sends the API key but returns only a sanitized evidence URL', async () => {
  let requested
  const result = await fetchPrhJson(prhUrl('/domains/PRH.US/works', { rows: 1 }), {
    apiKey: 'secret-value',
    delayMs: 0,
    fetchImpl: async (url) => {
      requested = new URL(url)
      return new Response(JSON.stringify({ recordCount: 0, data: { works: [] } }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      })
    },
  })
  assert.equal(requested.searchParams.get('api_key'), 'secret-value')
  assert.doesNotMatch(result.url, /secret-value|api_key/)
})

test('merges private reviewed frames without changing their selection provenance', () => {
  const left = { schemaVersion: 1, selectionFrames: [{ id: 'left' }], cases: [{ id: 'a' }] }
  const right = { schemaVersion: 1, selectionFrames: [{ id: 'right' }], cases: [{ id: 'b' }] }
  assert.deepEqual(mergeQualificationFrames([left, right]), {
    schemaVersion: 1,
    sharedSources: {},
    selectionFrames: [{ id: 'left' }, { id: 'right' }],
    cases: [{ id: 'a' }, { id: 'b' }],
  })
  assert.deepEqual(
    parseQualificationMergeArgs([
      '--input',
      'one.json',
      '--input',
      'two.json',
      '--out',
      'pool.json',
      '--require-minimum',
    ]),
    {
      inputs: ['one.json', 'two.json'],
      out: 'pool.json',
      requireMinimum: true,
    },
  )
})
