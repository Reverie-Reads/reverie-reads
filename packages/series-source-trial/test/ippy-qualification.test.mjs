import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildIppyCapture,
  extractIppyMedalistRecords,
  ippyQualificationStrata,
  IPPY_2025_PAGES,
  parseIppyIdentity,
} from '../src/authority/ippy-qualification.mjs'
import {
  captureIppyPages,
  ippyRobotsPolicy,
  parseIppyCaptureArgs,
} from '../src/capture-authority-qualification-ippy.mjs'

const fixture = `
<!doctype html><html><body><main>
  <h2>OUTSTANDING BOOKS OF THE YEAR</h2>
  <h3>Original Concept</h3><p>Ignore This by Someone (Press)</p>
  <h2>GENERAL CATEGORIES</h2>
  <h3>14. Young Adult Fiction - Fantasy</h3>
  <h4>GOLD</h4><p>Creatures of Chaos by Julie Hall (Julie Hall LLC)</p>
  <h4>BRONZE (TIE)</h4><p>Illustrated Book written by Writer One; illustrated by Artist Two (Small Press)</p>
  <h3>15. Science Fiction</h3>
  <h4>SILVER</h4><p>Two-Part Title</p><p>Author: Writer Two (Other Press)</p>
</main></body></html>`

test('extracts only medalist lines in declared result sections', () => {
  assert.deepEqual(extractIppyMedalistRecords(fixture), [
    {
      section: 'GENERAL CATEGORIES',
      category: '14. Young Adult Fiction - Fantasy',
      medal: 'GOLD',
      parts: ['Creatures of Chaos by Julie Hall (Julie Hall LLC)'],
      line: 'Creatures of Chaos by Julie Hall (Julie Hall LLC)',
    },
    {
      section: 'GENERAL CATEGORIES',
      category: '14. Young Adult Fiction - Fantasy',
      medal: 'BRONZE (TIE)',
      parts: ['Illustrated Book written by Writer One; illustrated by Artist Two (Small Press)'],
      line: 'Illustrated Book written by Writer One; illustrated by Artist Two (Small Press)',
    },
    {
      section: 'GENERAL CATEGORIES',
      category: '15. Science Fiction',
      medal: 'SILVER',
      parts: ['Two-Part Title', 'Author: Writer Two (Other Press)'],
      line: 'Two-Part Title Author: Writer Two (Other Press)',
    },
  ])
})

test('parses factual identity while separating publisher and secondary contributors', () => {
  assert.deepEqual(
    parseIppyIdentity(
      'Illustrated Book written by Writer One; illustrated by Artist Two (Small Press)',
    ),
    {
      eligible: true,
      title: 'Illustrated Book',
      authors: ['Writer One'],
      publisherLabel: 'Small Press',
      reviewFlags: [],
    },
  )
  assert.deepEqual(parseIppyIdentity('Two-Part Title Author: Writer Two (Other Press)').authors, [
    'Writer Two',
  ])
  assert.deepEqual(parseIppyIdentity('Tight Credit by Writer Three(Tight Press)'), {
    eligible: true,
    title: 'Tight Credit',
    authors: ['Writer Three'],
    publisherLabel: 'Tight Press',
    reviewFlags: [],
  })
  assert.deepEqual(
    parseIppyIdentity('Edited Work by Writer Four; edited by Editor Five (Editorial Press)'),
    {
      eligible: true,
      title: 'Edited Work',
      authors: ['Writer Four'],
      publisherLabel: 'Editorial Press',
      reviewFlags: [],
    },
  )
  assert.equal(parseIppyIdentity('A Title Without Attribution').eligible, false)
})

test('maps award categories without inferring an unverified publication year', () => {
  assert.deepEqual(ippyQualificationStrata('E4. Best Sci-Fi/Fantasy/Horror Ebook'), [
    'aphelion',
    'grimoire',
    'marrow',
  ])
})

test('deduplicates overlapping winners while preserving each complete selection frame', () => {
  const records = extractIppyMedalistRecords(fixture)
  const capture = buildIppyCapture({
    pages: [
      {
        id: 'frame-one',
        url: 'https://ippyawards.com/blog/frame-one',
        responseSha256: 'one',
        records,
      },
      {
        id: 'frame-two',
        url: 'https://ippyawards.com/blog/frame-two',
        responseSha256: 'two',
        records: [records[0]],
      },
    ],
    capturedAt: '2026-09-08T06:00:00.000Z',
  })
  assert.equal(capture.cases.length, 3)
  const overlapping = capture.cases.find(({ title }) => title === 'Creatures of Chaos')
  assert.deepEqual(overlapping.selectionFrameIds, ['frame-one', 'frame-two'])
  assert.equal(overlapping.truth.status, 'candidate')
  assert.equal(overlapping.truth.standalone, null)
  assert.deepEqual(overlapping.truth.sources, [])
  assert.equal(overlapping.publicationYear, null)
  assert.equal(overlapping.publicationPath, null)
  assert.deepEqual(overlapping.reviewMetadata.reviewFlags, [
    'verify_publication_path',
    'verify_publication_year',
  ])
  assert.equal(capture.selectionFrames[0].populationCases, 3)
  assert.equal(capture.selectionFrames[1].eligibleReviewedCases, 1)
})

test('accounts for ambiguous and development-overlap exclusions', () => {
  const capture = buildIppyCapture({
    pages: [
      {
        id: 'frame-one',
        url: 'https://ippyawards.com/blog/frame-one',
        responseSha256: 'one',
        records: [
          ...extractIppyMedalistRecords(fixture).slice(0, 1),
          {
            section: 'GENERAL CATEGORIES',
            category: '1. Fiction',
            medal: 'GOLD',
            line: 'No Author Marker',
          },
        ],
      },
    ],
    capturedAt: '2026-09-08T06:00:00.000Z',
    developmentWorkKeys: new Set(['creatures of chaos|julie hall']),
  })
  assert.equal(capture.cases.length, 0)
  assert.equal(capture.selectionFrames[0].populationCases, 2)
  assert.equal(capture.selectionFrames[0].exclusions.length, 2)
})

test('requires the declared robots delay and keeps the capture fixed to four pages', async () => {
  const policy = ippyRobotsPolicy('User-agent: *\nDisallow:\nCrawl-delay: 10\n')
  assert.deepEqual(policy, { crawlDelaySeconds: 10, disallows: [] })
  assert.deepEqual(ippyRobotsPolicy('Crawl-delay: 10\nUser-agent: *\nDisallow:\n'), policy)
  assert.equal(IPPY_2025_PAGES.length, 4)
  const requested = []
  const waits = []
  const fetchImpl = async (url) => {
    requested.push(url)
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\nCrawl-delay: 10\n', {
        headers: { 'content-type': 'text/plain' },
      })
    }
    const repeated = fixture.replace(
      '</main>',
      `${Array.from({ length: 20 }, (_, index) => `<h3>${index}. Fiction</h3><h4>GOLD</h4><p>Book ${index} by Writer ${index} (Press)</p>`).join('')}</main>`,
    )
    return new Response(repeated, { headers: { 'content-type': 'text/html' } })
  }
  const pages = await captureIppyPages({
    fetchImpl,
    wait: async (milliseconds) => waits.push(milliseconds),
  })
  assert.equal(pages.length, 4)
  assert.equal(requested.length, 5)
  assert.deepEqual(waits, [10_000, 10_000, 10_000, 10_000])
})

test('offers a dry-run-only command surface with no partial frame selector', () => {
  assert.deepEqual(parseIppyCaptureArgs(['--dry-run']), { out: null, dryRun: true })
  assert.throws(() => parseIppyCaptureArgs(['--max', '10']), /Unknown argument --max/)
})
