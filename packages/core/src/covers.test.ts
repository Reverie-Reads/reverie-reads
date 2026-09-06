import { describe, expect, it } from 'vitest'
import {
  isDegenerateGoogleCoverRender,
  DISPLAY_ONLY_COVER_SOURCES,
  coverCandidates,
  enrichmentCoverFill,
  isCoverSource,
  isGoogleContentCover,
  isGoogleNoCoverArt,
  isIngestibleCoverSource,
  isIngestibleCoverUrl,
  isStoredCoverUrl,
  isUpgradeableCoverUrl,
  mayIngestCover,
  upgradeCoverUrl,
} from './covers'

describe('cover system provenance + non-overwrite', () => {
  it('recognizes stored (durable) cover URLs vs external hotlinks', () => {
    expect(
      isStoredCoverUrl('https://x.supabase.co/storage/v1/object/public/covers/u/a/b.webp'),
    ).toBe(true)
    expect(isStoredCoverUrl('https://books.google.com/books/content?id=1')).toBe(false)
    expect(isStoredCoverUrl('')).toBe(false)
  })

  it('validates cover sources', () => {
    for (const s of ['hardcover', 'google', 'openlibrary', 'upload', 'camera', 'url']) {
      expect(isCoverSource(s)).toBe(true)
    }
    expect(isCoverSource('amazon')).toBe(false)
    expect(isCoverSource(undefined)).toBe(false)
  })

  it('enrichment never overwrites a user-chosen cover', () => {
    expect(
      enrichmentCoverFill(
        { cover: 'https://stored/u.webp', coverUserChosen: true },
        'https://g/new.jpg',
      ),
    ).toBe('')
    // even after the reader clears the image, their choice stands
    expect(enrichmentCoverFill({ cover: '', coverUserChosen: true }, 'https://g/new.jpg')).toBe('')
  })

  it('enrichment is fill-only: existing covers stay, blanks fill', () => {
    expect(enrichmentCoverFill({ cover: 'https://seed/cover.jpg' }, 'https://g/new.jpg')).toBe('')
    expect(enrichmentCoverFill({ cover: '' }, 'https://g/new.jpg')).toBe('https://g/new.jpg')
    expect(enrichmentCoverFill({ cover: '', coverUserChosen: false }, '')).toBe('')
  })
})

describe('upgradeCoverUrl', () => {
  const G =
    'https://books.google.com/books/content?id=ABC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api'

  it('raises Google Books zoom to 0 (largest) for full and strips the page-curl', () => {
    const u = upgradeCoverUrl(G, 'full')
    expect(u).toContain('zoom=0')
    expect(u).not.toContain('zoom=1')
    expect(u).not.toContain('edge=curl')
    expect(u).toContain('id=ABC')
  })

  it('uses zoom=2 (~300px) for a light grid thumb', () => {
    expect(upgradeCoverUrl(G, 'thumb')).toContain('zoom=2')
  })

  it('adds a zoom param when none is present', () => {
    expect(upgradeCoverUrl('https://books.google.com/books/content?id=X&img=1', 'full')).toContain(
      'zoom=0',
    )
  })

  it('is idempotent (re-upgrading a full URL is a no-op)', () => {
    const once = upgradeCoverUrl(G, 'full')
    expect(upgradeCoverUrl(once, 'full')).toBe(once)
  })

  it('swaps the Open Library size suffix (-M → -L for full, -S → -M for thumb)', () => {
    expect(upgradeCoverUrl('https://covers.openlibrary.org/b/id/123-M.jpg', 'full')).toBe(
      'https://covers.openlibrary.org/b/id/123-L.jpg',
    )
    expect(upgradeCoverUrl('https://covers.openlibrary.org/b/id/123-S.jpg', 'thumb')).toBe(
      'https://covers.openlibrary.org/b/id/123-M.jpg',
    )
    expect(
      upgradeCoverUrl('https://covers.openlibrary.org/b/id/123-M.jpg?default=false', 'full'),
    ).toBe('https://covers.openlibrary.org/b/id/123-L.jpg?default=false')
  })

  it('leaves Hardcover, B&N, storage, and empty URLs untouched', () => {
    const hc = 'https://assets.hardcover.app/editions/30707731/abc.jpeg'
    const bn = 'https://prodimage.images-bn.com/pimages/9781635575569_p0_v6_s600x595.jpg'
    const store = 'https://x.supabase.co/storage/v1/object/public/covers/u/a/b.webp'
    expect(upgradeCoverUrl(hc)).toBe(hc)
    expect(upgradeCoverUrl(bn)).toBe(bn)
    expect(upgradeCoverUrl(store)).toBe(store)
    expect(upgradeCoverUrl('')).toBe('')
  })

  it('isUpgradeableCoverUrl flags only Google/OL sources', () => {
    expect(isUpgradeableCoverUrl(G)).toBe(true)
    expect(isUpgradeableCoverUrl('https://covers.openlibrary.org/b/id/9-M.jpg')).toBe(true)
    expect(isUpgradeableCoverUrl('https://assets.hardcover.app/x.jpeg')).toBe(false)
    expect(isUpgradeableCoverUrl('')).toBe(false)
  })
})

describe('Google "no image" plate detection (the #56 white-card regression)', () => {
  const G =
    'https://books.google.com/books/content?id=ABC&printsec=frontcover&img=1&zoom=0&source=gbs_api'

  it('isGoogleContentCover matches the content endpoint + its googleusercontent mirror only', () => {
    expect(isGoogleContentCover(G)).toBe(true)
    expect(isGoogleContentCover('https://books.googleusercontent.com/books/content?id=X')).toBe(
      true,
    )
    expect(isGoogleContentCover('https://covers.openlibrary.org/b/id/9-L.jpg')).toBe(false)
    expect(isGoogleContentCover('https://assets.hardcover.app/x.jpeg')).toBe(false)
    expect(
      isGoogleContentCover('https://books.google.evil.example/books/content?id=attacker'),
    ).toBe(false)
    expect(
      isGoogleContentCover('https://books.googleusercontent.com.evil.example/books/content?id=x'),
    ).toBe(false)
    expect(isGoogleContentCover('https://evil.example/books.google.com/books/content?id=x')).toBe(
      false,
    )
    expect(isGoogleContentCover('https://books.google.com@evil.example/books/content?id=x')).toBe(
      false,
    )
    expect(isGoogleContentCover('')).toBe(false)
  })

  it('flags the fixed-size "image not available" plate Google serves at HTTP 200', () => {
    // measured live: 575×750 for zoom 0/2/3, 128×170 for zoom 1 — byte-stable across book ids
    expect(isGoogleNoCoverArt(G, 575, 750)).toBe(true)
    expect(isGoogleNoCoverArt(G, 128, 170)).toBe(true)
  })

  it('does NOT flag a real cover (even a small one) or a plate-sized image from another host', () => {
    expect(isGoogleNoCoverArt(G, 128, 198)).toBe(false) // a real 128px Google thumbnail
    expect(isGoogleNoCoverArt(G, 800, 1313)).toBe(false) // a real full scan
    // exact-size match is Google-only: another host at 575×750 is a real cover, never the plate
    expect(isGoogleNoCoverArt('https://covers.openlibrary.org/b/id/9-L.jpg', 575, 750)).toBe(false)
  })
})

describe('coverCandidates — the shared fallback chain (upgraded → original → placeholder)', () => {
  const G = 'https://books.google.com/books/content?id=ABC&img=1&zoom=1'

  it('leads with the upgraded URL and keeps the un-upgraded original as a fallback', () => {
    expect(coverCandidates(G, { size: 'full' })).toEqual([
      'https://books.google.com/books/content?id=ABC&img=1&zoom=0',
      G,
    ])
  })

  it('puts a stored thumb first on thumb surfaces (already the right size)', () => {
    const stored = 'https://x.supabase.co/storage/v1/object/public/covers/u/a/b.webp'
    expect(coverCandidates(G, { size: 'thumb', storedThumb: stored })).toEqual([
      stored,
      'https://books.google.com/books/content?id=ABC&img=1&zoom=2',
      G,
    ])
  })

  it('de-dupes when the cover has no upgrade (upgraded === original) and drops empties', () => {
    const hc = 'https://assets.hardcover.app/x.jpeg'
    expect(coverCandidates(hc, { size: 'full' })).toEqual([hc]) // one entry, not two
    expect(coverCandidates('', { size: 'full' })).toEqual([])
    expect(coverCandidates(null)).toEqual([])
    expect(coverCandidates(undefined, { size: 'thumb', storedThumb: null })).toEqual([])
  })
})

describe('ingest posture — Google is display-time only', () => {
  const GOOGLE = 'https://books.google.com/books/content?id=abc&printsec=frontcover&img=1&zoom=1'
  const GOOGLE_MIRROR = 'https://books.googleusercontent.com/books/content?id=xyz&zoom=1'
  const OL = 'https://covers.openlibrary.org/b/id/12345-M.jpg'
  const STORED = 'https://x.supabase.co/storage/v1/object/public/covers/u/1/2/3.webp'

  it('names Google as the one display-only source', () => {
    expect(DISPLAY_ONLY_COVER_SOURCES).toEqual(['google'])
    expect(isIngestibleCoverSource('google')).toBe(false)
    for (const s of ['openlibrary', 'upload', 'camera', 'url', 'hardcover'] as const) {
      expect(isIngestibleCoverSource(s), s).toBe(true)
    }
  })

  it('refuses Google by HOST, whatever the declared source says', () => {
    // the lazy backfill labels pre-existing covers 'url' — the host is what actually matters
    expect(isIngestibleCoverUrl(GOOGLE)).toBe(false)
    expect(isIngestibleCoverUrl(GOOGLE_MIRROR)).toBe(false)
    expect(mayIngestCover('url', GOOGLE)).toBe(false)
    expect(mayIngestCover('openlibrary', GOOGLE)).toBe(false)
  })

  it('allows only the reviewed durable remote sources', () => {
    expect(isIngestibleCoverUrl(OL)).toBe(true)
    expect(mayIngestCover('openlibrary', OL)).toBe(true)
    expect(isIngestibleCoverUrl('https://assets.hardcover.app/editions/1/cover.jpeg')).toBe(true)
    expect(mayIngestCover('camera')).toBe(true) // file upload, no URL
    expect(mayIngestCover('upload')).toBe(true)
    expect(
      mayIngestCover('url', 'https://books.google.evil.example/books/content?id=reader-choice'),
    ).toBe(false)
    expect(mayIngestCover('url', 'https://reader-controlled.example/cover.webp')).toBe(false)
  })

  it('treats an already-stored URL as nothing to ingest', () => {
    expect(isIngestibleCoverUrl(STORED)).toBe(false)
    expect(isIngestibleCoverUrl('')).toBe(false)
  })

  it('still RENDERS a Google cover — display is untouched by the ingest rule', () => {
    const chain = coverCandidates(GOOGLE, { size: 'full' })
    expect(chain.length).toBeGreaterThan(0)
    expect(chain[0]).toContain('zoom=0') // upgraded for display, just never stored
    expect(isGoogleNoCoverArt(GOOGLE, 575, 750)).toBe(true) // plate guard intact
  })
})

describe('isDegenerateGoogleCoverRender (discover-cover-quality audit)', () => {
  const g = (z: number) =>
    `https://books.google.com/books/content?id=x&printsec=frontcover&img=1&zoom=${z}&source=gbs_api`

  it('rejects the scan strips STRUCTURALLY — measured sizes and invented future ones alike', () => {
    expect(isDegenerateGoogleCoverRender(g(2), 300, 48)).toBe(true) // measured zoom=2 strip
    expect(isDegenerateGoogleCoverRender(g(0), 575, 92)).toBe(true) // measured zoom=0 strip
    expect(isDegenerateGoogleCoverRender(g(2), 640, 100)).toBe(true) // a strip size Google has not served yet
    expect(isDegenerateGoogleCoverRender(g(2), 40, 400)).toBe(true) // absurd tall sliver
  })

  it('rejects every known plate size, including the 300×391 the thumb upgrade requests', () => {
    expect(isDegenerateGoogleCoverRender(g(2), 300, 391)).toBe(true)
    expect(isDegenerateGoogleCoverRender(g(0), 575, 750)).toBe(true)
    expect(isDegenerateGoogleCoverRender(g(1), 128, 170)).toBe(true)
  })

  it('passes real covers across the measured band, including the square-ish outlier', () => {
    expect(isDegenerateGoogleCoverRender(g(2), 300, 461)).toBe(false) // modern ebook thumb
    expect(isDegenerateGoogleCoverRender(g(0), 1988, 3056)).toBe(false) // modern ebook full
    expect(isDegenerateGoogleCoverRender(g(1), 128, 198)).toBe(false) // real zoom=1
    expect(isDegenerateGoogleCoverRender(g(1), 128, 128)).toBe(false) // square-ish but real
  })

  it('never judges a non-Google URL — a reader-chosen unusual cover is not second-guessed', () => {
    expect(isDegenerateGoogleCoverRender('https://example.com/wide-art.png', 300, 48)).toBe(false)
    expect(
      isDegenerateGoogleCoverRender('https://covers.openlibrary.org/b/id/1-L.jpg', 575, 92),
    ).toBe(false)
  })

  it('leaves unloaded (zero-dimension) images to onError', () => {
    expect(isDegenerateGoogleCoverRender(g(2), 0, 0)).toBe(false)
  })
})
