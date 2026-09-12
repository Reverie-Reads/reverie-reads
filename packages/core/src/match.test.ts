import { describe, expect, it } from 'vitest'
import { norm, workIdentityPart, workKeyOf } from './normalize'
import {
  decideIntake,
  isStrong,
  enrichmentSeriesFill,
  importKey,
  isbn10to13,
  matchBook,
  mergeDifferences,
  mergeImport,
  normalizeIsbn,
} from './match'
import { makeBook } from './book.fixture'
import { workIdentityPart as edgeWorkIdentityPart } from '../../../supabase/functions/_shared/workIdentity'

describe('ISBN normalization', () => {
  it('promotes ISBN-10 to ISBN-13 and matches either form', () => {
    expect(isbn10to13('0306406152')).toBe('9780306406157')
    expect(normalizeIsbn('0-306-40615-2')).toBe('9780306406157')
    expect(normalizeIsbn('9780306406157')).toBe('9780306406157')
    expect(normalizeIsbn('not-an-isbn')).toBe('')
  })

  it('rejects checksum-invalid ISBN-10 and ISBN-13 values', () => {
    // The bad 10 differs from the valid one only in its check digit. Accepting it used to promote
    // both strings to the same ISBN-13, manufacturing an edition match that did not exist.
    expect(normalizeIsbn('0306406153')).toBe('')
    expect(isbn10to13('0306406153')).toBe('')
    expect(normalizeIsbn('9780306406158')).toBe('')
  })

  it('accepts X only as a valid ISBN-10 check digit', () => {
    expect(normalizeIsbn('0-8044-2957-X')).toBe('9780804429573')
    expect(normalizeIsbn('0-8044-295X-7')).toBe('')
    expect(normalizeIsbn('97803064061X7')).toBe('')
  })
})

describe('corpus identity', () => {
  it('preserves Unicode letters and numbers while folding punctuation and compatibility forms', () => {
    expect(workIdentityPart(' 三 體：ＩｂａÑｅｚ Ⅱ ')).toBe('三體ibanezii')
    expect(edgeWorkIdentityPart(' 三 體：ＩｂａÑｅｚ Ⅱ ')).toBe('三體ibanezii')
    expect(workKeyOf({ title: '三体', first: '刘', last: '慈欣' })).toBe('三体|刘慈欣')
    expect(workKeyOf({ title: '活着', last: '余华' })).not.toBe(
      workKeyOf({ title: '三体', last: '刘慈欣' }),
    )
  })
})

describe('matchBook', () => {
  const library = [
    makeBook({
      id: 'a',
      title: 'Fourth Wing',
      first: 'Rebecca',
      last: 'Yarros',
      isbn: '0306406152',
      series: 'The Empyrean',
      position: 1,
    }),
    makeBook({ id: 'b', title: 'Iron Flame', last: 'Yarros' }),
  ]

  it('matches by ISBN across 10/13 forms (strong)', () => {
    const m = matchBook({ title: 'Fourth Wing', isbn: '9780306406157' }, library)
    expect(m.strength).toBe('isbn')
    expect(m.book.id).toBe('a')
  })

  it('matches by normalized title+author (strong)', () => {
    const m = matchBook({ title: 'iron  flame', last: 'YARROS' }, library)
    expect(m.strength).toBe('title-author')
    expect(m.book.id).toBe('b')
  })

  it('routes a subtitle-only difference to fuzzy (review, not auto)', () => {
    const m = matchBook({ title: 'Fourth Wing: The Empyrean Book One', last: 'Yarros' }, library)
    expect(m.strength).toBe('fuzzy')
    expect(m.book.id).toBe('a')
  })

  it('returns none when nothing shares a real key', () => {
    expect(matchBook({ title: 'Unrelated', last: 'Nobody' }, library).strength).toBe('none')
  })
})

describe('importKey', () => {
  it('keys by canonical ISBN-13 when present (10 and 13 forms collapse)', () => {
    expect(importKey({ title: 'Fourth Wing', last: 'Yarros', isbn: '0306406152' })).toBe(
      'isbn:9780306406157',
    )
    expect(importKey({ title: 'x', last: 'y', isbn: '9780306406157' })).toBe('isbn:9780306406157')
  })
  it('falls back to normalized title+author without an ISBN', () => {
    expect(importKey({ title: 'Iron  Flame', last: 'YARROS' })).toBe(
      importKey({ title: 'iron flame', last: 'yarros' }),
    )
  })
})

describe('decideIntake', () => {
  const o = (over: Partial<Parameters<typeof decideIntake>[1]> = {}) => ({
    autoMergeStrong: true,
    fuzzyMode: 'review' as const,
    ...over,
  })
  it('adds when nothing matched', () => {
    expect(decideIntake('none', o())).toBe('add')
  })
  it('strong match folds in when auto-merge is on, reviews when off', () => {
    expect(decideIntake('isbn', o({ autoMergeStrong: true }))).toBe('merge')
    expect(decideIntake('title-author', o({ autoMergeStrong: false }))).toBe('review')
  })
  it('fuzzy reviews on import but adds on single-add', () => {
    expect(decideIntake('fuzzy', o({ fuzzyMode: 'review' }))).toBe('review')
    expect(decideIntake('fuzzy', o({ fuzzyMode: 'add' }))).toBe('add')
  })
  it('a remembered verdict overrides everything (even with auto-merge off)', () => {
    expect(decideIntake('fuzzy', o({ verdict: 'always_merge' }))).toBe('merge')
    expect(decideIntake('isbn', o({ autoMergeStrong: false, verdict: 'always_merge' }))).toBe(
      'merge',
    )
    expect(decideIntake('fuzzy', o({ verdict: 'keep_separate' }))).toBe('skip')
    expect(decideIntake('title-author', o({ verdict: 'keep_separate' }))).toBe('skip')
  })
})

describe('enrichmentSeriesFill', () => {
  it('never overwrites a reader-chosen series', () => {
    expect(
      enrichmentSeriesFill({ series: 'The Empyrean', seriesUserChosen: true }, 'Different Series'),
    ).toBe('')
    // even after the reader clears it, their choice stands
    expect(enrichmentSeriesFill({ series: '', seriesUserChosen: true }, 'Fourth Wing Series')).toBe(
      '',
    )
  })

  it('is fill-only: existing series stay, blanks fill', () => {
    expect(enrichmentSeriesFill({ series: 'The Empyrean' }, 'Different Series')).toBe('')
    expect(enrichmentSeriesFill({ series: '' }, 'The Empyrean')).toBe('The Empyrean')
    expect(enrichmentSeriesFill({ series: '', seriesUserChosen: false }, '')).toBe('')
  })
})

describe('mergeImport', () => {
  const existing = makeBook({
    id: 'x',
    title: 'Fourth Wing',
    last: 'Yarros',
    rating: 5,
    readStatus: 'Read', // already read (it has a logged read below)
    tags: ['Dragon Riders'],
    owned: { physical: 'paperback', ebook: false, audiobook: false },
    series: '',
    cover: '',
    reads: [{ date: '2025-01-01', format: 'paperback', rating: 5, notes: 'my notes' }],
  })

  it('fills blanks and unions, but never clobbers user-authored fields', () => {
    const { patch, newReads, changed } = mergeImport(existing, {
      title: 'Fourth Wing',
      rating: 3, // must NOT overwrite the user's 5
      tags: ['Enemies to Lovers'], // unions, never removes
      owned: { physical: 'hardcover', ebook: true, audiobook: false }, // adds ebook, keeps paperback
      series: 'The Empyrean', // fills a blank
      cover: 'http://c/x.jpg', // fills a blank
      reads: [{ date: '2025-06-01', format: 'ebook', rating: 4, notes: '' }],
    })
    expect(changed).toBe(true)
    expect(patch.rating).toBeUndefined() // user rating untouched
    expect(new Set(patch.tags)).toEqual(new Set(['Dragon Riders', 'Enemies to Lovers']))
    expect(patch.owned).toEqual({ physical: 'paperback', ebook: true, audiobook: false })
    expect(patch.series).toBe('The Empyrean')
    expect(patch.cover).toBe('http://c/x.jpg')
    expect(newReads.map((r) => r.date)).toEqual(['2025-06-01'])
  })

  it('does not duplicate a genre when import casing differs', () => {
    const mixed = makeBook({
      id: 'mixed-genres',
      title: 'Mixed Genres',
      genre: 'romance',
      genres: ['romance', 'Romance'],
    })
    const { patch } = mergeImport(mixed, {
      title: mixed.title,
      genres: ['ROMANCE', 'Fantasy'],
    })

    expect(patch.genres).toEqual(['romance', 'fantasy'])
  })

  // ── mergeDifferences: what the merge DISCARDS ────────────────────────────────────────────────
  //
  // Deliberately sharing `existing` with the mergeImport cases above, per the brief: the shared
  // fixture is the point. If someone reclassifies a field in FILL_BLANK_FIELDS, the merge tests and
  // these move together or one of them goes red — which is the drift alarm the single table exists
  // to provide.

  it('reports a field both sides set and disagree on — the existing value is the one that survives', () => {
    // The headline case, and the same incoming rating (3) the fill-blank test above asserts is NOT
    // applied: the merge keeps the reader's 5 silently, and this is what says so.
    expect(mergeDifferences(existing, { title: 'Fourth Wing', rating: 3 })).toEqual([
      { key: 'rating', field: 'rating', kept: '5', offered: '3' },
    ])
  })

  it('a blank on either side is a FILL, not a difference — nothing is reported', () => {
    // `existing` has series: '' and cover: '' — the exact values the fill test above shows the
    // merge TAKING. A taken value was never contested.
    expect(
      mergeDifferences(existing, {
        title: 'Fourth Wing',
        series: 'The Empyrean',
        cover: 'http://c/x.jpg',
      }),
    ).toEqual([])
    // …and the mirror: incoming blank against an existing value is equally not a difference.
    expect(mergeDifferences(existing, { title: 'Fourth Wing', rating: 0, last: '' })).toEqual([])
  })

  it('identical values on both sides report nothing', () => {
    expect(mergeDifferences(existing, { title: 'Fourth Wing', rating: 5, last: 'Yarros' })).toEqual(
      [],
    )
  })

  it('union fields never appear — both sides are kept, so nothing is discarded', () => {
    // tags/genres/owned/possession all disagree here and all union in mergeImport.
    const diffs = mergeDifferences(existing, {
      title: 'Fourth Wing',
      tags: ['Enemies to Lovers'],
      genres: ['Fantasy'],
      owned: { physical: 'hardcover', ebook: true, audiobook: false },
      ownership: 'unowned',
      wishlist: true,
    })
    expect(diffs).toEqual([])
  })

  it('classified-but-unreported fields stay off the line (cover URL, fabricated source/status)', () => {
    const withValues = makeBook({
      id: 'y',
      title: 'T',
      cover: 'http://existing/a.jpg',
      source: 'Owned',
      status: 'ongoing',
    })
    const diffs = mergeDifferences(withValues, {
      title: 'T',
      cover: 'http://incoming/b.jpg',
      source: 'Imported',
      status: 'standalone',
    })
    expect(diffs).toEqual([])
  })

  it('reports several fields at once, and is total — same answer whatever the input object order', () => {
    const rich = makeBook({
      id: 'z',
      title: 'T',
      last: 'Yarros',
      rating: 4.5,
      format: 'Paperback',
      pub: { y: 2023, m: null, d: null },
    })
    const inc = { title: 'T', rating: 5, format: 'Hardcover', pub: { y: 2024, m: null, d: null } }
    expect(mergeDifferences(rich, inc)).toEqual([
      { key: 'format', field: 'format', kept: 'Paperback', offered: 'Hardcover' },
      { key: 'pub', field: 'published', kept: '2023', offered: '2024' },
      { key: 'rating', field: 'rating', kept: '4.5', offered: '5' },
    ])
    // key order in the incoming literal must not move the answer
    const reordered = { pub: inc.pub, format: inc.format, title: 'T', rating: inc.rating }
    expect(mergeDifferences(rich, reordered)).toEqual(mergeDifferences(rich, inc))
  })

  it('is idempotent — re-merging identical data is a no-op', () => {
    const res = mergeImport(existing, {
      title: 'Fourth Wing',
      tags: ['Dragon Riders'],
      owned: { physical: 'paperback', ebook: false, audiobook: false },
      reads: [{ date: '2025-01-01', format: 'paperback', rating: 5, notes: 'my notes' }],
    })
    expect(res.changed).toBe(false)
    expect(Object.keys(res.patch)).toHaveLength(0)
    expect(res.newReads).toHaveLength(0)
  })
})

// ── ACCEPTANCE FIXTURES — the real cases from the 2026-08-23 import of 1,166 rows ───────────────
//
// Every case below is a book the matcher should have caught and didn't (or caught and shouldn't
// have). They are transcribed from that measurement, not invented: 17 title typos, 12 multi-part
// surname splits, 1 diacritic, plus the empty-author class that produced FALSE strong matches.
describe('matchBook hardening — the measured import failures', () => {
  const lib = (over: Partial<Parameters<typeof makeBook>[0]>) =>
    [makeBook({ id: 'x', title: 'placeholder', ...over })] as const

  describe('1. multi-part surnames — the same name split in two different places', () => {
    // 12 books in the file, every "St." author: St. Clair x5, St. James, St. Crowe.
    const cases = [
      ['A Touch of Chaos', 'Scarlett', 'St. Clair', 'Scarlett St.', 'Clair'],
      ['The Never King', 'Nikki', 'St. Crowe', 'Nikki St.', 'Crowe'],
      ['Of Ink and Alchemy', 'Sloane', 'St. James', 'Sloane St.', 'James'],
    ] as const

    for (const [title, f1, l1, f2, l2] of cases) {
      it(`${title}: ${f1}/${l1} matches ${f2}/${l2} strongly`, () => {
        const m = matchBook({ title, first: f2, last: l2 }, lib({ title, first: f1, last: l1 }))
        expect(m.strength).toBe('title-author')
        expect(isStrong(m.strength)).toBe(true)
        expect(m.book.id).toBe('x')
      })
      it(`${title}: and symmetrically, ${f2}/${l2} matches ${f1}/${l1}`, () => {
        const m = matchBook({ title, first: f1, last: l1 }, lib({ title, first: f2, last: l2 }))
        expect(m.strength).toBe('title-author')
      })
    }
  })

  describe('2. surname and initial variance remain available for review', () => {
    // A near match remains visible without silently merging different contributors.
    it('Jennifer L. Armentrout matches Jennifer Armentrout on the same title', () => {
      const m = matchBook(
        { title: 'A Shadow in the Ember', first: 'Jennifer', last: 'Armentrout' },
        lib({ title: 'A Shadow in the Ember', first: 'Jennifer L.', last: 'Armentrout' }),
      )
      expect(m.strength).toBe('fuzzy')
      expect(m.book.id).toBe('x')
    })
  })

  describe('3. diacritics fold for MATCHING only', () => {
    it('Ibañez matches Ibanez', () => {
      const m = matchBook(
        { title: 'Graceless Heart', first: 'Isabel', last: 'Ibanez' },
        lib({ title: 'Graceless Heart', first: 'Isabel', last: 'Ibañez' }),
      )
      expect(m.strength).toBe('title-author')
      expect(m.book.id).toBe('x')
    })

    it('THE STORAGE KEY IS UNCHANGED — norm still deletes the tilde', () => {
      // Pinned deliberately. Every stored works.work_key and every 'ta:' enrichment-cache key is
      // built on this exact behaviour; folding HERE would orphan all of them silently. If this test
      // ever fails, someone has migrated the keys without migrating the data.
      expect(norm('Ibañez')).toBe('ibaez')
      expect(norm('Ibanez')).toBe('ibanez')
      expect(norm('Ibañez')).not.toBe(norm('Ibanez'))
    })

    it('and importKey — a merge_verdicts PRIMARY KEY component — is unchanged too', () => {
      // Same hazard, different table: merge_verdicts is keyed (owner_id, book_id, incoming_key).
      // A reshaped key does not error, it just stops finding every verdict the reader ever recorded.
      expect(importKey({ title: 'Graceless Heart', last: 'Ibañez' })).toBe('gracelessheart|ibaez')
      expect(importKey({ title: 'Iron  Flame', last: 'YARROS' })).toBe('ironflame|yarros')
    })
  })

  describe('4. an empty author must never produce a STRONG match', () => {
    // The sharpest of the four. isStrong('title-author') is true and autoMergeStrong defaults TRUE
    // on the import path, so before this guard these auto-merged two unrelated books with NO review.
    it('empty vs empty: two authorless rows sharing a title do not match', () => {
      const m = matchBook(
        { title: 'Untitled Manuscript' },
        lib({ title: 'Untitled Manuscript', first: '', last: '' }),
      )
      expect(m.strength).toBe('none')
    })

    it('empty vs present: an authorless row does not match an authored one', () => {
      const m = matchBook(
        { title: 'Untitled Manuscript' },
        lib({ title: 'Untitled Manuscript', first: 'Real', last: 'Author' }),
      )
      expect(m.strength).toBe('none')
    })

    it('present vs empty: and not in the other direction either', () => {
      const m = matchBook(
        { title: 'Untitled Manuscript', first: 'Real', last: 'Author' },
        lib({ title: 'Untitled Manuscript', first: '', last: '' }),
      )
      expect(m.strength).toBe('none')
    })

    it('a matching ISBN with a contradictory title still needs review', () => {
      const m = matchBook(
        { title: 'Untitled Manuscript', isbn: '9780306406157' },
        lib({ title: 'Something Else', first: '', last: '', isbn: '0306406152' }),
      )
      expect(m.strength).toBe('fuzzy')
      expect(m.book.id).toBe('x')
    })
  })

  describe('5. title typos flag FUZZY — never strong, so never an auto-merge', () => {
    const typos = [
      ['The Crown of Guilded Bones', 'The Crown of Gilded Bones', 'Jennifer L.', 'Armentrout'],
      ['Mopuntain Boss', 'Mountain Boss', 'S.J.', 'Tilly'],
      ['Story and Fury', 'Storm and Fury', 'Jennifer L.', 'Armentrout'],
      ['Promises & Pomegranates', 'Promises and Pomegranates', 'Sav R.', 'Miller'],
    ] as const

    for (const [damaged, real, first, last] of typos) {
      it(`"${damaged}" flags fuzzy against "${real}"`, () => {
        const m = matchBook({ title: damaged, first, last }, lib({ title: real, first, last }))
        expect(m.strength).toBe('fuzzy')
        // THE ASSERTION THAT MATTERS MOST: fuzzy is what keeps this away from auto-merge.
        expect(isStrong(m.strength)).toBe(false)
        expect(decideIntake(m.strength, { autoMergeStrong: true, fuzzyMode: 'review' })).toBe(
          'review',
        )
        expect(m.book.id).toBe('x')
      })
    }
  })

  describe('6. must NOT match at all — the two real false positives in the same file', () => {
    it('Red Rabbit (Devyn Rivers) vs Red Rabbit (Alexis Grecian) — same title, different authors', () => {
      const m = matchBook(
        { title: 'Red Rabbit', first: 'Devyn', last: 'Rivers' },
        lib({ title: 'Red Rabbit', first: 'Alexis', last: 'Grecian' }),
      )
      expect(m.strength).toBe('none')
    })

    it('Exile (Steph Macca) vs Exiles (Mason Coile) — near title, different authors', () => {
      const m = matchBook(
        { title: 'Exile', first: 'Steph', last: 'Macca' },
        lib({ title: 'Exiles', first: 'Mason', last: 'Coile' }),
      )
      expect(m.strength).toBe('none')
    })

    it('a genuinely different title by the SAME author is not a typo', () => {
      // The author gate is not on its own enough; the similarity floor has to do its half.
      const m = matchBook(
        { title: 'Iron Flame', first: 'Rebecca', last: 'Yarros' },
        lib({ title: 'Fourth Wing', first: 'Rebecca', last: 'Yarros' }),
      )
      expect(m.strength).toBe('none')
    })
  })

  describe('7. unchanged legs', () => {
    it('title + series + position offers review without confirming identity', () => {
      const m = matchBook(
        { title: 'Book Two', series: 'The Cycle', position: 2 },
        lib({ title: 'Book Two', first: '', last: '', series: 'The Cycle', position: 2 }),
      )
      expect(m.strength).toBe('fuzzy')
    })

    it("isStrong's set is exactly isbn / title-author / title-series-pos", () => {
      expect(isStrong('isbn')).toBe(true)
      expect(isStrong('title-author')).toBe(true)
      expect(isStrong('title-series-pos')).toBe(true)
      expect(isStrong('fuzzy')).toBe(false)
      expect(isStrong('none')).toBe(false)
    })
  })
})

describe('uncertain personal identities never silently combine', () => {
  it('different first names with the same surname require review', () => {
    const saved = makeBook({ id: 'smith', title: 'Shared Title', first: 'Jane', last: 'Smith' })
    const result = matchBook({ title: 'Shared Title', first: 'John', last: 'Smith' }, [saved])
    expect(result.strength).toBe('fuzzy')
    expect(isStrong(result.strength)).toBe(false)
  })
  it('missing series positions are not shared membership evidence', () => {
    const saved = makeBook({
      id: 'one',
      title: 'Shared Title',
      first: 'Jane',
      last: 'Smith',
      series: 'Shared series',
      position: '',
    })
    expect(
      matchBook(
        {
          title: 'Shared Title',
          first: 'Alex',
          last: 'Other',
          series: 'Shared series',
          position: '',
        },
        [saved],
      ).strength,
    ).toBe('none')
  })
})
