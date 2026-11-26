import { describe, expect, it } from 'vitest'
import {
  CORE_GENRES,
  genreKey,
  normalizeImportGenres,
  SPICE_INTENSITY,
  bookGenres,
  bookSubgenres,
  inferGenreFromSubgenre,
  normalizeBookGenres,
} from './genreNormalize'

// Real distinct genre strings from Chism_Books.xlsx (the "Library" sheet), as extracted.
const CHISM_GENRE_VOCAB = [
  'Horror',
  'Fantasy; Romance',
  'Romance',
  'Fantasy',
  'Horror; Fantasy',
  'Nonfiction',
  'Romance; Fantasy',
  'Fantasy; Horror',
  'romance',
  'horror',
  'Horror; SciFi',
  'SciFi',
  'fantasy; romance',
  'Fantasy; SciFi',
  'Fiction',
  'romance; fantasy',
  'SciFi; Fantasy',
  'Mystery',
  'Poetry',
  'SciFi; Horror',
  'Thriller',
  'Historical Fiction',
  'Mystery; Horror',
  'Romance; fantasy',
  'fiction',
  'historical fiction',
  'Scifi',
  'Horror; Romance',
  'fantasy',
  'scifi',
]

const g = (genre: string, tags = '') => normalizeImportGenres(genre, tags)

describe('normalizeImportGenres — primary genre + cores', () => {
  it('maps the canonical genres (case-insensitive)', () => {
    expect(g('Romance').genre).toBe('Romance')
    expect(g('romance').genre).toBe('Romance')
    expect(g('HORROR').genre).toBe('Horror')
    expect(g('Nonfiction').genre).toBe('Nonfiction')
    expect(g('Mystery').genre).toBe('Mystery')
  })
  it('normalizes the real typos/aliases', () => {
    expect(g('romace').genre).toBe('Romance') // Library typo
    expect(g('Fantays').genre).toBe('Fantasy') // Library typo
    expect(g('Fantast').genre).toBe('Fantasy') // Library typo
    expect(g('SciFi').genre).toBe('Science fiction')
    expect(g('Scifi').genre).toBe('Science fiction')
    expect(g('scifi').genre).toBe('Science fiction')
    expect(g('Thriller').genre).toBe('Mystery') // collapsed
  })
  it('keeps the human-stated priority order for multi-genre cells', () => {
    expect(g('Fantasy; Romance').genres).toEqual(['Fantasy', 'Romance'])
    expect(g('Fantasy; Romance').genre).toBe('Fantasy')
    expect(g('Romance; Fantasy').genre).toBe('Romance')
    expect(g('SciFi; Horror').genres).toEqual(['Science fiction', 'Horror'])
  })
  it('maps Fiction/Poetry/Historical (Fiction) → Literary + a descriptive tag', () => {
    expect(g('Fiction')).toMatchObject({
      genre: 'Fiction',
      genres: ['Fiction'],
      tags: ['fiction'],
    })
    expect(g('Poetry')).toMatchObject({ genre: 'Literary', tags: ['poetry'] })
    expect(g('Historical Fiction')).toMatchObject({
      genre: 'Historical Fiction',
      tags: ['historical fiction'],
    })
    expect(g('Historical')).toMatchObject({ genre: 'Literary', tags: ['historical'] })
  })
  it('blank genre stays null with empty arrays', () => {
    expect(g('')).toEqual({
      genre: null,
      genres: [],
      tags: [],
      subgenre: null,
      subgenres: [],
      intensity: null,
      unmappedGenre: null,
    })
    expect(g('   ')).toEqual({
      genre: null,
      genres: [],
      tags: [],
      subgenre: null,
      subgenres: [],
      intensity: null,
      unmappedGenre: null,
    })
  })
  it('drops non-genre markers like "standalone"', () => {
    expect(g('Romance; standalone').genres).toEqual(['Romance'])
    expect(g('standalone').genre).toBeNull()
  })
  it('reports the raw genre cell as unmappedGenre when it yields no core genre (E3 odd-genre signal)', () => {
    expect(g('standalone').unmappedGenre).toBe('standalone') // the real file's leaked series-type
    expect(g('  Dark Fae ').unmappedGenre).toBe('Dark Fae') // unrecognized label, trimmed
    expect(g('Romance; standalone').unmappedGenre).toBeNull() // a core genre WAS found → not flagged
    expect(g('Romance').unmappedGenre).toBeNull()
    expect(g('').unmappedGenre).toBeNull() // blank is not "unmapped"
  })
})

describe('normalizeImportGenres — the confirmed Chism tally', () => {
  it('the genre column resolves to exactly the expected core set', () => {
    const cores = new Set<string>()
    for (const v of CHISM_GENRE_VOCAB) for (const c of normalizeImportGenres(v).genres) cores.add(c)
    expect([...cores].sort()).toEqual([
      'Fantasy',
      'Fiction',
      'Historical Fiction',
      'Horror',
      'Literary',
      'Mystery',
      'Nonfiction',
      'Romance',
      'Science fiction',
    ])
    // No Cozy or YA come from the Chism genre column (they live in tags, if at all).
    expect(cores.has('Cozy')).toBe(false)
    expect(cores.has('Young adult')).toBe(false)
  })
  it('every real genre string resolves to a primary core (none dropped to null)', () => {
    for (const v of CHISM_GENRE_VOCAB) expect(normalizeImportGenres(v).genre, v).not.toBeNull()
  })
})

describe('normalizeImportGenres — tags + intensity', () => {
  it('tags column: lowercase, split, dedupe; never promoted to a genre', () => {
    expect(g('', 'Dark').tags).toEqual(['dark'])
    expect(g('', 'YA').genre).toBeNull() // YA in the tags column stays a tag, not a genre
    expect(g('', 'YA').tags).toEqual(['ya'])
    expect(g('', 'Dark; Dark Academia; Dark').tags).toEqual(['dark', 'dark academia'])
  })
  it('fixes the stray "dark: spicy" colon and lifts spicy to the intensity signal', () => {
    const r = g('', 'dark: spicy')
    expect(r.tags).toEqual(['dark', 'spicy'])
    expect(r.intensity).toBe(SPICE_INTENSITY)
  })
  it('spice in the genre column also sets intensity + stays a tag', () => {
    const r = g('Romance; spicy')
    expect(r.genre).toBe('Romance')
    expect(r.intensity).toBe(SPICE_INTENSITY)
    expect(r.tags).toContain('spicy')
  })
  it('non-core genre tokens spill into tags', () => {
    expect(g('Romance; Western').tags).toContain('western')
    expect(g('Romance; Western').genres).toEqual(['Romance'])
  })
})

describe('normalizeImportGenres — Library shape vocab', () => {
  it('the Library genre column is overwhelmingly Romance with a little Fantasy', () => {
    // Representative of Library_App_list (Romance 484 / Fantasy 5): aliases + typos all resolve.
    const sample = [
      'Romance',
      'romance',
      'romace',
      'Romance; standalone',
      'Fantasy',
      'Fantays',
      'Fantast',
    ]
    const primaries = new Set(sample.map((s) => normalizeImportGenres(s).genre))
    expect([...primaries].sort()).toEqual(['Fantasy', 'Romance'])
  })
})

describe('genreKey — the one lookup key for every genre spelling', () => {
  it('every spelling a stored book may carry lands on its canonical lowercased key', () => {
    // import canon (old and new), legacy enrichment tokens, skin genres, shorthand
    for (const raw of ['Sci-Fi', 'sci fi', 'science-fiction', 'Science fiction', 'SCIFI']) {
      expect(genreKey(raw), raw).toBe('science fiction')
    }
    for (const raw of ['YA', 'young-adult', 'Young adult', 'young adult']) {
      expect(genreKey(raw), raw).toBe('young adult')
    }
    expect(genreKey('Thriller')).toBe('mystery')
    expect(genreKey('crime')).toBe('mystery')
    expect(genreKey('historical')).toBe('literary')
    expect(genreKey('Historical Fiction')).toBe('historical fiction')
    expect(genreKey('cosy')).toBe('cozy')
  })

  it('canonical genres are fixed points; unknown genres just lowercase (never coerced)', () => {
    for (const g of CORE_GENRES) expect(genreKey(g)).toBe(g.toLowerCase())
    expect(genreKey('Gardening')).toBe('gardening')
    expect(genreKey('  Weird  ')).toBe('weird')
    expect(genreKey('')).toBe('')
  })
})

describe('primary-genre inference from a single subgenre', () => {
  it('maps unambiguous subgenres to their one genre (case/space-insensitive)', () => {
    expect(inferGenreFromSubgenre('Dark Romance')).toBe('romance')
    expect(inferGenreFromSubgenre('Epic Fantasy')).toBe('fantasy')
    expect(inferGenreFromSubgenre('  space opera ')).toBe('science fiction')
    expect(inferGenreFromSubgenre('Gothic')).toBe('horror')
    expect(inferGenreFromSubgenre('Whodunit')).toBe('mystery')
    expect(inferGenreFromSubgenre('Magical Realism')).toBe('literary')
    expect(inferGenreFromSubgenre('Culinary')).toBe('cozy')
    expect(inferGenreFromSubgenre('Memoir')).toBe('nonfiction')
    expect(inferGenreFromSubgenre('Coming of Age')).toBe('young adult')
  })

  it('never guesses on shared or legacy subgenres — the reader decides', () => {
    for (const shared of [
      'Romantasy',
      'Contemporary',
      'Cozy Mystery',
      'Cozy Fantasy',
      'Other',
      'Fantasy',
      '',
    ]) {
      expect(inferGenreFromSubgenre(shared)).toBeNull()
    }
  })
})

describe('bookSubgenres', () => {
  it('prefers the array, falls back to the legacy single, tolerates neither', () => {
    expect(bookSubgenres({ subgenre: 'Noir', subgenres: ['Noir', 'Thriller'] })).toEqual([
      'Noir',
      'Thriller',
    ])
    expect(bookSubgenres({ subgenre: 'Noir', subgenres: [] })).toEqual(['Noir'])
    expect(bookSubgenres({ subgenre: '', subgenres: [] })).toEqual([])
  })
})

describe('bookGenres', () => {
  it('dedupes mixed-case repeats and uses canonical core keys', () => {
    expect(normalizeBookGenres([' Romance ', 'romance', 'Fantasy', 'fantasy', ''])).toEqual([
      'romance',
      'fantasy',
    ])
    expect(bookGenres({ genre: 'romance', genres: ['Romance', 'romance', 'Fantasy'] })).toEqual([
      'romance',
      'fantasy',
    ])
  })

  it('keeps distinct descriptive labels that file into the same room', () => {
    expect(normalizeBookGenres(['Thriller', 'Mystery'])).toEqual(['Thriller', 'mystery'])
  })

  it('falls back to the legacy primary genre', () => {
    expect(bookGenres({ genre: 'Science fiction', genres: [] })).toEqual(['science fiction'])
    expect(bookGenres({ genre: '', genres: [] })).toEqual([])
  })
})
