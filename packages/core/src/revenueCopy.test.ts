import { describe, expect, it } from 'vitest'
import {
  buildBuyLinks,
  buyDisclosure,
  effectiveMode,
  revenueCopy,
  type AttributionMode,
  type BuyConfig,
} from './buyLinks'

// Config must not be able to make shipped copy false.
//
// `VITE_BUY_ATTRIBUTION_MODE=affiliate` is a one-line environment change with no code review
// attached — it can be set in the Vercel dashboard by someone who never opens this repo. If the
// landing's "Midniht takes no cut" were a hardcoded string, that flip would publish a lie about
// money on the public page and nothing would fail. So the copy is a function of the mode, and
// these tests are the thing that fails if the two ever drift apart.

const MODES: AttributionMode[] = ['store', 'affiliate']

/** Every way the app has ever said "we make no money from this". */
const NO_CUT_CLAIMS = [/takes no cut/i, /earns? nothing/i, /we earn nothing/i, /no commission/i]

const configFor = (mode: AttributionMode): BuyConfig => ({
  mode,
  bookshopAffiliateId: '5780',
  store: { name: 'Powell’s', website: 'https://powells.com' },
})

const allCopy = (config: BuyConfig): string => {
  const c = revenueCopy(config)
  return [c.tag ?? '', c.body, c.footer, buyDisclosure(config)].join(' \n ')
}

describe('revenue copy tracks the attribution mode', () => {
  it('store mode claims no cut — the state production actually ships', () => {
    const copy = allCopy(configFor('store'))
    expect(copy).toMatch(/takes no cut/i)
    expect(copy).toMatch(/earns nothing/i)
    expect(revenueCopy(configFor('store')).tag).toBe('We earn nothing')
  })

  it('affiliate mode drops EVERY no-cut claim and discloses the commission', () => {
    const copy = allCopy(configFor('affiliate'))
    for (const claim of NO_CUT_CLAIMS) {
      expect(copy, `affiliate mode still renders a no-cut claim matching ${claim}`).not.toMatch(
        claim,
      )
    }
    expect(copy).toMatch(/commission/i)
    // A "we earn nothing" badge in affiliate mode would be the loudest lie on the page.
    expect(revenueCopy(configFor('affiliate')).tag).not.toMatch(/nothing/i)
  })

  it('the footer money line changes with the mode too', () => {
    expect(revenueCopy(configFor('store')).footer).not.toBe(
      revenueCopy(configFor('affiliate')).footer,
    )
    expect(revenueCopy(configFor('affiliate')).footer).toMatch(/commission/i)
  })
})

describe('"never Amazon" is pinned to the links actually emitted', () => {
  const book = { title: 'Fourth Wing', first: 'Rebecca', last: 'Yarros', isbn: '0306406152' }

  it.each(MODES)('%s mode emits no Amazon URL', (mode) => {
    const withStore = buildBuyLinks(book, configFor(mode))
    const withoutStore = buildBuyLinks(book, { ...configFor(mode), store: undefined })
    const noIsbn = buildBuyLinks({ title: 'Untitled', first: 'A', last: 'B' }, configFor(mode))
    for (const link of [...withStore, ...withoutStore, ...noIsbn]) {
      expect(link.url, `${mode} mode produced ${link.url}`).not.toMatch(/amazon/i)
    }
  })

  it('the claim and the behaviour cannot drift: if copy says "never Amazon", no link may be Amazon', () => {
    for (const mode of MODES) {
      const claimsNeverAmazon = /never amazon/i.test(revenueCopy(configFor(mode)).body)
      if (!claimsNeverAmazon) continue
      const hosts = buildBuyLinks(book, configFor(mode)).map((l) => new URL(l.url).host)
      expect(hosts.some((h) => /amazon/i.test(h))).toBe(false)
    }
  })
})

describe('the indie link is described as conditional, because it is', () => {
  // buildBuyLinks only adds the store link when the reader has chosen one. Copy that promised
  // "buy links go to your local indie" was false for every reader who never opened the finder.
  it('a reader with no store set gets only Bookshop and Libro', () => {
    const links = buildBuyLinks(
      { title: 'T', isbn: '0306406152' },
      { ...configFor('store'), store: undefined },
    )
    expect(links.map((l) => l.provider)).toEqual(['bookshop', 'libro'])
  })

  it('the copy conditions the local-shop link rather than promising it outright', () => {
    for (const mode of MODES) {
      expect(revenueCopy(configFor(mode)).body).toMatch(/once you choose one/i)
    }
  })
})

describe('copy keys on the EFFECTIVE mode, not the declared one', () => {
  // Declaring affiliate mode without a Bookshop id earns nothing — bookshopUrl falls through to the
  // plain by-ISBN link. Announcing a commission there would be false in the reader's favour, but
  // false all the same, and it is the likeliest half-finished deploy: someone flips the mode in a
  // dashboard and forgets the id.
  const halfConfigured: BuyConfig = { mode: 'affiliate', bookshopAffiliateId: '', store: undefined }

  it('affiliate mode with no Bookshop id is effectively store mode', () => {
    expect(effectiveMode(halfConfigured)).toBe('store')
    expect(effectiveMode({ mode: 'affiliate', bookshopAffiliateId: '   ' })).toBe('store')
    expect(effectiveMode({ mode: 'affiliate', bookshopAffiliateId: '5780' })).toBe('affiliate')
    expect(effectiveMode({ mode: 'store', bookshopAffiliateId: '5780' })).toBe('store')
  })

  it('keeps the no-cut copy and claims NO commission when the id is missing', () => {
    const copy = allCopy(halfConfigured)
    expect(copy).toMatch(/takes no cut/i)
    expect(copy).not.toMatch(/commission/i)
    expect(revenueCopy(halfConfigured).tag).toBe('We earn nothing')
  })

  it('and the copy matches the link actually emitted — a plain by-ISBN Bookshop URL', () => {
    const url = buildBuyLinks({ title: 'T', isbn: '0306406152' }, halfConfigured).find(
      (l) => l.provider === 'bookshop',
    )!.url
    expect(url).toBe('https://bookshop.org/book/9780306406157')
    expect(url).not.toContain('/a/')
  })
})
