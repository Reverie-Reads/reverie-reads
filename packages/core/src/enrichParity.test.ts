import { describe, expect, it } from 'vitest'
import {
  mapGenre as coreMapGenre,
  mergeRecords as coreMerge,
  normalizeGoogle as coreNG,
  normalizeHardcover as coreNH,
  normalizeHardcoverSearch as coreNHS,
  normalizeOpenLibrary as coreNOL,
  withholdByConfidence as coreWithhold,
  type StampedSource,
} from './enrich'
// Same file the Deno enrich function imports (it uses './merge.ts'; Vitest/tsc resolve the
// extensionless path). If the hand-mirrored copy drifts from core, this test fails.
import {
  mapGenre as fnMapGenre,
  mergeRecords as fnMerge,
  normalizeGoogle as fnNG,
  normalizeHardcover as fnNH,
  normalizeHardcoverSearch as fnNHS,
  normalizeOpenLibrary as fnNOL,
  withholdByConfidence as fnWithhold,
} from '../../../supabase/functions/enrich/merge'
import {
  matchKey as coreMatchKey,
  scoreCandidate as coreScore,
  selectBestMatch as coreSelect,
  selfIsbn13 as coreSelfIsbn,
  type ResolveCandidate,
} from './enrichResolve'
import {
  matchKey as fnMatchKey,
  scoreCandidate as fnScore,
  selectBestMatch as fnSelect,
  selfIsbn13 as fnSelfIsbn,
} from '../../../supabase/functions/enrich/resolve'

// Active source fixtures + edge cases (coded subjects, html, isbn-10).
const GOOGLE = {
  id: 'v1',
  volumeInfo: {
    title: 'Twisted Love',
    authors: ['Ana Huang'],
    publisher: 'Bloom',
    publishedDate: '2021-06-08',
    pageCount: 348,
    categories: ['Fiction / Romance / Contemporary'],
    description: '<p>Enemies <b>to</b> lovers.</p>',
    imageLinks: {
      thumbnail: 'http://g/c.jpg&edge=curl',
      large: 'http://g/c-large.jpg&edge=curl',
    },
    industryIdentifiers: [
      { type: 'ISBN_13', identifier: '9781735056258' },
      { type: 'ISBN_10', identifier: '1735056251' },
    ],
    language: 'en',
  },
}
const OL = {
  key: '/works/OL1W',
  edition_key: ['OL2M'],
  title: 'A Court of Thorns and Roses',
  author_name: ['Sarah J. Maas'],
  first_publish_year: 2015,
  number_of_pages_median: 419,
  isbn: ['9781619634442', '1619634449'],
  subject: ['Fantasy', 'series:a_court', 'nyt:x=1'],
  language: ['eng'],
  cover_i: 8231856,
}
const HC = {
  id: 9988,
  title: 'Fourth Wing',
  pages: 517,
  release_date: '2023-05-02',
  description: 'Dragons.',
  image: { url: 'https://hc/fw.jpg' },
  book_series: [{ position: 1, series: { name: 'The Empyrean' } }],
  taggings: [{ tag: { tag: 'Dragon Riders' } }],
}
const ISBNDB = {
  // Synthetic already-normalized historical stamp, not a provider response or live acquisition.
  pageCount: 532,
  binding: 'Paperback',
  description: 'Synthetic legacy record',
}

describe('enrich mirror ↔ core parity (golden fixtures)', () => {
  it('normalizers produce identical SourceRecords', () => {
    expect(fnNG(GOOGLE)).toEqual(coreNG(GOOGLE))
    expect(fnNOL(OL)).toEqual(coreNOL(OL))
    expect(fnNH(HC)).toEqual(coreNH(HC))
    const HCS = {
      id: 714600,
      title: 'Fourth Wing',
      author_names: ['Rebecca Yarros'],
      image: { url: 'https://assets.hardcover.app/x.jpeg' },
      isbns: ['1637991029', '9781637991022'],
      release_date: '2023-05-02',
      series_names: ['The Empyrean'],
      featured_series_position: 1,
      genres: ['Fantasy', 'Romance'],
      moods: ['adventurous'],
      pages: 517,
      description: '<p>Dragons.</p>',
    }
    expect(fnNHS(HCS)).toEqual(coreNHS(HCS))
  })

  it('mapGenre is identical', () => {
    const batteries = [
      ['Romance', 'Fantasy'],
      ['Space Opera'],
      ['Cooking'],
      ['Dark Romance', 'Horror'],
      ['Cozy Mysteries'],
      ['Thriller', 'Suspense'],
      ['Historical'],
      ['Juvenile Fiction'],
    ]
    for (const cats of batteries) {
      expect(fnMapGenre(cats)).toEqual(coreMapGenre(cats))
    }
  })

  it('full multi-source merge is identical (precedence + union + provenance)', () => {
    const at = '2026-01-01T00:00:00.000Z'
    const stamped: StampedSource[] = [
      { source: 'google', at, record: coreNG(GOOGLE) },
      { source: 'openlibrary', at, record: coreNOL(OL) },
      { source: 'hardcover', at, record: coreNH(HC) },
      { source: 'isbndb', at, record: ISBNDB },
    ]
    expect(fnMerge(stamped)).toEqual(coreMerge(stamped))
    // with a user override too
    const user = { title: 'My Title', at }
    expect(fnMerge(stamped, user)).toEqual(coreMerge(stamped, user))
  })

  it('withholdByConfidence is identical across all four tiers', () => {
    const record = fnMerge([
      { source: 'google', at: '2026-01-01T00:00:00.000Z', record: coreNG(GOOGLE) },
      { source: 'openlibrary', at: '2026-01-01T00:00:00.000Z', record: coreNOL(OL) },
    ])
    for (const confidence of ['high', 'medium', 'low', 'none'] as const) {
      expect(fnWithhold(record, confidence)).toEqual(coreWithhold(record, confidence))
    }
  })
})

describe('resolve mirror ↔ core parity (E1)', () => {
  it('matchKey + selfIsbn13 are identical', () => {
    for (const s of [
      'Céline',
      'King of Wrath: A Novel',
      '  Twisted  Love ',
      'A Court of Thorns & Roses',
    ]) {
      expect(fnMatchKey(s)).toBe(coreMatchKey(s))
    }
    for (const r of [
      { isbn10: '1735056251' },
      { isbn13: '978-1-7350-5625-8' },
      { isbns: ['1735056251'] },
      {},
    ]) {
      expect(fnSelfIsbn(r)).toBe(coreSelfIsbn(r))
    }
  })

  it('scoreCandidate + selectBestMatch are identical', () => {
    const q = { title: 'King of Wrath', author: 'Ana Huang' }
    const cands: ResolveCandidate[] = [
      {
        source: 'hardcover',
        record: {
          title: 'King of Wrath',
          authors: ['Ana Huang'],
          isbn13: '9780000000001',
          cover: 'a.jpg',
        },
      },
      {
        source: 'google',
        record: {
          title: 'King of Wrath: A Novel',
          authors: ['Ana Huang'],
          isbn13: '9780000000002',
          cover: 'b.jpg',
        },
      },
      {
        source: 'openlibrary',
        record: { title: 'King of Wrath', authors: ['Someone Else'], isbn13: '9780000000003' },
      },
    ]
    for (const c of cands) expect(fnScore(q, c)).toEqual(coreScore(q, c))
    expect(fnSelect(q, cands)).toEqual(coreSelect(q, cands))
    // ambiguous (no author) path too
    const amb: ResolveCandidate[] = [
      {
        source: 'google',
        record: { title: 'Twisted', authors: ['Ana Huang'], isbn13: '9780000000001' },
      },
      {
        source: 'openlibrary',
        record: { title: 'Twisted', authors: ['Lisa Jackson'], isbn13: '9780000000002' },
      },
    ]
    expect(fnSelect({ title: 'Twisted' }, amb)).toEqual(coreSelect({ title: 'Twisted' }, amb))
  })
})
