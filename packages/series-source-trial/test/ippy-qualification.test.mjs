import assert from 'node:assert/strict'
import { test } from 'node:test'
import {
  buildIppyCapture,
  extractIppyArchiveMedalistRecords,
  extractIppyMedalistRecords,
  ippyQualificationStrata,
  IPPY_QUALIFICATION_PAGES,
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

const archiveFixture = `
<!doctype html><html><body>
  <div class="wpr-promo-box-content">
    <h3 class="wpr-promo-box-title">24. Mystery</h3>
    <div class="wpr-promo-box-description">
      <p>GOLD (tie):</p>
      <p>Book by Design</p><p>Writer One</p><p>Press One</p>
      <p>Book One B</p><p>by Writer One B</p><p>Press One B</p>
      <p>SILVER (tie) :</p>
      <p>Book Two</p><p>by Writer Two</p><p>Press Two</p>
      <p>Book Three</p><p>by Writer Three</p>
      <p>BRONZE :</p><p>Book Four by Writer Four</p><p>by illustrated by Artist Five</p>
    </div>
  </div>
  <div class="wpr-promo-box-content">
    <h3 class="wpr-promo-box-title">80. Book/Author/Publisher Website</h3>
    <div class="wpr-promo-box-description">
      <p>GOLD (tie):</p><p>https://one.example</p><p>https://two.example</p>
      <p>SILVER:</p><p>https://three.example</p>
      <p>BRONZE:</p><p>https://four.example</p>
    </div>
  </div>
</body></html>`

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
  assert.deepEqual(parseIppyIdentity('Repair Credit by Writer Three (Repair Press'), {
    eligible: true,
    title: 'Repair Credit',
    authors: ['Writer Three'],
    publisherLabel: 'Repair Press',
    reviewFlags: ['source_publisher_parenthesis_repaired'],
  })
  assert.deepEqual(parseIppyIdentity('House Book by House Press (House Press)'), {
    eligible: true,
    title: 'House Book',
    authors: ['House Press'],
    publisherLabel: 'House Press',
    reviewFlags: ['verify_author_publisher_identity'],
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
  assert.deepEqual(
    parseIppyIdentity('Audio Work written and narrated by Writer Five (Audio Press)').authors,
    ['Writer Five'],
  )
  assert.deepEqual(
    parseIppyIdentity('Picture Work by Writer Six by illustrated by Artist Seven (Art Press)')
      .authors,
    ['Writer Six'],
  )
  assert.deepEqual(
    parseIppyIdentity('Anthology by Collective Authors edited by Editor Eight (Press)').reviewFlags,
    ['verify_contributor_split'],
  )
  assert.equal(parseIppyIdentity('A Title Without Attribution').eligible, false)
})

test('extracts archive cards structurally and accounts for the non-book website category', () => {
  const records = extractIppyArchiveMedalistRecords(archiveFixture)
  assert.equal(records.length, 9)
  assert.deepEqual(records[0].identity, {
    eligible: true,
    title: 'Book by Design',
    authors: ['Writer One'],
    publisherLabel: 'Press One',
    reviewFlags: [],
  })
  assert.deepEqual(records[4].identity, {
    eligible: true,
    title: 'Book Four',
    authors: ['Writer Four'],
    publisherLabel: null,
    reviewFlags: ['publisher_label_missing', 'verify_contributor_split'],
  })
  assert.equal(
    records.filter(({ exclusionReason }) => exclusionReason === 'non-book website award category')
      .length,
    4,
  )
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
        year: 2025,
        format: 'sectioned',
        url: 'https://ippyawards.com/blog/frame-one',
        responseSha256: 'one',
        records,
      },
      {
        id: 'frame-two',
        year: 2024,
        format: 'archive-card',
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
  assert.deepEqual(overlapping.reviewMetadata.awardYears, [2024, 2025])
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
        year: 2025,
        format: 'sectioned',
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

test('requires the declared robots delay and keeps the capture fixed to six pages', async () => {
  const policy = ippyRobotsPolicy('User-agent: *\nDisallow:\nCrawl-delay: 10\n')
  assert.deepEqual(policy, { crawlDelaySeconds: 10, disallows: [] })
  assert.deepEqual(ippyRobotsPolicy('Crawl-delay: 10\nUser-agent: *\nDisallow:\n'), policy)
  assert.equal(IPPY_QUALIFICATION_PAGES.length, 6)
  const requested = []
  const waits = []
  const fetchImpl = async (url) => {
    requested.push(url)
    if (url.endsWith('/robots.txt')) {
      return new Response('User-agent: *\nDisallow:\nCrawl-delay: 10\n', {
        headers: { 'content-type': 'text/plain' },
      })
    }
    if (/\/blog\/202[34]-medalists$/.test(url)) {
      const repeated = `<!doctype html><html><body>${Array.from(
        { length: 120 },
        (_, index) => `
          <div class="wpr-promo-box-content">
            <h3 class="wpr-promo-box-title">${index + 1}. Fiction</h3>
            <div class="wpr-promo-box-description">
              <p>GOLD:</p><p>Gold Book ${index}</p><p>Writer ${index} A</p><p>Press</p>
              <p>SILVER:</p><p>Silver Book ${index}</p><p>Writer ${index} B</p><p>Press</p>
              <p>BRONZE:</p><p>Bronze Book ${index}</p><p>Writer ${index} C</p><p>Press</p>
            </div>
          </div>`,
      ).join('')}</body></html>`
      return new Response(repeated, { headers: { 'content-type': 'text/html' } })
    }
    const repeated = fixture.replace(
      '</main>',
      `${Array.from({ length: 120 }, (_, index) => `<h3>${index}. Fiction</h3><h4>GOLD</h4><p>Book ${index} by Writer ${index} (Press)</p>`).join('')}</main>`,
    )
    return new Response(repeated, { headers: { 'content-type': 'text/html' } })
  }
  const pages = await captureIppyPages({
    fetchImpl,
    wait: async (milliseconds) => waits.push(milliseconds),
  })
  assert.equal(pages.length, 6)
  assert.equal(requested.length, 7)
  assert.deepEqual(waits, [10_000, 10_000, 10_000, 10_000, 10_000, 10_000])
})

test('offers a dry-run-only command surface with no partial frame selector', () => {
  assert.deepEqual(parseIppyCaptureArgs(['--dry-run']), { out: null, dryRun: true })
  assert.throws(() => parseIppyCaptureArgs(['--max', '10']), /Unknown argument --max/)
})
