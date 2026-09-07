import { fetchJson, sleep } from '../http.mjs'
import { rankWorkCandidate } from '../normalize.mjs'

const numeric = (value) => {
  const parsed = Number(value)
  return Number.isFinite(parsed) ? parsed : null
}

export const googleBooks = {
  name: 'google-books',
  rights: {
    commercialUsePermitted: true,
    persistentStoragePermitted: false,
    claimLevelProvenance: true,
    note: 'Google API terms restrict permanent copying and database construction.',
  },
  async run(cases, progress = () => {}) {
    const apiKey =
      process.env.GOOGLE_BOOKS_KEY ??
      process.env.GOOGLE_BOOKS_API_KEY ??
      process.env.VITE_GOOGLE_BOOKS_KEY ??
      ''
    const referrer = process.env.GOOGLE_BOOKS_REFERRER ?? ''
    const configuredDelayMs = Number(process.env.GOOGLE_BOOKS_DELAY_MS ?? 1100)
    const delayMs = Number.isFinite(configuredDelayMs) ? Math.max(0, configuredDelayMs) : 1100
    const configuredConcurrency = Number(process.env.GOOGLE_BOOKS_CONCURRENCY ?? 4)
    const concurrency = Number.isFinite(configuredConcurrency)
      ? Math.max(1, Math.min(4, Math.floor(configuredConcurrency)))
      : 4
    const configuredCooldownMs = Number(process.env.GOOGLE_BOOKS_429_COOLDOWN_MS ?? 15_000)
    const cooldownMs = Number.isFinite(configuredCooldownMs)
      ? Math.max(0, configuredCooldownMs)
      : 15_000
    const results = Array(cases.length)
    let nextIndex = 0
    let completed = 0
    let nextRequestAt = Date.now()
    let quotaNotBefore = 0
    let requestStartGate = Promise.resolve()

    const waitForRequestSlot = () => {
      const turn = requestStartGate.then(async () => {
        while (true) {
          const now = Date.now()
          const startAt = Math.max(now, nextRequestAt, quotaNotBefore)
          if (startAt > now) await sleep(startAt - now)
          if (Date.now() < quotaNotBefore) continue
          nextRequestAt = Date.now() + delayMs
          return
        }
      })
      requestStartGate = turn
      return turn
    }

    const fetchGoogle = async (url, options) => {
      const maximumAttempts = 4
      for (let attempt = 0; attempt < maximumAttempts; attempt += 1) {
        await waitForRequestSlot()
        try {
          return await fetchJson(url, options, 1)
        } catch (error) {
          if (error?.status !== 429 || attempt === maximumAttempts - 1) throw error
          quotaNotBefore = Math.max(
            quotaNotBefore,
            Date.now() + Math.max(error.retryAfterMs ?? 0, cooldownMs),
          )
        }
      }
      throw new Error('Google Books request attempts exhausted')
    }

    async function worker() {
      while (nextIndex < cases.length) {
        const index = nextIndex
        nextIndex += 1
        const testCase = cases[index]
        const query = `intitle:"${testCase.title}" inauthor:"${testCase.authors[0] ?? ''}"`
        const params = new URLSearchParams({ q: query, maxResults: '5', projection: 'full' })
        if (apiKey) params.set('key', apiKey)

        try {
          const headers = referrer ? { Referer: referrer, Origin: referrer } : {}
          const { body, latencyMs } = await fetchGoogle(
            `https://www.googleapis.com/books/v1/volumes?${params}`,
            { headers },
          )
          const ranked = (body.items ?? [])
            .map((item) => ({
              item,
              ranking: rankWorkCandidate(
                testCase,
                item.volumeInfo?.title,
                item.volumeInfo?.authors ?? [],
              ),
            }))
            .sort((left, right) => right.ranking.score - left.ranking.score)
          const best = ranked[0]
          const matched = Boolean(best?.ranking.acceptable)
          const info = matched ? (best.item.volumeInfo?.seriesInfo ?? best.item.seriesInfo) : null
          const series = Array.isArray(info?.volumeSeries) ? info.volumeSeries : []
          results[index] = {
            caseId: testCase.id,
            latencyMs,
            workMatch: {
              matched,
              confidence: matched ? 'high' : 'none',
              providerWorkId: matched ? best.item.id : null,
              matchedTitle: matched ? best.item.volumeInfo?.title : null,
              matchedAuthors: matched ? (best.item.volumeInfo?.authors ?? []) : [],
            },
            seriesClaims: series.map((entry) => ({
              evidenceKind: entry.seriesId ? 'opaque_series_relation' : 'candidate_label',
              providerSeriesId: entry.seriesId ?? null,
              series: null,
              position: numeric(entry.orderNumber ?? info.bookDisplayNumber),
              orderType: 'unspecified',
              role: entry.seriesBookType ?? 'unknown',
              sourceRef: matched
                ? `https://books.google.com/books?id=${encodeURIComponent(best.item.id)}`
                : null,
            })),
          }
        } catch (error) {
          results[index] = {
            caseId: testCase.id,
            latencyMs: null,
            workMatch: { matched: false, confidence: 'none' },
            seriesClaims: [],
            error: String(error),
          }
        }

        completed += 1
        if (completed % 10 === 0 || completed === cases.length) {
          progress(`google-books ${completed}/${cases.length}`)
        }
      }
    }

    await Promise.all(Array.from({ length: concurrency }, () => worker()))
    return results
  },
}
