import { describe, expect, it } from 'vitest'
import { admitSourceRecord as core } from './enrichAdmission'
import { admitSourceRecord as edge } from '../../../supabase/functions/enrich/admission'
import { mergeRecords, parsePubDate, normalizeHardcoverSearch } from './enrich'
import { backfillPatch } from '../../../scripts/corpus-backfill'

const isbn = '9780306406157'
const target = { title: 'A Quiet Library', author: 'Jane Smith', isbn }
const edition = {
  scope: 'edition',
  title: target.title,
  authors: [target.author],
  isbn13: isbn,
  pageCount: 256,
  pubY: 2020,
  pubM: 4,
  pubD: 12,
}
for (const [name, admit] of [
  ['core', core],
  ['edge', edge],
])
  describe(`${name} source admission`, () => {
    it('accepts equivalent selected ISBNs and preserves verified edition fields', () => {
      expect(admit(target, { ...edition, isbn10: '0306406152' })).toMatchObject({
        isbn13: isbn,
        pageCount: 256,
        pubY: 2020,
      })
    })
    it.each([
      { ...edition, authors: ['John Smith'] },
      { ...edition, isbn13: '9781649374042' },
      { ...edition, scope: undefined },
      { ...edition, title: 'A Quiet Library: Expanded Edition' },
      { ...edition, authors: [] },
      { ...edition, isbns: ['9781649374042'] },
    ])('rejects unmatched or unqualified metadata: %j', (record) =>
      expect(admit(target, record)).toBeNull(),
    )
    it('accepts only source-declared subtitles', () => {
      expect(
        admit(
          { ...target, title: 'A Quiet Library: Collected Essays' },
          { ...edition, subtitle: 'Collected Essays' },
        ),
      ).not.toBeNull()
      expect(admit(target, { ...edition, title: 'A Quiet Library: Collected Essays' })).toBeNull()
    })
    it.each([
      ['surname first', target, { ...edition, authors: ['Smith, Jane'] }],
      ['surname-first input', { ...target, author: 'Smith, Jane' }, edition],
      [
        'compound surname',
        { ...target, author: 'María de la Cruz' },
        { ...edition, authors: ['de la Cruz, María'] },
      ],
      ['ampersand', { ...target, title: 'Ink and Stars' }, { ...edition, title: 'Ink & Stars' }],
      ['novel description', target, { ...edition, title: 'A Quiet Library A Novel' }],
      [
        'genre description',
        target,
        { ...edition, title: 'A Quiet Library: An Epic Fantasy Romance' },
      ],
      [
        'hyphenated description',
        target,
        { ...edition, title: 'A Quiet Library: A Small-Town Mystery' },
      ],
      [
        'nonfiction description',
        target,
        { ...edition, title: 'A Quiet Library: A Personal Memoir' },
      ],
      ['description in input', { ...target, title: 'A Quiet Library (A Novel)' }, edition],
    ])('accepts %s only with the exact edition and full contributor', (_label, input, record) => {
      expect(admit(input, record)).toMatchObject({ isbn13: isbn, pageCount: 256 })
      expect(admit(input, { ...record, isbn13: '9781649374042' })).toBeNull()
      expect(admit(input, { ...record, isbns: ['not-an-isbn'] })).toBeNull()
      expect(admit(input, { ...record, isbns: ['9781649374042'] })).toBeNull()
      expect(admit(input, { ...record, authors: ['Another Person'] })).toBeNull()
      expect(admit({ ...input, isbn: '' }, record)).toBeNull()
      expect(admit({ ...input, isbn: undefined }, { ...record, scope: 'work' })).toBeNull()
    })
    it.each([
      'A Quiet Library Book One of the Lantern Series',
      'A Quiet Library: Volume II',
      'A Quiet Library: Expanded Edition',
      'A Quiet Library: A Revised Novel',
      'A Quiet Library: An Abridged Novel',
      'A Quiet Library: An Illustrated Novel',
      'A Quiet Library: A Graphic Novel',
      'A Quiet Library: A Large Print Novel',
      'A Quiet Library: A Collector’s Novel',
      'A Quiet Library: A Special Anniversary Novel',
      'A Quiet Library: A Translated Novel',
      'A Quiet Library: A Retelling Novel',
      'A Quiet Library: A Companion Novel',
      'A Quiet Library: A Sequel Novel',
      'A Quiet Library: A Novel and a Novella',
      'A Quiet Library: A 2026 Novel',
      'A Quiet Library: Collected Essays',
      'A Quiet Library Returns',
      'A Quiet Library: A Tale of Another Library',
      'A Quiet Librarian: A Novel',
    ])('preserves meaningful title qualifiers: %s', (title) => {
      expect(admit(target, { ...edition, title })).toBeNull()
    })
    it.each([
      ['Jane A. Smith', 'Jane Smith'],
      ['Jane Smith', 'J. Smith'],
      ['Jane A. Smith', 'Smith, Jane B.'],
      ['Jane Smith', 'Smith'],
      ['Jane Smith', 'Jane Smith, John Jones'],
      ['Jane Smith', 'Smith, Jane, Jr.'],
      ['Jr Jane Smith', 'Jane Smith, Jr.'],
    ])('keeps ambiguous names under review: %s / %s', (author, actual) => {
      expect(admit({ ...target, author }, { ...edition, authors: [actual] })).toBeNull()
    })
    it('does not strip a description without full-author confirmation', () => {
      expect(
        admit({ ...target, author: '' }, { ...edition, title: 'A Quiet Library: A Novel' }),
      ).toBeNull()
    })
    it('keeps work fields without promoting pages, dates, ISBN arrays or search series labels', () => {
      expect(
        admit(target, {
          ...edition,
          scope: 'work',
          isbns: [isbn],
          series: 'Quiet Series',
          ids: { work: '123', edition: '456' },
          description: 'A useful description',
        }),
      ).toEqual({
        scope: 'work',
        title: target.title,
        subtitle: undefined,
        authors: [target.author],
        categories: undefined,
        description: 'A useful description',
        cover: undefined,
        ids: { work: '123' },
      })
    })
    it('keeps Unicode contributor identity and searches the entire author list', () => {
      expect(
        admit(
          { ...target, author: '张爱玲' },
          { ...edition, authors: ['Other Contributor', '张爱玲'] },
        ),
      ).not.toBeNull()
      expect(admit({ ...target, author: '张爱玲' }, { ...edition, authors: ['李白'] })).toBeNull()
    })
  })

describe('whole publication dates', () => {
  it.each(['2031-02-31', '2023-02-29', '2020-13', '2020-04-31', '2020-01-01junk'])(
    'rejects impossible or malformed dates %s',
    (value) => expect(parsePubDate(value)).toEqual({ pubY: null, pubM: null, pubD: null }),
  )
  it('keeps year precision and never invents January 1', () => {
    expect(normalizeHardcoverSearch({ title: 'Title', release_year: 2025 })).toMatchObject({
      pubY: 2025,
      pubM: null,
      pubD: null,
    })
    expect(parsePubDate('September 2010')).toEqual({ pubY: 2010, pubM: 9, pubD: null })
  })
  it('never combines one source year with another source month and day', () => {
    expect(
      mergeRecords([
        { source: 'openlibrary', at: '2026-01-01', record: { pubY: 1990 } },
        { source: 'hardcover', at: '2026-01-01', record: { pubY: 2031, pubM: 6, pubD: 15 } },
      ]),
    ).toMatchObject({ pubY: 1990, pubM: null, pubD: null })
  })
})

describe('maintenance cache admission', () => {
  const work = {
    work_key: 'aquietlibrary|janesmith',
    work_id: null,
    cover_url: null,
    isbns: [isbn],
  }
  const hit = {
    key: 'identity-admitted-v3:ta:aquietlibrary|janesmith',
    work_id: 'openlibrary:OL1W',
    confidence: 'high',
    complete: false,
    fetched_at: new Date().toISOString(),
    record: {
      admissionVersion: 2,
      admissionIdentity: target,
      title: target.title,
      authors: [target.author],
      workId: 'openlibrary:OL1W',
      cover: 'https://covers.openlibrary.org/b/id/1-L.jpg',
      provenance: { cover: { source: 'openlibrary' } },
      isbns: ['9781649374042'],
    },
  }
  it('fills verified work identity and cover without changing edition ISBNs', () =>
    expect(backfillPatch(work, hit)).toEqual({
      work_id: 'openlibrary:OL1W',
      cover_url: hit.record.cover,
      cover_source: 'openlibrary',
    }))
  it.each([
    { ...hit, confidence: 'none' },
    { ...hit, fetched_at: '2020-01-01' },
    { ...hit, record: { ...hit.record, admissionVersion: undefined } },
    { ...hit, record: { ...hit.record, title: 'Wrong Book' } },
    { ...hit, record: { ...hit.record, authors: ['John Smith'] } },
    { ...hit, record: { ...hit.record, admissionIdentity: { title: 5, author: 'Jane Smith' } } },
  ])('cannot promote stale, mismatched, malformed or unverified cached metadata', (candidate) =>
    expect(backfillPatch(work, candidate)).toEqual({}),
  )
})

it('does not attach a provider month/day to a different reader year', () => {
  expect(
    mergeRecords(
      [{ source: 'openlibrary', at: '2026-01-01', record: { pubY: 2031, pubM: 6, pubD: 15 } }],
      { pubY: 1990 },
    ),
  ).toMatchObject({ pubY: 1990, pubM: null, pubD: null })
})
