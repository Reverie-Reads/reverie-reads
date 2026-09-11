// MIRROR of packages/core/src/discoverCurated.ts for the Deno releases Edge Function (Deno cannot
// import the workspace package). Copied verbatim below the header. discoverCuratedParity.test.ts
// runs the same fixtures through THIS file and core and asserts identical output, so any drift
// fails CI. Edit core/discoverCurated.ts, then re-mirror.

/** The client-facing hit shape (mirror of DiscoverHit in apps/web/src/lib/discover.ts). */
export interface CuratedHit {
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  /** provenance marker: curated injection vs live subject-query — debuggable end to end
   *  (survives the fn's releases_cache payloads and the client's network tab). */
  curated: true
}

/** The four starved categories (audit §5: 0% 2020+ at fn depth). Keys are canonical genre keys
 *  (genreKey output / GENRE_DISCOVER_QUERY keys). The healthy and not-yet-justified categories
 *  are absent ON PURPOSE — an absent key means blendCuratedPool is a passthrough. */
export const CURATED_DISCOVER: Record<string, CuratedHit[]> = {
  romance: [
    {
      title: 'Onyx Storm',
      authors: ['Rebecca Yarros'],
      cover: 'https://covers.openlibrary.org/b/id/14826089-L.jpg',
      isbn: '9781649376947',
      pub: '2025-01-21',
      curated: true,
    },
    {
      title: 'Great Big Beautiful Life',
      authors: ['Emily Henry'],
      cover: 'https://covers.openlibrary.org/b/id/14861424-L.jpg',
      isbn: '9780593441299',
      pub: '2025-04-22',
      curated: true,
    },
    {
      title: 'Problematic Summer Romance',
      authors: ['Ali Hazelwood'],
      cover: 'https://covers.openlibrary.org/b/id/15096054-L.jpg',
      isbn: '9798217187430',
      pub: '2025-05-27',
      curated: true,
    },
    {
      title: 'Alchemised',
      authors: ['SenLinYu'],
      cover: 'https://covers.openlibrary.org/b/id/15162548-L.jpg',
      isbn: '9780593972717',
      pub: '2025-09-23',
      curated: true,
    },
    {
      title: 'Quicksilver',
      authors: ['Callie Hart'],
      cover: 'https://covers.openlibrary.org/b/id/15227615-L.jpg',
      isbn: '9781538774212',
      pub: '2024-09-10',
      curated: true,
    },
    {
      title: 'The Serpent and the Wings of Night',
      authors: ['Carissa Broadbent'],
      cover: '',
      isbn: '9781960854339',
      pub: '2022',
      curated: true,
    },
    {
      title: 'Heated Rivalry',
      authors: ['Rachel Reid'],
      cover: 'https://covers.openlibrary.org/b/id/15226452-L.jpg',
      isbn: '9781488051241',
      pub: '2019',
      curated: true,
    },
    {
      title: 'Haunting Adeline',
      authors: ['H. D. Carlton'],
      cover: 'https://covers.openlibrary.org/b/id/12992962-L.jpg',
      isbn: '9781638932918',
      pub: '2021',
      curated: true,
    },
    {
      title: 'Just for the Summer',
      authors: ['Abby Jimenez'],
      cover: 'https://covers.openlibrary.org/b/id/14602781-L.jpg',
      isbn: '9781538704448',
      pub: '2024-04-02',
      curated: true,
    },
    {
      title: 'Bonds of Hercules',
      authors: ['Jasmine Mas'],
      cover: 'https://covers.openlibrary.org/b/id/15234949-L.jpg',
      isbn: '9780369764669',
      pub: '2025-10-28',
      curated: true,
    },
    {
      title: 'Outlier',
      authors: ['Susie Tate'],
      cover: '',
      isbn: '9781923232167',
      pub: '2025-08-12',
      curated: true,
    },
    {
      title: 'The First Witch of Boston',
      authors: ['Andrea Catalano'],
      cover: 'https://covers.openlibrary.org/b/id/15143671-L.jpg',
      isbn: '9781662526008',
      pub: '2025-09',
      curated: true,
    },
  ],
  fantasy: [
    {
      title: 'Fourth Wing',
      authors: ['Rebecca Yarros'],
      cover: 'https://covers.openlibrary.org/b/id/14407898-L.jpg',
      isbn: '9781649374080',
      pub: '2023-05-02',
      curated: true,
    },
    {
      title: 'Katabasis',
      authors: ['R. F. Kuang'],
      cover: 'https://covers.openlibrary.org/b/id/15117021-L.jpg',
      isbn: '9780063021495',
      pub: '2025-08-26',
      curated: true,
    },
    {
      title: 'Dungeon Crawler Carl',
      authors: ['Matt Dinniman'],
      cover: 'https://covers.openlibrary.org/b/id/15143022-L.jpg',
      isbn: '9780593820254',
      pub: '2020',
      curated: true,
    },
    {
      title: 'The Knight and the Moth',
      authors: ['Rachel Gillig'],
      cover: 'https://covers.openlibrary.org/b/id/15162567-L.jpg',
      isbn: '9780316573788',
      pub: '2025-05-20',
      curated: true,
    },
    {
      title: 'The Invisible Life of Addie LaRue',
      authors: ['V. E. Schwab'],
      cover: 'https://covers.openlibrary.org/b/id/10092261-L.jpg',
      isbn: '9780765387585',
      pub: '2020-10-06',
      curated: true,
    },
    {
      title: 'Legends & Lattes',
      authors: ['Travis Baldree'],
      cover: 'https://covers.openlibrary.org/b/id/13028635-L.jpg',
      isbn: '9781250886095',
      pub: '2022-06-07',
      curated: true,
    },
    {
      title: 'One Dark Window',
      authors: ['Rachel Gillig'],
      cover: 'https://covers.openlibrary.org/b/id/12431959-L.jpg',
      isbn: '9780316312585',
      pub: '2022-09-27',
      curated: true,
    },
    {
      title: 'A Psalm for the Wild-Built',
      authors: ['Becky Chambers'],
      cover: 'https://covers.openlibrary.org/b/id/10476616-L.jpg',
      isbn: '9781250236227',
      pub: '2021-07-13',
      curated: true,
    },
    {
      title: 'The Wolf King',
      authors: ['Lauren Palphreyman'],
      cover: 'https://covers.openlibrary.org/b/id/15117196-L.jpg',
      isbn: '9798853931916',
      pub: '2023',
      curated: true,
    },
    {
      title: 'A Forbidden Alchemy',
      authors: ['Stacey McEwan'],
      cover: '',
      isbn: '9781761428517',
      pub: '2025-07-02',
      curated: true,
    },
    {
      title: 'Metal Slinger',
      authors: ['Rachel Schneider'],
      cover: 'https://covers.openlibrary.org/b/id/15209699-L.jpg',
      isbn: '9781250419095',
      pub: '2023',
      curated: true,
    },
  ],
  'science fiction': [
    {
      title: 'Project Hail Mary',
      authors: ['Andy Weir'],
      cover: 'https://covers.openlibrary.org/b/id/11200092-L.jpg',
      isbn: '9798217299461',
      pub: '2021',
      curated: true,
    },
    {
      title: 'Sea of Tranquility',
      authors: ['Emily St. John Mandel'],
      cover: 'https://covers.openlibrary.org/b/id/11465138-L.jpg',
      isbn: '9780593321454',
      pub: '2022-04-05',
      curated: true,
    },
    {
      title: 'Klara and the Sun',
      authors: ['Kazuo Ishiguro'],
      cover: 'https://covers.openlibrary.org/b/id/10648686-L.jpg',
      isbn: '9780593318188',
      pub: '2021-03-02',
      curated: true,
    },
    {
      title: 'The Ministry of Time',
      authors: ['Kaliane Bradley'],
      cover: 'https://covers.openlibrary.org/b/id/14621125-L.jpg',
      isbn: '9781668092651',
      pub: '2024-10-22',
      curated: true,
    },
    {
      title: 'Network Effect',
      authors: ['Martha Wells'],
      cover: 'https://covers.openlibrary.org/b/id/9426689-L.jpg',
      isbn: '9781250229847',
      pub: '2020-05-05',
      curated: true,
    },
    {
      title: 'A Memory Called Empire',
      authors: ['Arkady Martine'],
      cover: 'https://covers.openlibrary.org/b/id/8802134-L.jpg',
      isbn: '9781250349484',
      pub: '2019',
      curated: true,
    },
    {
      title: 'Harrow the Ninth',
      authors: ['Tamsyn Muir'],
      cover: 'https://covers.openlibrary.org/b/id/9406886-L.jpg',
      isbn: '9781250313201',
      pub: '2020-08-04',
      curated: true,
    },
    {
      title: 'The Terraformers',
      authors: ['Annalee Newitz'],
      cover: 'https://covers.openlibrary.org/b/isbn/9781250228062-L.jpg?default=false',
      isbn: '9781250228062',
      pub: '2023-01-31',
      curated: true,
    },
    {
      title: 'Someone You Can Build a Nest In',
      authors: ['John Wiswell'],
      cover: 'https://covers.openlibrary.org/b/id/15137468-L.jpg',
      isbn: '9781958974759',
      pub: '2024',
      curated: true,
    },
    {
      title: 'Under Fortunate Stars',
      authors: ['Ren Hutchings'],
      cover: 'https://covers.openlibrary.org/b/id/13183206-L.jpg',
      isbn: '9781786185914',
      pub: '2022-05-10',
      curated: true,
    },
  ],
  mystery: [
    {
      title: 'The Thursday Murder Club',
      authors: ['Richard Osman'],
      cover: 'https://covers.openlibrary.org/b/id/10201431-L.jpg',
      isbn: '9780593513033',
      pub: '2020',
      curated: true,
    },
    {
      title: 'The Housemaid',
      authors: ['Freida McFadden'],
      cover: 'https://covers.openlibrary.org/b/id/15105883-L.jpg',
      isbn: '9780349132884',
      pub: '2022',
      curated: true,
    },
    {
      title: 'King of Ashes',
      authors: ['S. A. Cosby'],
      cover: '',
      isbn: '9781250832078',
      pub: '2025-06-10',
      curated: true,
    },
    {
      title: 'The Frozen River',
      authors: ['Ariel Lawhon'],
      cover: 'https://covers.openlibrary.org/b/id/14554130-L.jpg',
      isbn: '9780593312070',
      pub: '2023',
      curated: true,
    },
    {
      title: 'Strange Houses',
      authors: ['Uketsu'],
      cover: 'https://covers.openlibrary.org/b/id/15123139-L.jpg',
      isbn: '9780063433168',
      pub: '2025',
      curated: true,
    },
    {
      title: 'The Silent Patient',
      authors: ['Alex Michaelides'],
      cover: 'https://covers.openlibrary.org/b/id/9407338-L.jpg',
      isbn: '9781250301710',
      pub: '2019-02-05',
      curated: true,
    },
    {
      title: 'Never Lie',
      authors: ['Freida McFadden'],
      cover: 'https://covers.openlibrary.org/b/id/13198561-L.jpg',
      isbn: '9781420513981',
      pub: '2022',
      curated: true,
    },
    {
      title: 'Murder by Cheesecake',
      authors: ['Rachel Ekstrom Courage'],
      cover: '',
      isbn: '9781420526370',
      pub: '2025-08-13',
      curated: true,
    },
  ],
}

/** The minimal hit shape the blend needs — structurally satisfied by DiscoverHit and the fn's Hit. */
export interface BlendableHit {
  title: string
  authors: string[]
  cover: string
  isbn: string
  pub: string
  curated?: boolean
}

const norm = (s: string): string =>
  s
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, ' ')
    .trim()

/**
 * Live + curated, deduped, for the four in-scope categories; a PASSTHROUGH (same array, untouched)
 * for every other genre — the unchanged-categories guard keys off this.
 *
 * Live candidates come FIRST, so where the same book arrives both ways the live record wins and the
 * curated one drops — the injection adds what the window cannot see, it never shadows what it can.
 * Dedupe checks BOTH identity keys (ISBN, normalized title+first author) per record: the fn's
 * one-key dedupe would keep two editions of the same book (different ISBNs) as two rows.
 */
export function blendCuratedPool<H extends BlendableHit>(
  genre: string,
  live: readonly H[],
): (H | CuratedHit)[] {
  const curated = CURATED_DISCOVER[genre]
  if (!curated) return live as (H | CuratedHit)[]
  const seen = new Set<string>()
  const out: (H | CuratedHit)[] = []
  for (const h of [...live, ...curated]) {
    const byIsbn = h.isbn.replace(/[^0-9Xx]/g, '').toLowerCase()
    const byTitle = `${norm(h.title)}|${norm(h.authors[0] ?? '')}`
    if ((byIsbn && seen.has(byIsbn)) || seen.has(byTitle)) continue
    if (byIsbn) seen.add(byIsbn)
    seen.add(byTitle)
    out.push(h)
  }
  return out
}

/**
 * The Discover shelf ranking — the releases fn's year-tier logic, extracted verbatim so curated and
 * live candidates rank by ONE function: last 2 years first (newest-first), the last 8 as filler,
 * then everything older. Missing years demote (year 0 → rest), never promote.
 */
export function tierDiscoverShelf<H extends BlendableHit>(
  hits: readonly H[],
  thisYear: number,
): H[] {
  const year = (h: H) => Number(h.pub.slice(0, 4)) || 0
  const byDate = (a: H, b: H) => b.pub.localeCompare(a.pub)
  const fresh = hits.filter((h) => year(h) >= thisYear - 2).sort(byDate)
  const recent = hits.filter((h) => year(h) < thisYear - 2 && year(h) >= thisYear - 8).sort(byDate)
  const rest = hits.filter((h) => year(h) < thisYear - 8)
  return [...fresh, ...recent, ...rest]
}
