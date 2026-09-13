import { describe, expect, it } from 'vitest'
import {
  applyWorksFilters,
  canonicalLookupIsbns,
  isMissingWorksIsbns,
  mergeWorkRows,
  workToHit,
  worksPageRange,
  type WorkRow,
} from './works'
import { DISCOVER_BATCH } from '../lib/discover'

/**
 * The corpus browse's pure parts. The recorder pattern below asserts the CALLS the filter
 * composition makes — a dropped branch or swapped operator is the rot this catches, and it needs
 * no database to catch it.
 */

class Recorder {
  calls: [string, unknown][] = []
  eq(col: string, v: string) {
    this.calls.push(['eq', `${col}=${v}`])
    return this
  }
  contains(col: string, v: string[]) {
    this.calls.push(['contains', `${col}⊇${JSON.stringify(v)}`])
    return this
  }
  or(expr: string) {
    this.calls.push(['or', expr])
    return this
  }
}

const filters = (over: Partial<{ genre: string; tag: string; q: string }> = {}) => ({
  genre: '',
  tag: '',
  q: '',
  ...over,
})

const row = (over: Partial<WorkRow> = {}): WorkRow => ({
  id: 'work-1',
  work_key: 'k',
  title: 'Ash Crown',
  contributors: [{ name: 'Vera Stone', role: 'author', position: 0 }],
  isbns: [],
  series: null,
  position: null,
  cover_url: null,
  genre: 'fantasy',
  tags: [],
  pub_y: null,
  pub_m: null,
  pub_d: null,
  ...over,
})

describe('applyWorksFilters', () => {
  it('no filters → no calls: the bare browse selects everything', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters())
    expect(r.calls).toEqual([])
  })

  it('genre becomes an eq', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ genre: 'fantasy' }))
    expect(r.calls).toEqual([['eq', 'genre=fantasy']])
  })

  it('tag becomes a contains, lowercased — works.tags is lowercased at import', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ tag: 'Enemies To Lovers' }))
    expect(r.calls).toEqual([['contains', 'tags⊇["enemies to lovers"]']])
  })

  it('text search matches title OR author_text — the denormalized column, not the jsonb', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ q: 'yarros' }))
    expect(r.calls).toEqual([['or', 'title.ilike.%yarros%,author_text.ilike.%yarros%']])
  })

  it('ISBN-10 search becomes exact canonical ISBN-13 array containment', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ q: '0-306-40615-2' }))
    expect(r.calls).toEqual([['contains', 'isbns⊇["9780306406157"]']])
  })

  it('strips % and , from the term — commas are PostgREST or() separators', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ q: '100%, guaranteed' }))
    expect(r.calls).toEqual([
      ['or', 'title.ilike.%100 guaranteed%,author_text.ilike.%100 guaranteed%'],
    ])
  })

  it('a whitespace-only term is no filter at all', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ q: '   ' }))
    expect(r.calls).toEqual([])
  })

  it('all three compose, in a stable order', () => {
    const r = new Recorder()
    applyWorksFilters(r, filters({ genre: 'horror', tag: 'gothic', q: 'castle' }))
    expect(r.calls.map((c) => c[0])).toEqual(['eq', 'contains', 'or'])
  })
})

describe('worksPageRange', () => {
  it('pages are DISCOVER_BATCH wide, inclusive, and disjoint', () => {
    expect(worksPageRange(0)).toEqual({ from: 0, to: DISCOVER_BATCH - 1 })
    expect(worksPageRange(1)).toEqual({ from: DISCOVER_BATCH, to: 2 * DISCOVER_BATCH - 1 })
    // disjointness is the no-duplicates-on-show-more claim, stated as arithmetic
    expect(worksPageRange(1).from).toBe(worksPageRange(0).to + 1)
  })
})

describe('workToHit — a corpus row IS an Add prefill', () => {
  it('keeps a reviewed date only for its reference edition, including equivalent ISBN-10', () => {
    const work = row({
      isbns: ['9780140449136', '9780306406157'],
      pub_y: 2024,
      pub_m: 2,
      metadata_provenance: {
        pubY: { referenceIsbn: '9780306406157' },
        pubM: { referenceIsbn: '9780306406157' },
      },
    })
    expect(workToHit(work).pub).toBe('')
    expect(workToHit(work, '0306406152').pub).toBe('2024-02')
    expect(workToHit({ ...work, isbns: [] }).pub).toBe('')
    expect(workToHit(work, '9780140449136').pub).toBe('')
  })
  it('does not splice an unscoped, conflicting or invalid date component into a reviewed tuple', () => {
    const work = row({
      isbns: ['9780306406157'],
      pub_y: 2024,
      pub_m: 2,
      metadata_provenance: { pubY: { referenceIsbn: '9780306406157' } },
    })
    for (const pubM of [
      null,
      { referenceIsbn: '9780140449136' },
      { referenceIsbn: 'bad' },
      { referenceIsbn: null },
    ]) {
      expect(
        workToHit({ ...work, metadata_provenance: { ...work.metadata_provenance, pubM } }).pub,
      ).toBe('')
    }
    expect(workToHit({ ...work, pub_m: null }).pub).toBe('2024')
  })
  it('maps authors from contributors and keeps the DiscoverHit contract', () => {
    const h = workToHit(row())
    expect(h.title).toBe('Ash Crown')
    expect(h.authors).toEqual(['Vera Stone'])
    expect(h.isbn).toBe('') // Add treats an unknown ISBN as absent
  })

  it('prefills the first canonical ISBN when the corpus knows an edition', () => {
    expect(workToHit(row({ isbns: ['9780306406157', '9781649374042'] })).isbn).toBe('9780306406157')
  })

  it('preserves the catalog edition when it matched a later corpus ISBN', () => {
    expect(
      workToHit(row({ isbns: ['9780306406157', '9781649374042'] }), '978-1-64937-404-2').isbn,
    ).toBe('9781649374042')
  })

  it('a coverless row maps to cover "" — the placeholder is the designed common case at launch', () => {
    expect(workToHit(row()).cover).toBe('')
    expect(workToHit(row({ cover_url: 'https://x/c.jpg' })).cover).toBe('https://x/c.jpg')
  })

  it('pub composes from whatever precision exists, year-only included', () => {
    expect(workToHit(row({ pub_y: 2024 })).pub).toBe('2024')
    expect(workToHit(row({ pub_y: 2024, pub_m: 3 })).pub).toBe('2024-03')
    expect(workToHit(row({ pub_y: 2024, pub_m: 3, pub_d: 7 })).pub).toBe('2024-03-07')
    expect(workToHit(row()).pub).toBe('')
  })

  it('empty contributors yield an empty authors list, not a crash or a ghost name', () => {
    expect(workToHit(row({ contributors: [] })).authors).toEqual([])
  })
})

describe('edition lookup planning and rollout', () => {
  it('canonicalizes and deduplicates the catalog ISBN batch', () => {
    expect(
      canonicalLookupIsbns(['0-306-40615-2', '9780306406157', 'bad', '9781649374042']),
    ).toEqual(['9780306406157', '9781649374042'])
  })

  it('merges a later ISBN hit into the text hit for the same work', () => {
    const base = row({ work_key: 'same', isbns: [] })
    const edition = row({ work_key: 'same', isbns: ['9781649374042'] })
    expect(mergeWorkRows([base], [edition])).toEqual([edition])
  })

  it('recognizes only the missing-column errors that the staged client may ignore', () => {
    expect(
      isMissingWorksIsbns({ code: '42703', message: 'column works.isbns does not exist' }),
    ).toBe(true)
    expect(
      isMissingWorksIsbns({
        code: 'PGRST204',
        message: "Could not find the 'isbns' column in the schema cache",
      }),
    ).toBe(true)
    expect(isMissingWorksIsbns({ code: '42501', message: 'permission denied for works' })).toBe(
      false,
    )
  })
})
