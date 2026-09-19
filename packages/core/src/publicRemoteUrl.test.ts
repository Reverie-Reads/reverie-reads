import { describe, expect, it, vi } from 'vitest'
import {
  fetchPublicRemote,
  isPublicIpAddress,
  isTrustedCoverSourceUrl,
  parsePublicRemoteUrl,
  UnsafeRemoteUrlError,
  type RemoteFetcher,
  type ResolveDns,
} from '../../../supabase/functions/_shared/publicRemoteUrl'

const publicResolver: ResolveDns = async (_hostname, recordType) =>
  recordType === 'A' ? ['93.184.216.34'] : []
const allowAll = () => true

describe('public cover URL classification', () => {
  it.each([
    '0.0.0.0',
    '10.0.0.1',
    '100.64.0.1',
    '127.0.0.1',
    '169.254.169.254',
    '172.16.0.1',
    '192.168.1.1',
    '198.18.0.1',
    '224.0.0.1',
    '::',
    '::1',
    '::ffff:127.0.0.1',
    'fc00::1',
    'fe80::1',
    'ff02::1',
    '2001:db8::1',
    '2002:7f00:1::1',
  ])('rejects non-public address %s', (address) => {
    expect(isPublicIpAddress(address)).toBe(false)
  })

  it.each(['1.1.1.1', '8.8.8.8', '2606:4700:4700::1111', '2a00:1450:4009:81d::200e'])(
    'accepts public address %s',
    (address) => {
      expect(isPublicIpAddress(address)).toBe(true)
    },
  )

  it.each([
    'file:///tmp/cover.webp',
    'https://user:secret@example.com/cover.webp',
    'https://example.com:8443/cover.webp',
    'http://localhost/cover.webp',
    'http://metadata.google.internal/cover.webp',
  ])('rejects unsafe URL syntax before resolution: %s', (url) => {
    expect(() => parsePublicRemoteUrl(url)).toThrow(UnsafeRemoteUrlError)
  })
})

describe('public cover fetch boundary', () => {
  it.each([
    'http://127.1/cover.webp',
    'http://2130706433/cover.webp',
    'http://0x7f000001/cover.webp',
    'http://017700000001/cover.webp',
    'http://[::ffff:127.0.0.1]/cover.webp',
  ])('rejects canonicalized numeric loopback %s before fetch', async (url) => {
    const fetcher = vi.fn<RemoteFetcher>()
    await expect(
      fetchPublicRemote(url, {}, { resolveDns: publicResolver, fetcher, isAllowedUrl: allowAll }),
    ).rejects.toMatchObject({ reason: 'non_public_address' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('rejects a hostname when any resolved address is non-public', async () => {
    const resolveDns: ResolveDns = async (_hostname, recordType) =>
      recordType === 'A' ? ['93.184.216.34', '10.0.0.8'] : []
    const fetcher = vi.fn<RemoteFetcher>()
    await expect(
      fetchPublicRemote(
        'https://mixed.example/cover.webp',
        {},
        {
          resolveDns,
          fetcher,
          isAllowedUrl: allowAll,
        },
      ),
    ).rejects.toMatchObject({ reason: 'non_public_address' })
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('blocks a public-to-private redirect before the second request', async () => {
    const fetcher = vi.fn<RemoteFetcher>(
      async () =>
        new Response(null, { status: 302, headers: { Location: 'http://169.254.169.254/latest' } }),
    )
    await expect(
      fetchPublicRemote(
        'https://covers.example/start',
        {},
        { resolveDns: publicResolver, fetcher, isAllowedUrl: allowAll },
      ),
    ).rejects.toMatchObject({ reason: 'non_public_address' })
    expect(fetcher).toHaveBeenCalledTimes(1)
    expect(fetcher.mock.calls[0]?.[1]).toMatchObject({ redirect: 'manual' })
  })

  it('preserves ordinary relative provider redirects and request headers', async () => {
    const fetcher = vi
      .fn<RemoteFetcher>()
      .mockResolvedValueOnce(new Response(null, { status: 302, headers: { Location: '/final' } }))
      .mockResolvedValueOnce(new Response('image', { status: 200 }))
    const result = await fetchPublicRemote(
      'https://covers.example/start',
      { headers: { Accept: 'image/*', 'User-Agent': 'Midniht cover support' } },
      { resolveDns: publicResolver, fetcher, isAllowedUrl: allowAll },
    )
    expect(result.finalUrl).toBe('https://covers.example/final')
    expect(await result.response.text()).toBe('image')
    expect(fetcher).toHaveBeenCalledTimes(2)
    expect(fetcher.mock.calls[1]?.[1]).toMatchObject({
      redirect: 'manual',
      headers: { Accept: 'image/*', 'User-Agent': 'Midniht cover support' },
    })
  })

  it('fails closed when redirect depth exceeds the fixed cap', async () => {
    const fetcher = vi.fn<RemoteFetcher>(
      async () => new Response(null, { status: 302, headers: { Location: '/again' } }),
    )
    await expect(
      fetchPublicRemote(
        'https://covers.example/start',
        {},
        { resolveDns: publicResolver, fetcher, isAllowedUrl: allowAll, maxRedirects: 1 },
      ),
    ).rejects.toMatchObject({ reason: 'too_many_redirects' })
    expect(fetcher).toHaveBeenCalledTimes(2)
  })

  it('fails closed when either DNS-family lookup fails', async () => {
    const resolveDns: ResolveDns = async (_hostname, recordType) => {
      if (recordType === 'AAAA') throw new Error('resolver unavailable')
      return ['93.184.216.34']
    }
    const fetcher = vi.fn<RemoteFetcher>()
    await expect(
      fetchPublicRemote(
        'https://covers.example/cover.webp',
        {},
        {
          resolveDns,
          fetcher,
          isAllowedUrl: allowAll,
        },
      ),
    ).rejects.toThrow('resolver unavailable')
    expect(fetcher).not.toHaveBeenCalled()
  })
})

describe('trusted durable cover origins', () => {
  const project = 'https://project-ref.supabase.co'

  it.each([
    'https://covers.openlibrary.org/b/id/123-L.jpg',
    'https://assets.hardcover.app/editions/123/cover.jpeg',
    'https://archive.org/download/l_covers_0010/file.jpg',
    'https://ia600404.us.archive.org/view_archive.php?archive=x&file=y',
    'https://project-ref.supabase.co/storage/v1/object/public/covers/u/a/b.webp',
  ])('accepts an exact supported origin and path: %s', (raw) => {
    expect(isTrustedCoverSourceUrl(new URL(raw), project)).toBe(true)
  })

  it.each([
    'https://reader-controlled.example/cover.webp',
    'https://covers.openlibrary.org.evil.example/b/id/123-L.jpg',
    'http://covers.openlibrary.org/b/id/123-L.jpg',
    'https://openlibrary.org/search.json',
    'https://archive.org/account/login',
    'https://evil.us.archive.org.example/view_archive.php',
    'https://project-ref.supabase.co/rest/v1/profiles',
    'https://other-project.supabase.co/storage/v1/object/public/covers/u/a/b.webp',
  ])('rejects an arbitrary or out-of-scope destination: %s', (raw) => {
    expect(isTrustedCoverSourceUrl(new URL(raw), project)).toBe(false)
  })

  it('rejects an attacker-controlled hostname before DNS or fetch', async () => {
    const resolveDns = vi.fn<ResolveDns>(publicResolver)
    const fetcher = vi.fn<RemoteFetcher>()
    await expect(
      fetchPublicRemote(
        'https://reader-controlled.example/cover.webp',
        {},
        {
          resolveDns,
          fetcher,
          isAllowedUrl: (url) => isTrustedCoverSourceUrl(url, project),
        },
      ),
    ).rejects.toMatchObject({ reason: 'host_not_allowed' })
    expect(resolveDns).not.toHaveBeenCalled()
    expect(fetcher).not.toHaveBeenCalled()
  })

  it('permits the complete Open Library redirect chain but no untrusted terminal hop', async () => {
    const fetcher = vi
      .fn<RemoteFetcher>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://archive.org/download/l_covers_0010/file.jpg' },
        }),
      )
      .mockResolvedValueOnce(
        new Response(null, {
          status: 302,
          headers: { Location: 'https://ia600404.us.archive.org/view_archive.php?file=x' },
        }),
      )
      .mockResolvedValueOnce(new Response('image', { status: 200 }))
    const result = await fetchPublicRemote(
      'https://covers.openlibrary.org/b/id/123-L.jpg',
      {},
      {
        resolveDns: publicResolver,
        fetcher,
        isAllowedUrl: (url) => isTrustedCoverSourceUrl(url, project),
      },
    )
    expect(await result.response.text()).toBe('image')
    expect(fetcher).toHaveBeenCalledTimes(3)
  })

  it('stops a trusted provider redirect before an untrusted second request', async () => {
    const fetcher = vi.fn<RemoteFetcher>(
      async () =>
        new Response(null, {
          status: 302,
          headers: { Location: 'https://reader-controlled.example/private' },
        }),
    )
    await expect(
      fetchPublicRemote(
        'https://covers.openlibrary.org/b/id/123-L.jpg',
        {},
        {
          resolveDns: publicResolver,
          fetcher,
          isAllowedUrl: (url) => isTrustedCoverSourceUrl(url, project),
        },
      ),
    ).rejects.toMatchObject({ reason: 'host_not_allowed' })
    expect(fetcher).toHaveBeenCalledTimes(1)
  })
})
