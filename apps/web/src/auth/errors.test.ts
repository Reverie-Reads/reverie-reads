import { describe, expect, it } from 'vitest'
import { readableAuthError } from './errors'

describe('account error messages', () => {
  it.each([
    null,
    {},
    { message: '{}' },
    { message: '<html>Gateway timeout</html>', status: 504 },
    { message: 'fetch failed', name: 'AuthRetryableFetchError' },
    new TypeError('Failed to fetch'),
  ])('explains an unavailable service without displaying an opaque response: %j', (error) => {
    expect(readableAuthError(error)).toBe('The account service is unavailable. Please try again.')
  })
  it('keeps a useful account validation message', () => {
    expect(readableAuthError({ message: 'Invalid login credentials', status: 400 })).toBe(
      'Invalid login credentials',
    )
  })
})
