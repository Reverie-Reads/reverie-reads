import { describe, expect, it } from 'vitest'
import {
  mapGenre,
  mergeRecords,
  normalizeGoogle,
  normalizeHardcover,
  normalizeHardcoverSearch,
  normalizeOpenLibrary,
  withholdByConfidence,
  type StampedSource,
} from './enrich'
import { CORE_GENRES } from './genreNormalize'

const at = (n: number) => new Date(Date.UTC(2026, 0, n)).toISOString()
const src = (
  source: StampedSource['source'],
  record: StampedSource['record'],
  day = 1,
): StampedSource => ({
  source,
  at: at(day),
  record,
})

describe('mergeRecords — field precedence', () => {
  it('picks the highest-precedence source per field, not first-wins-wholesale', () => {
    // ISBNdb wins pageCount/publisher; OpenLibrary/Hardcover win title/series; Google supplies cover.
    const merged = mergeRecords([
      src('google', { title: 'G title', cover: 'g.jpg', pageCount: 100, publisher: 'G Pub' }),
      src('openlibrary', { title: 'OL title', series: 'OL Series' }),
      src('isbndb', { pageCount: 352, publisher: 'Real Publisher', binding: 'Hardcover' }),
      src('hardcover', { series: 'HC Series', seriesPosition: 2 }),
    ])
    expect(merged.title).toBe('OL title') // openlibrary precedes google for title
    expect(merged.series).toBe('HC Series') // hardcover precedes openlibrary for series
    expect(merged.seriesPosition).toBe(2)
    expect(merged.pageCount).toBe(352) // isbndb precedes google
    expect(merged.publisher).toBe('Real Publisher')
    expect(merged.binding).toBe('Hardcover')
    expect(merged.cover).toBe('g.jpg') // only google had a cover
    expect(merged.provenance.pageCount).toEqual({ source: 'isbndb', at: at(1) })
    expect(merged.provenance.series).toEqual({ source: 'hardcover', at: at(1) })
  })

  it('falls through precedence when the preferred source lacks the field', () => {
    const merged = mergeRecords([src('google', { pageCount: 222 })])
    expect(merged.pageCount).toBe(222) // isbndb/openlibrary absent → google supplies it
    expect(merged.provenance.pageCount?.source).toBe('google')
  })
})

describe('mergeRecords — union + longest description', () => {
  it('unions categories and ISBNs (deduped) and keeps the longest description', () => {
    const merged = mergeRecords([
      src('google', {
        categories: ['Romance', 'Fiction'],
        description: 'Short.',
        isbn13: '9781111111111',
      }),
      src('openlibrary', { categories: ['Romance', 'Contemporary'], isbns: ['1111111111'] }),
      src('isbndb', { description: 'A much longer and more complete synopsis of the book.' }),
    ])
    expect(merged.categories.sort()).toEqual(['Contemporary', 'Fiction', 'Romance'])
    expect(merged.description).toBe('A much longer and more complete synopsis of the book.')
    expect(merged.provenance.description?.source).toBe('isbndb')
    expect(merged.isbns).toContain('9781111111111')
    expect(merged.isbns).toContain('1111111111')
  })

  it('unions authors preserving first-seen order, case-insensitively deduped', () => {
    const merged = mergeRecords([
      src('openlibrary', { authors: ['Ana Huang', 'Some Translator'] }),
      src('google', { authors: ['ana huang', 'Second Author'] }),
    ])
    expect(merged.authors).toEqual(['Ana Huang', 'Some Translator', 'Second Author'])
    expect(merged.author).toBe('Ana Huang, Some Translator, Second Author')
  })
})

describe('mergeRecords — ISBN normalization + identity', () => {
  it('derives canonical isbn13 from a 10 and resolves work/edition ids', () => {
    const merged = mergeRecords([
      src('openlibrary', { isbn10: '0306406152', ids: { work: 'OL1W', edition: 'OL2M' } }),
      src('hardcover', { ids: { work: '4242' } }),
    ])
    expect(merged.isbn13).toBe('9780306406157') // computed from the 10
    expect(merged.isbn).toBe('9780306406157')
    expect(merged.workId).toBe('openlibrary:OL1W')
    expect(merged.editionId).toBe('openlibrary:OL2M')
    expect(merged.ids.hardcover).toBe('work:4242')
  })
})

describe('mergeRecords — user-authored fields always win', () => {
  it('never overwrites a user value, and fills only where the user left blanks', () => {
    const merged = mergeRecords(
      [src('isbndb', { title: 'API Title', publisher: 'API Pub', pageCount: 300 })],
      { title: 'My Edited Title', at: at(9) },
    )
    expect(merged.title).toBe('My Edited Title')
    expect(merged.provenance.title).toEqual({ source: 'manual', at: at(9) })
    expect(merged.publisher).toBe('API Pub') // user left blank → API fills
    expect(merged.pageCount).toBe(300)
  })

  it('an empty user value does not clobber a real source value', () => {
    const merged = mergeRecords([src('google', { title: 'Good Title' })], { title: '   ' })
    expect(merged.title).toBe('Good Title')
  })
})

describe('withholdByConfidence', () => {
  const record = mergeRecords([
    src('google', { series: 'Fourth Wing', seriesPosition: 1, cover: 'g.jpg' }),
  ])

  it('none strips cover, series, and seriesPosition — no confident match, no attach', () => {
    const out = withholdByConfidence(record, 'none')
    expect(out.cover).toBe('')
    expect(out.series).toBe('')
    expect(out.seriesPosition).toBeNull()
  })

  it('low strips series and seriesPosition but NOT cover — cover has downstream safety nets, series has none', () => {
    const out = withholdByConfidence(record, 'low')
    expect(out.cover).toBe('g.jpg')
    expect(out.series).toBe('')
    expect(out.seriesPosition).toBeNull()
  })

  it('medium passes cover, series, and seriesPosition through unchanged', () => {
    expect(withholdByConfidence(record, 'medium')).toEqual(record)
  })

  it('high passes cover, series, and seriesPosition through unchanged', () => {
    expect(withholdByConfidence(record, 'high')).toEqual(record)
  })
})

describe('mapGenre', () => {
  it('maps categories to a primary genre + recognized labels, romance taking priority', () => {
    expect(mapGenre(['Fiction', 'Romance', 'Fantasy'])).toEqual({
      genre: 'romance',
      genres: ['Romance', 'Fantasy'],
    })
    expect(mapGenre(['Space Opera', 'Dystopian']).genre).toBe('science fiction')
    expect(mapGenre(['Cooking', 'Reference'])).toEqual({ genre: '', genres: [] })
  })

  it('genres without a room of their own file under their core genre, keeping their label', () => {
    expect(mapGenre(['Thriller'])).toEqual({ genre: 'mystery', genres: ['Thriller'] })
    expect(mapGenre(['Thrillers & Suspense', 'Mystery & Detective'])).toEqual({
      genre: 'mystery',
      genres: ['Thriller', 'Mystery'],
    })
    expect(mapGenre(['Historical'])).toEqual({ genre: 'literary', genres: ['Historical'] })
  })

  it('cozy is recognized ahead of its host genre (Cozy Mysteries → the cozy room)', () => {
    expect(mapGenre(['Cozy Mysteries'])).toEqual({ genre: 'cozy', genres: ['Cozy', 'Mystery'] })
    expect(mapGenre(['Cosy Fantasy']).genre).toBe('cozy')
  })

  it('every primary token is a canonical app genre (lowercased CORE_GENRES key)', () => {
    const keys = new Set<string>(CORE_GENRES.map((g) => g.toLowerCase()))
    const samples = [
      ['Romance'],
      ['Cozy Mysteries'],
      ['Fantasy'],
      ['Sci-Fi'],
      ['Horror'],
      ['Thriller'],
      ['Mysteries & Detective Stories'],
      ['Historical'],
      ['Juvenile Fiction'],
      ['Literary'],
      ['Memoir'],
      ['Space Opera'],
      ['Young Adult Fiction'],
    ]
    for (const cats of samples) {
      const { genre } = mapGenre(cats)
      expect(keys.has(genre), `${cats.join('/')} → '${genre}'`).toBe(true)
    }
  })
})

describe('source normalizers (captured fixtures)', () => {
  it('normalizeGoogle parses a volume', () => {
    const r = normalizeGoogle({
      id: 'vol123',
      volumeInfo: {
        title: 'Twisted Love',
        authors: ['Ana Huang'],
        publisher: 'Bloom Books',
        publishedDate: '2021-06-08',
        pageCount: 348,
        categories: ['Fiction / Romance / Contemporary'],
        description: '<p>An <b>enemies</b> to lovers story.</p>',
        imageLinks: {
          thumbnail: 'http://books.google.com/cover.jpg&edge=curl',
          large: 'http://books.google.com/large.jpg&edge=curl',
        },
        industryIdentifiers: [
          { type: 'ISBN_13', identifier: '9781735056258' },
          { type: 'ISBN_10', identifier: '1735056251' },
        ],
        language: 'en',
      },
    })
    expect(r.title).toBe('Twisted Love')
    expect(r.authors).toEqual(['Ana Huang'])
    expect(r.pubY).toBe(2021)
    expect(r.pubM).toBe(6)
    expect(r.isbn13).toBe('9781735056258')
    expect(r.categories).toEqual(['Romance', 'Contemporary']) // split on '/', drops bare "Fiction"
    expect(r.description).toBe('An enemies to lovers story.') // html stripped
    expect(r.cover).toBe('https://books.google.com/large.jpg') // strongest returned tier, cleaned
    expect(r.ids).toEqual({ volume: 'vol123' })
  })

  it('normalizeOpenLibrary parses a search doc + extracts a coded series subject', () => {
    const r = normalizeOpenLibrary({
      key: '/works/OL123W',
      edition_key: ['OL456M'],
      title: 'A Court of Thorns and Roses',
      author_name: ['Sarah J. Maas'],
      first_publish_year: 2015,
      number_of_pages_median: 419,
      isbn: ['9781619634442', '1619634449'],
      subject: ['Fantasy', 'series:a_court_of_thorns_and_roses', 'nyt:trade_fiction=1'],
      language: ['eng'],
      cover_i: 8231856,
    })
    expect(r.title).toBe('A Court of Thorns and Roses')
    expect(r.series).toBe('a court of thorns and roses') // coded subject decoded
    expect(r.categories).toEqual(['Fantasy']) // coded subjects dropped
    expect(r.isbn13).toBe('9781619634442')
    expect(r.cover).toBe('https://covers.openlibrary.org/b/id/8231856-M.jpg')
    expect(r.ids).toEqual({ work: 'OL123W', edition: 'OL456M' })
  })

  it('normalizeHardcover parses a book with series + community tags', () => {
    const r = normalizeHardcover({
      id: 9988,
      title: 'Fourth Wing',
      pages: 517,
      release_date: '2023-05-02',
      description: 'War college. Dragons.',
      image: { url: 'https://hc.app/fw.jpg' },
      book_series: [{ position: 1, series: { name: 'The Empyrean' } }],
      taggings: [{ tag: { tag: 'Dragon Riders' } }, { tag: { tag: 'Enemies to Lovers' } }],
    })
    expect(r.series).toBe('The Empyrean')
    expect(r.seriesPosition).toBe(1)
    expect(r.categories).toEqual(['Dragon Riders', 'Enemies to Lovers'])
    expect(r.ids).toEqual({ work: '9988' })
  })

  it('normalizeHardcoverSearch parses the search-result (Typesense) doc shape', () => {
    const r = normalizeHardcoverSearch({
      id: 714600,
      title: 'Fourth Wing',
      author_names: ['Rebecca Yarros'],
      image: { url: 'https://assets.hardcover.app/x.jpeg' },
      isbns: ['1637991029', '9781637991022', 'bad'],
      release_date: '2023-05-02',
      series_names: ['The Empyrean'],
      featured_series_position: 1,
      genres: ['Fantasy', 'Romance'],
      moods: ['adventurous'],
      pages: 517,
      description: '<p>Dragons.</p>',
    })
    expect(r.title).toBe('Fourth Wing')
    expect(r.authors).toEqual(['Rebecca Yarros'])
    expect(r.cover).toBe('https://assets.hardcover.app/x.jpeg') // image.url → the romance/indie cover
    expect(r.series).toBe('The Empyrean')
    expect(r.seriesPosition).toBe(1)
    expect(r.isbn13).toBe('9781637991022')
    expect(r.isbn10).toBe('1637991029')
    expect(r.categories).toEqual(['Fantasy', 'Romance', 'adventurous']) // genres+moods+tags union
    expect(r.pageCount).toBe(517)
    expect({ y: r.pubY, m: r.pubM, d: r.pubD }).toEqual({ y: 2023, m: 5, d: 2 })
    expect(r.description).toBe('Dragons.')
    expect(r.ids).toEqual({ work: '714600' })
  })

  it('retains legacy stamped-record merge compatibility without a live ISBNdb normalizer', () => {
    const merged = mergeRecords([
      src('google', {
        ...normalizeGoogle({
          volumeInfo: {
            title: 'T',
            categories: ['Fiction / Romance'],
            imageLinks: { thumbnail: 'http://c/g.jpg' },
            description: 'short',
          },
        }),
      }),
      src('openlibrary', {
        ...normalizeOpenLibrary({ title: 'T', subject: ['Romance'], first_publish_year: 2020 }),
      }),
      src('isbndb', {
        pageCount: 400,
        binding: 'Hardcover',
        description: 'a longer synthetic legacy synopsis',
      }),
    ])
    expect(merged.genre).toBe('romance')
    expect(merged.cover).toBe('https://c/g.jpg')
    expect(merged.pageCount).toBe(400)
    expect(merged.binding).toBe('Hardcover')
    expect(merged.description).toBe('a longer synthetic legacy synopsis')
    expect(merged.pubY).toBe(2020)
  })
})
