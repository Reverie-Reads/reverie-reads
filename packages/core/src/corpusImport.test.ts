import { describe, expect, it } from 'vitest'
import {
  unmatchedLibrary,
  coAuthorRows,
  partialAuthorRows,
  normTitleKey,
  csvCell,
  csvFile,
  parseCsv,
  toRecords,
  normalizeRecord,
  dropAndCollapse,
  classify,
  buildReport,
  workKeyOf,
  isOmnibusSuspect,
  seriesStatusOf,
  canonicalIsbns,
  assertNoCrossWorkIsbnCollisions,
  crossWorkIsbnCollisions,
} from '../../../scripts/corpus-import-lib'
import {
  runBackfill,
  type BackfillPatch,
  type CorpusBackfillStore,
} from '../../../scripts/corpus-backfill'
import { makeBook } from './book.fixture'

/**
 * The import's PURE half, against a SYNTHETIC fixture — no row here is copied from the real CSV,
 * which carries personal data and is deliberately untracked. The fixture reproduces the real
 * file's SHAPES: the quoted "Author, First" headers, trailing-space authors, semicolon multi-genre
 * with mixed casing, an omnibus title, a Duplicate flag, a TC Read flag, blank spacer rows.
 */
const FIXTURE = [
  'Title,"Author, First","Author, Last",Series,Completed / Standalones,Genre,Tags,,GC Read,TC Read,Duplicate,,',
  'Ash Crown,Vera ,Stone ,Cinder Court,Completed,Fantasy; Romance,found family,,TRUE,,,,',
  'Salt Harbor,Milo,Reyes,,Standalone,horror,,,,TRUE,,,',
  'Glass Anchor,Ida,Marsh,,Standalone,Horror; Fantasy,slow burn; enemies to lovers,,,,,,',
  'Ash Crown,Vera,Stone,Cinder Court,Completed,Fantasy,,,TRUE,,TRUE,,',
  'The Tide Saga Books 1-3,Milo,Reyes,Tide Saga,Completed,Fantasy,,,,,,,',
  'Glass  Anchor,Ida,Marsh,,Standalone,Fantasy,,,,,,,',
  ',,,,,,,,,,,,',
  'No Author Book,,,,Standalone,Mystery,,,,,,,',
].join('\n')

const records = () => toRecords(parseCsv(FIXTURE)).map(normalizeRecord)

describe('parseCsv', () => {
  it('handles quoted headers with embedded commas and skips blank spacer rows', () => {
    const rows = parseCsv(FIXTURE)
    expect(rows[0]![1]).toBe('Author, First')
    // 1 header + 7 data rows; the all-commas spacer is dropped by toRecords, not the parser
    expect(rows).toHaveLength(9)
    expect(toRecords(rows)).toHaveLength(7)
  })

  it('refuses a malformed file rather than guessing', () => {
    expect(() => parseCsv('Title\n"unterminated')).toThrow(/unterminated/)
  })

  it('fails loudly when an expected column is missing — a reordered export must not shift fields', () => {
    expect(() => toRecords(parseCsv('Name,Writer\nX,Y'))).toThrow(/missing expected column/)
  })
})

describe('normalizeRecord', () => {
  it('trims the trailing-space authors the real file carries', () => {
    const r = records()[0]!
    expect(r.first).toBe('Vera')
    expect(r.author).toBe('Vera Stone')
  })

  it('splits semicolon multi-genre with mixed casing via normalizeImportGenres', () => {
    const [ash, salt, glass] = records() as [
      ReturnType<typeof normalizeRecord>,
      ReturnType<typeof normalizeRecord>,
      ReturnType<typeof normalizeRecord>,
    ]
    expect(ash.genre).toBe('fantasy') // first core wins as primary
    expect(ash.genres).toEqual(expect.arrayContaining(['Fantasy', 'Romance']))
    expect(salt.genre).toBe('horror') // lowercased input still maps
    expect(glass.genres).toEqual(expect.arrayContaining(['Horror', 'Fantasy']))
  })

  it('tags come through lowercased from the tags column', () => {
    expect(records()[2]!.tags).toEqual(expect.arrayContaining(['slow burn', 'enemies to lovers']))
  })

  it('work_key is core-norm title|full-author — the ta: cache-key body, by construction', () => {
    expect(records()[0]!.workKey).toBe('ashcrown|verastone')
  })

  it('maps the status column conservatively', () => {
    expect(seriesStatusOf('Completed', true)).toBe('completed')
    expect(seriesStatusOf('Standalone', false)).toBe('standalone')
    expect(seriesStatusOf('', true)).toBe('ongoing')
    expect(seriesStatusOf('', false)).toBe('standalone')
  })
})

describe('canonicalIsbns', () => {
  it('promotes ISBN-10, strips punctuation, deduplicates, and omits invalid values', () => {
    expect(canonicalIsbns(['0-306-40615-2', '978-0-306-40615-7', '', null, 'not an isbn'])).toEqual(
      ['9780306406157'],
    )
  })

  it('rejects checksum-invalid identifiers instead of canonicalizing them', () => {
    expect(canonicalIsbns(['0306406153', '9780306406158'])).toEqual([])
  })
})

describe('cross-work ISBN collisions', () => {
  it('allows repeats within one work but reports the same edition on distinct works', () => {
    const rows = [
      { workKey: 'one', isbns: ['0-306-40615-2', '9780306406157'] },
      { workKey: 'two', isbns: ['9780306406157'] },
    ]
    expect(crossWorkIsbnCollisions(rows)).toEqual([
      { isbn: '9780306406157', workKeys: ['one', 'two'] },
    ])
    expect(() => assertNoCrossWorkIsbnCollisions(rows)).toThrow(
      /cross-work ISBN collision.*9780306406157.*one, two/s,
    )
  })

  it('does not treat repeated rows for the same work as a collision', () => {
    expect(
      crossWorkIsbnCollisions([
        { workKey: 'one', isbns: ['0306406152'] },
        { workKey: 'one', isbns: ['9780306406157'] },
      ]),
    ).toEqual([])
  })
})

describe('runBackfill', () => {
  it('ignores legacy cache rows even if the store returns them', async () => {
    let writes = 0
    const store: CorpusBackfillStore = {
      async fetchWorks() {
        return [{ work_key: 'legacy', work_id: null, cover_url: null, isbns: [] }]
      },
      async fetchEnrichments(keys) {
        expect(keys).toEqual(['no-isbndb-v1:ta:legacy'])
        return [
          { key: 'ta:legacy', work_id: 'old:1', record: { cover: 'https://old.invalid/a.jpg' } },
        ]
      },
      async updateWork() {
        writes++
      },
    }
    await expect(runBackfill(store)).resolves.toEqual({ examined: 1, cacheHits: 0, updated: 0 })
    expect(writes).toBe(0)
  })

  it('inspects an already-complete work and accumulates a later enrichment ISBN', async () => {
    const updates: { workKey: string; patch: BackfillPatch }[] = []
    const store: CorpusBackfillStore = {
      async fetchWorks() {
        return [
          {
            work_key: 'complete-work',
            work_id: 'hc:work:1',
            cover_url: 'https://covers.test/already.jpg',
            isbns: ['9780306406157'],
          },
        ]
      },
      async fetchEnrichments(keys) {
        expect(keys).toEqual(['no-isbndb-v1:ta:complete-work'])
        return [
          {
            key: 'no-isbndb-v1:ta:complete-work',
            work_id: 'hc:work:1',
            record: { isbns: ['9780306406157', '9781649374042'] },
          },
        ]
      },
      async updateWork(workKey, patch) {
        updates.push({ workKey, patch })
      },
    }

    await expect(runBackfill(store)).resolves.toEqual({ examined: 1, cacheHits: 1, updated: 1 })
    expect(updates).toEqual([
      {
        workKey: 'complete-work',
        patch: { isbns: ['9780306406157', '9781649374042'] },
      },
    ])
  })

  it('checks all proposed ISBNs before performing any update', async () => {
    let writes = 0
    const store: CorpusBackfillStore = {
      async fetchWorks() {
        return [
          { work_key: 'one', work_id: null, cover_url: null, isbns: [] },
          { work_key: 'two', work_id: null, cover_url: null, isbns: [] },
        ]
      },
      async fetchEnrichments() {
        return [
          { key: 'no-isbndb-v1:ta:one', work_id: null, record: { isbn13: '9780306406157' } },
          { key: 'no-isbndb-v1:ta:two', work_id: null, record: { isbn10: '0306406152' } },
        ]
      },
      async updateWork() {
        writes++
      },
    }

    await expect(runBackfill(store)).rejects.toThrow(/cross-work ISBN collision/)
    expect(writes).toBe(0)
  })
})

describe('dropAndCollapse', () => {
  it('drops Duplicate-flagged rows and collapses exact key collisions, reporting both', () => {
    const { kept, collapsed, duplicatesDropped } = dropAndCollapse(records())
    // the flagged 'Ash Crown' repeat is dropped as Duplicate…
    expect(duplicatesDropped).toBe(1)
    // …and 'Glass  Anchor' (double space) collapses onto 'Glass Anchor' — same normalized key
    expect(collapsed).toHaveLength(1)
    expect(collapsed[0]!.workKey).toBe('glassanchor|idamarsh')
    expect(kept.map((r) => r.title)).toEqual([
      'Ash Crown',
      'Salt Harbor',
      'Glass Anchor',
      'The Tide Saga Books 1-3',
      'No Author Book',
    ])
  })
})

describe('classify', () => {
  const library = [
    makeBook({ id: 'b1', title: 'Ash Crown', first: 'Vera', last: 'Stone' }),
    // fuzzy bait: same author, title differing only by a subtitle
    makeBook({ id: 'b2', title: 'Salt Harbor: A Novel', first: 'Milo', last: 'Reyes' }),
  ]

  it('routes strong matches to existing, fuzzy to near-miss (never auto-resolved), rest to new', () => {
    const { kept } = dropAndCollapse(records())
    const { existing, fresh, nearMiss } = classify(kept, library)
    expect(existing.map((e) => e.record.title)).toEqual(['Ash Crown'])
    expect(existing[0]!.strength).toBe('title-author')
    expect(nearMiss.map((n) => n.record.title)).toEqual(['Salt Harbor'])
    expect(fresh.map((r) => r.title)).toEqual([
      'Glass Anchor',
      'The Tide Saga Books 1-3',
      'No Author Book',
    ])
  })
})

describe('anomaly surfacing', () => {
  it('flags omnibus shapes', () => {
    expect(isOmnibusSuspect('The Tide Saga Books 1-3')).toBe(true)
    expect(isOmnibusSuspect('Complete Box Set')).toBe(true)
    expect(isOmnibusSuspect('The Wolf Collection')).toBe(true)
    expect(isOmnibusSuspect('#1-5 omnibus')).toBe(true)
    expect(isOmnibusSuspect('A Perfectly Ordinary Novel')).toBe(false)
  })

  it('the report carries every anomaly and counts TC Read WITHOUT importing it anywhere', () => {
    const all = records()
    const { kept, collapsed, duplicatesDropped } = dropAndCollapse(all)
    const { existing, fresh, nearMiss } = classify(kept, [])
    const report = buildReport({
      records: all,
      kept,
      collapsed,
      duplicatesDropped,
      existing,
      fresh,
      nearMiss,
    })
    expect(report.totals.tcReadRowsNotImported).toBe(1) // Salt Harbor's TC flag — counted, never written
    expect(report.omnibusSuspects).toEqual(['The Tide Saga Books 1-3'])
    expect(report.emptyAuthor).toEqual(['No Author Book'])
    expect(report.totals.gcRead).toBe(1)
  })

  it('nothing in a normalized record carries the TC flag forward as data any writer consumes', () => {
    // the flag exists on the record for COUNTING; the assertion here is that work/book payload
    // construction lives in the shell (import-corpus-csv.mjs) and reads named fields, never a
    // spread of the whole record — this test pins the lib's contract that tcRead is report-only
    const r = records()[1]!
    expect(r.tcRead).toBe(true)
    expect(workKeyOf(r)).not.toContain('tc')
  })
})

/**
 * THE DIAGNOSTICS (--dump). Instrumentation only: none of these change the matcher, the key
 * derivation, or the CSV. They exist so 231 unmatched library books stop being a number nobody can
 * interrogate.
 */
describe('unmatchedLibrary — the inverse the classifier never computed', () => {
  const lib = [
    makeBook({ id: 'b1', title: 'Ash Crown', first: 'Vera', last: 'Stone' }),
    makeBook({ id: 'b2', title: 'Salt Harbor', first: 'Milo', last: 'Reyes' }),
    makeBook({ id: 'b3', title: 'A Quiet Ledger', first: 'Nell', last: 'Marrow' }),
  ]

  it('returns the library books no row strongly matched', () => {
    const out = unmatchedLibrary(lib, [{ book: lib[1]! }])
    expect(out.map((b) => b.id)).toEqual(['b3', 'b1']) // sorted by normalised title
  })

  it('a FUZZY near-miss candidate still counts as unmatched', () => {
    // A near-miss did not import and did not pair. Excluding it would hide a book from the one file
    // someone reads to ask "why is this not accounted for".
    expect(unmatchedLibrary(lib, []).map((b) => b.id)).toEqual(['b3', 'b1', 'b2'])
  })

  it('sorts by the SAME key new.csv uses, so the two files align', () => {
    // The alignment is the diagnostic: a missed match reads as near-identical titles at the same
    // place in both files. Sorting them differently would destroy the only thing the dump adds.
    expect(normTitleKey('A Quiet Ledger!')).toBe('a quiet ledger')
    expect(normTitleKey('  The—Ash   Crown ')).toBe('the ash crown')
  })

  it('is empty when everything matched', () => {
    expect(
      unmatchedLibrary(
        lib,
        lib.map((book) => ({ book })),
      ),
    ).toEqual([])
  })
})

describe('author-shape counts — invisible in the report until now', () => {
  const rows = () =>
    toRecords(
      parseCsv(
        [
          'Title,"Author, First","Author, Last",Series,Completed / Standalones,Genre,Tags,,GC Read,TC Read,Duplicate,,',
          'The Strain,Guillermo del Toro & Chuck,Hogan,,Standalone,Horror,,,,,,,',
          'Solo Work,Vera,Stone,,Standalone,Fantasy,,,,,,,',
          'No Last,Milo,,,Standalone,Fantasy,,,,,,,',
          'No First,,Reyes,,Standalone,Fantasy,,,,,,,',
          'Comma Pair,"Ann, Bob",Smith,,Standalone,Fantasy,,,,,,,',
        ].join('\n'),
      ),
    ).map(normalizeRecord)

  it('counts rows naming more than one author', () => {
    // Their work_key concatenates every name, so two spellings of the same pair key differently.
    const co = coAuthorRows(rows()).map((r) => r.title)
    expect(co).toContain('The Strain')
    expect(co).toContain('Comma Pair')
    expect(co).not.toContain('Solo Work')
  })

  it('counts rows missing First OR Last — wider than the empty-author list', () => {
    // The existing report lists rows with NO author at all; these have half a name and still
    // degrade their key to `title|`.
    const partial = partialAuthorRows(rows()).map((r) => r.title)
    expect(partial).toEqual(expect.arrayContaining(['No Last', 'No First']))
    expect(partial).not.toContain('Solo Work')
  })

  it('a partial name keys on the HALF THAT IS PRESENT — not on `title|`', () => {
    // Worth pinning precisely, because the brief for this work described these rows as degrading
    // to `title|`. They do not: workKeyOf folds title|authorOf(rec), and authorOf
    // returns whichever half exists — so "Milo" with no last name keys as `nolast|milo`, which is
    // a DIFFERENT key from the same book carrying "Milo Reyes". Only a row with NO author at all
    // produces the trailing-pipe form, and that is the narrower emptyAuthor list the report
    // already prints. The divergence is real; its shape is just not the one assumed.
    const byTitle = (t: string) => rows().find((r) => r.title === t)!
    expect(byTitle('No Last').workKey).toBe('nolast|milo')
    expect(byTitle('No First').workKey).toBe('nofirst|reyes')
    expect(byTitle('No Last').workKey.endsWith('|')).toBe(false)
  })

  it('the Unicode-safe key keeps the established ASCII shape', () => {
    expect(rows().find((r) => r.title === 'Solo Work')!.workKey).toBe('solowork|verastone')
  })
})

describe('CSV escaping for the dump files', () => {
  // The dump's job is to be READ SIDE BY SIDE with another file. An unescaped comma shifts every
  // later column, so the file still opens and still looks plausible while pairing the wrong title
  // with the wrong author — exactly the failure a diagnostic must not have.
  it('quotes a value containing a comma', () => {
    expect(csvCell('Salt, Harbour')).toBe('"Salt, Harbour"')
  })

  it('doubles embedded quotes', () => {
    expect(csvCell('The "Real" Thing')).toBe('"The ""Real"" Thing"')
  })

  it('quotes a value containing a newline', () => {
    expect(csvCell('Two\nLines')).toBe('"Two\nLines"')
  })

  it('leaves an ordinary value alone — no gratuitous quoting', () => {
    expect(csvCell('Ash Crown')).toBe('Ash Crown')
  })

  it('renders null and undefined as empty rather than the strings "null"/"undefined"', () => {
    expect(csvCell(null)).toBe('')
    expect(csvCell(undefined)).toBe('')
  })

  it('builds a file with a header and a trailing newline', () => {
    expect(csvFile(['a', 'b'], [['1', 'x, y']])).toBe('a,b\n1,"x, y"\n')
  })
})
