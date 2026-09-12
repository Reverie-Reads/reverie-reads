import { describe, expect, it } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import { workKeyOf, type Contributor } from '@reverie/core'
import type { SearchResult } from './search'
import type { WorkRow } from '../data/works'
import { resultIsbn, resultWorkKey, triageLabel, triageResults, workRowKeys } from './addTriage'

const result = (r: Partial<SearchResult>): SearchResult => ({
  source: 'hardcover',
  title: '',
  authors: [],
  cover: '',
  isbn: '',
  year: '',
  ...r,
})

const contribs = (name: string): Contributor[] =>
  name ? [{ name, role: 'author', position: 0 }] : []

/** A works row. `author` is a convenience that expands to `contributors` + the default
 *  `work_key`; every other field is a plain override, so the spread comes LAST and `title` is
 *  supplied by it rather than restated (restating it before the spread is a TS2783 — the exact
 *  shape Vitest runs happily on and `tsc` refuses). */
const work = ({
  author = '',
  ...over
}: Partial<WorkRow> & { title: string; author?: string }): WorkRow => ({
  id: 'work-1',
  work_key: workKeyOf({ title: over.title, last: author }),
  contributors: contribs(author),
  isbns: [],
  series: null,
  position: null,
  cover_url: null,
  genre: null,
  tags: [],
  pub_y: null,
  pub_m: null,
  pub_d: null,
  ...over,
})

const state = (
  results: SearchResult[],
  library: Parameters<typeof triageResults>[1],
  corpus: WorkRow[] | null,
) => triageResults(results, library, corpus).map((t) => t.state)

describe('triageResults', () => {
  const library = [
    makeBook({
      id: 'lib1',
      title: 'Fourth Wing',
      first: 'Rebecca',
      last: 'Yarros',
      isbn: '9781649374042',
    }),
    makeBook({ id: 'lib2', title: 'It Ends with Us', first: 'Colleen', last: 'Hoover' }),
  ]

  it('exact ISBN match against the library → library', () => {
    const t = triageResults(
      [
        result({
          source: 'google',
          title: 'Fourth Wing',
          authors: ['Rebecca Yarros'],
          isbn13: '9781649374042',
        }),
      ],
      library,
      [],
    )
    expect(t[0]?.state).toBe('library')
    expect(t[0]?.book?.id).toBe('lib1')
  })

  it('title + author match against the library → library', () => {
    const t = triageResults(
      [result({ title: 'It Ends with Us', authors: ['Colleen Hoover'] })],
      library,
      [],
    )
    expect(t[0]?.state).toBe('library')
    expect(t[0]?.book?.id).toBe('lib2')
  })

  /**
   * THE ONE A REVIEWER WOULD NOT THINK TO ASK FOR.
   *
   * `resultToIncoming` splits the author on whitespace and takes everything after the first word,
   * so a single-word author ('Homer') and a result with no author at all BOTH yield `last: ''` and
   * key as `` `title|` `` — which matchBook's title-author leg happily matches against any library
   * book that also has no last name. Without the guard this returns 'library' for a book the reader
   * does not own, and the add control disappears.
   */
  it('an empty last name must NOT title-author match an authorless library book', () => {
    const authorless = [makeBook({ id: 'lib3', title: 'The Odyssey', first: '', last: '' })]
    // single-word author → resultToIncoming leaves `last` empty
    expect(state([result({ title: 'The Odyssey', authors: ['Homer'] })], authorless, [])).toEqual([
      'new',
    ])
    // no author at all → same degenerate key, same answer
    expect(state([result({ title: 'The Odyssey', authors: [] })], authorless, [])).toEqual(['new'])
  })

  it('contradictory ISBN identity and series slots do not hide Add', () => {
    const authorless = [
      makeBook({ id: 'isbnOnly', title: 'Whatever They Called It', isbn: '9780306406157' }),
      makeBook({
        id: 'ser',
        title: 'Book Two',
        first: 'Ada',
        last: 'Vance',
        series: 'The Cycle',
        position: 2,
      }),
    ]
    // ISBN still matches with no last name in sight
    expect(
      triageResults(
        [result({ title: 'The Odyssey', authors: ['Homer'], isbn: '9780306406157' })],
        authorless,
        [],
      )[0]?.book?.id,
    ).toBeUndefined()
    // title + series + position still matches with no last name in sight
    expect(
      triageResults(
        [result({ title: 'Book Two', authors: ['Homer'], series: 'The Cycle', seriesPosition: 2 })],
        authorless,
        [],
      )[0]?.book?.id,
    ).toBeUndefined()
  })

  it('a real last name still title-author matches — the guard is not a blanket refusal', () => {
    expect(
      state([result({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] })], library, []),
    ).toEqual(['library'])
  })

  it('corpus-only → corpus, and carries the row for the prefill', () => {
    const rows = [
      work({
        title: 'Iron Flame',
        author: 'Rebecca Yarros',
        series: 'The Empyrean',
        position: 2,
        genre: 'fantasy',
      }),
    ]
    const t = triageResults(
      [result({ title: 'Iron Flame', authors: ['Rebecca Yarros'] })],
      library,
      rows,
    )
    expect(t[0]?.state).toBe('corpus')
    expect(t[0]?.work?.series).toBe('The Empyrean')
    expect(t[0]?.book).toBeNull()
  })

  it('a contradictory ISBN result cannot substitute shared title and contributors', () => {
    const rows = [
      work({
        title: 'The Canonical Title',
        author: 'Vera Stone',
        isbns: ['9780306406157'],
      }),
    ]
    const t = triageResults(
      [
        result({
          source: 'google',
          title: 'Publisher Alternate Title',
          authors: ['V. Stone'],
          isbn10: '0-306-40615-2',
        }),
      ],
      [],
      rows,
    )
    expect(t[0]?.state).toBe('new')
    expect(t[0]?.work).toBeNull()
  })

  it('a cross-work ISBN collision is ambiguous, never silently first-row-wins', () => {
    const rows = [
      work({ title: 'First Work', author: 'One Author', isbns: ['9780306406157'] }),
      work({ title: 'Second Work', author: 'Two Author', isbns: ['9780306406157'] }),
    ]
    const t = triageResults(
      [
        result({
          title: 'Publisher Alternate',
          authors: ['Nobody Matching'],
          isbn13: '9780306406157',
        }),
      ],
      [],
      rows,
    )
    expect(t[0]?.state).toBe('new')
    expect(t[0]?.work).toBeNull()
  })

  it('does not fall back to an exact title when the result ISBN is ambiguous', () => {
    const rows = [
      work({ title: 'Exact Title', author: 'Exact Author', isbns: ['9780306406157'] }),
      work({ title: 'Different Title', author: 'Other Author', isbns: ['9780306406157'] }),
    ]
    const t = triageResults(
      [
        result({
          source: 'google',
          title: 'Exact Title',
          authors: ['Exact Author'],
          isbn13: '9780306406157',
        }),
      ],
      [],
      rows,
    )
    expect(t[0]?.state).toBe('new')
    expect(t[0]?.work).toBeNull()
  })

  it('preserves non-Latin title and author identity instead of collapsing every work to |', () => {
    const rows = [
      work({ title: '三体', author: '刘慈欣', work_key: 'legacy:external-three-body' }),
      work({ title: '活着', author: '余华', work_key: 'legacy:external-to-live' }),
    ]

    const t = triageResults([result({ title: '三体', authors: ['刘慈欣'] })], [], rows)
    expect(resultWorkKey(t[0]!.result)).toBe('三体|刘慈欣')
    expect(t[0]?.state).toBe('corpus')
    expect(t[0]?.work).toBe(rows[0])
  })

  it('routes an ambiguous derived fallback to reconciliation instead of taking the first row', () => {
    const rows = [
      work({ title: '三体', author: '刘慈欣', work_key: 'external:first' }),
      work({ title: '三体', author: '刘慈欣', work_key: 'external:second' }),
    ]

    const t = triageResults([result({ title: '三体', authors: ['刘慈欣'] })], [], rows)
    expect(t[0]?.state).toBe('new')
    expect(t[0]?.work).toBeNull()
  })

  it('library AND corpus → library leads, the corpus row rides along', () => {
    const rows = [work({ title: 'Fourth Wing', author: 'Rebecca Yarros' })]
    const t = triageResults(
      [result({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] })],
      library,
      rows,
    )
    expect(t[0]?.state).toBe('library')
    expect(t[0]?.book?.id).toBe('lib1')
    expect(t[0]?.work).not.toBeNull()
    expect(triageLabel(t[0]!)).toBe('In your library · also in the corpus')
  })

  it('neither → new', () => {
    expect(
      state([result({ title: 'Brand New', authors: ['Nobody At All'] })], library, []),
    ).toEqual(['new'])
  })

  it('a corpus row with no author never collides with an authorless result', () => {
    // Both sides degenerate to `title|` if either key is built carelessly.
    const rows = [work({ title: 'Anonymous Work', author: '' })]
    expect(state([result({ title: 'Anonymous Work', authors: [] })], [], rows)).toEqual(['new'])
  })

  it('a null corpus (query still in flight) labels on the library alone, without throwing', () => {
    expect(
      state(
        [
          result({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] }),
          result({ title: 'Iron Flame', authors: ['Rebecca Yarros'] }),
        ],
        library,
        null,
      ),
    ).toEqual(['library', 'new'])
  })

  it('labels every result, in order, one state each', () => {
    const rows = [work({ title: 'Iron Flame', author: 'Rebecca Yarros' })]
    expect(
      state(
        [
          result({ title: 'Fourth Wing', authors: ['Rebecca Yarros'] }),
          result({ title: 'Iron Flame', authors: ['Rebecca Yarros'] }),
          result({ title: 'Onyx Storm', authors: ['Rebecca Yarros'] }),
        ],
        library,
        rows,
      ),
    ).toEqual(['library', 'corpus', 'new'])
  })
})

describe('the corpus identity is the importer’s, not the library matcher’s', () => {
  it('canonicalizes whichever catalog ISBN field is available', () => {
    expect(resultIsbn(result({ source: 'google', isbn10: '0-306-40615-2' }))).toBe('9780306406157')
    expect(resultIsbn(result({ isbn: 'not-an-isbn' }))).toBe('')
    expect(resultIsbn(result({ source: 'google', isbn13: 'bad', isbn10: '0-306-40615-2' }))).toBe(
      '',
    )
  })

  it('keys on the FULL author name — works.work_key’s shape', () => {
    expect(resultWorkKey(result({ title: 'Iron Flame', authors: ['Rebecca Yarros'] }))).toBe(
      'ironflame|rebeccayarros',
    )
  })

  it('is empty — never `title|` — when the result has no author', () => {
    expect(resultWorkKey(result({ title: 'Iron Flame', authors: [] }))).toBe('')
    expect(resultWorkKey(result({ title: '', authors: ['Rebecca Yarros'] }))).toBe('')
  })

  it('normalizes punctuation and case the way the importer does', () => {
    expect(
      resultWorkKey(result({ title: 'A Court of Thorns & Roses', authors: ['Sarah J. Maas'] })),
    ).toBe('acourtofthornsroses|sarahjmaas')
  })

  it('a row is matchable by its DERIVED key and by its stored one', () => {
    // stored key in the work_id shape rather than the title|author shape — the column allows both
    const w = work({ title: 'Iron Flame', author: 'Rebecca Yarros', work_key: 'OL12345W' })
    expect(workRowKeys(w)).toEqual(['ironflame|rebeccayarros', 'OL12345W'])
    expect(
      triageResults([result({ title: 'Iron Flame', authors: ['Rebecca Yarros'] })], [], [w])[0]
        ?.state,
    ).toBe('corpus')
  })

  it('an authorless row contributes only its stored key', () => {
    expect(
      workRowKeys(work({ title: 'Anonymous Work', author: '', work_key: 'anonymouswork|' })),
    ).toEqual(['anonymouswork|'])
  })
})

describe('triageLabel', () => {
  it('is text for every state — nothing depends on colour or an icon', () => {
    expect(triageLabel({ state: 'library', work: null })).toBe('In your library')
    expect(triageLabel({ state: 'corpus', work: null })).toBe('In the corpus')
    expect(triageLabel({ state: 'new', work: null })).toBe('New to your library')
  })
})
