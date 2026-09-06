import { beforeEach, expect, it, vi } from 'vitest'
import { fetchDiscoveryDetails } from './discoveryDetails'
const enrich = vi.hoisted(() => vi.fn())
vi.mock('./enrich', () => ({ enrichBookOutcome: enrich }))
const hit = {
  title: 'A shared title',
  authors: ['Author One', 'Author Two'],
  isbn: '9780306406157',
  cover: '',
  pub: '',
}
beforeEach(() => enrich.mockReset())
it('requires all contributors before accepting a work-level synopsis', async () => {
  enrich.mockResolvedValue({
    status: 'ok',
    data: {
      title: hit.title,
      authors: ['Author One', 'Someone Else'],
      description: 'Wrong collaboration',
      confidence: 'high',
    },
  })
  expect(await fetchDiscoveryDetails(hit)).toEqual({})
})
it('keeps a confirmed work synopsis without borrowing another edition publisher or language', async () => {
  enrich.mockResolvedValue({
    status: 'ok',
    data: {
      title: hit.title,
      authors: [...hit.authors].reverse(),
      description: 'Right work',
      confidence: 'high',
      publisher: 'Another edition',
      language: 'fr',
    },
  })
  const result = await fetchDiscoveryDetails(hit)
  expect(result.description).toBe('Right work')
  expect(result.publisher).toBeUndefined()
  expect(result.language).toBeUndefined()
})
it('retains edition facts when the exact ISBN matches', async () => {
  enrich.mockResolvedValue({
    status: 'ok',
    data: { isbn10: '0306406152', publisher: 'Exact publisher', language: 'en' },
  })
  expect(await fetchDiscoveryDetails(hit)).toMatchObject({
    publisher: 'Exact publisher',
    language: 'en',
  })
})
