import { performance } from 'node:perf_hooks'

const sleep = (milliseconds) => new Promise((resolve) => setTimeout(resolve, milliseconds))

export { sleep }

export async function fetchJson(url, options = {}, retries = 3) {
  let lastError
  for (let attempt = 0; attempt < retries; attempt += 1) {
    const started = performance.now()
    try {
      const timeoutMs = Number(process.env.TRIAL_HTTP_TIMEOUT_MS ?? 15_000)
      const response = await fetch(url, {
        ...options,
        signal: options.signal ?? AbortSignal.timeout(timeoutMs),
      })
      const latencyMs = Math.round(performance.now() - started)
      if (response.ok) return { body: await response.json(), latencyMs }
      const failureBody = await response.json().catch(() => null)
      const reason = failureBody?.error?.errors?.[0]?.reason ?? failureBody?.error?.status ?? null
      const responseError = new Error(
        `${response.status} ${response.statusText}${reason ? ` (${reason})` : ''}`,
      )
      responseError.status = response.status
      responseError.reason = reason
      if (response.status !== 429 && response.status < 500) {
        responseError.retryable = false
        throw responseError
      }
      const retryAfter = Number(response.headers.get('retry-after'))
      responseError.retryAfterMs = Number.isFinite(retryAfter) ? retryAfter * 1000 : null
      if (attempt < retries - 1) {
        await sleep(responseError.retryAfterMs ?? 750 * 2 ** attempt)
      }
      lastError = responseError
    } catch (error) {
      if (error?.retryable === false) throw error
      lastError = error
      if (attempt < retries - 1) await sleep(750 * 2 ** attempt)
    }
  }
  throw lastError
}
