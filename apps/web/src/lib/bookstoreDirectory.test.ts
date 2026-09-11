import { describe, expect, it, vi } from 'vitest'
import {
  BookstoreDirectoryInputError,
  buildBookstoreOverpassQuery,
  fetchBookstoreDirectory,
  parseBookstoreDirectoryQuery,
} from '../../server/bookstoreDirectory'

describe('bookstore directory request boundary', () => {
  it('accepts only canonical area coordinates and the three reader-facing radii', () => {
    expect(parseBookstoreDirectoryQuery({ lat: '44.27', lng: '-121.17', radius: '40000' })).toEqual(
      {
        lat: 44.27,
        lng: -121.17,
        radius: 40_000,
      },
    )
    for (const query of [
      { lat: '44.2726', lng: '-121.17', radius: '40000' },
      { lat: '44.27', lng: ['-121.17'], radius: '40000' },
      { lat: '44.27', lng: '-121.17', radius: '25000' },
      { lat: '91.00', lng: '-121.17', radius: '40000' },
    ]) {
      expect(() => parseBookstoreDirectoryQuery(query)).toThrow(BookstoreDirectoryInputError)
    }
  })

  it('builds one bounded bookstore query rather than forwarding caller query text', () => {
    expect(buildBookstoreOverpassQuery({ lat: 44.27, lng: -121.17, radius: 80_000 })).toBe(
      '[out:json][timeout:20][maxsize:5242880];nwr["shop"="books"](around:80000,44.27,-121.17);out center 1000;',
    )
  })

  it('identifies Reverie and accepts only a shaped JSON response', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(JSON.stringify({ elements: [{ type: 'node', id: 1 }] }), {
        status: 200,
        headers: { 'Content-Type': 'application/json' },
      }),
    )
    await expect(
      fetchBookstoreDirectory(
        { lat: 44.27, lng: -121.17, radius: 40_000 },
        { fetchImpl, endpoints: ['https://overpass.example/api/interpreter'] },
      ),
    ).resolves.toEqual({ elements: [{ type: 'node', id: 1 }] })
    expect(fetchImpl).toHaveBeenCalledWith(
      'https://overpass.example/api/interpreter',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          Referer: 'https://reveriereads.app/indie',
          'User-Agent': expect.stringContaining('reveriereads.app'),
        }),
      }),
    )

    const malformed = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response(JSON.stringify({ remark: 'timed out' }), { status: 200 }))
    await expect(
      fetchBookstoreDirectory(
        { lat: 44.27, lng: -121.17, radius: 40_000 },
        { fetchImpl: malformed, endpoints: ['https://overpass.example/api/interpreter'] },
      ),
    ).rejects.toThrow('malformed')
  })
})
