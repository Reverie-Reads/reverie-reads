const UNAVAILABLE = 'The account service is unavailable. Please try again.'

/** Gateway responses and transport errors sometimes arrive as an empty JSON message. */
export function readableAuthError(error: unknown): string {
  if (!error || typeof error !== 'object') return UNAVAILABLE
  const { message, status, name } = error as { message?: unknown; status?: unknown; name?: unknown }
  if ((typeof status === 'number' && status >= 500) || name === 'AuthRetryableFetchError')
    return UNAVAILABLE
  if (typeof message !== 'string') return UNAVAILABLE
  const text = message.trim()
  return !text ||
    text === '{}' ||
    text === '[]' ||
    text === '[object Object]' ||
    text.startsWith('<') ||
    text === 'Failed to fetch'
    ? UNAVAILABLE
    : text
}
