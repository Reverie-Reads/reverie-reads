// @vitest-environment node
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const processMock = vi.hoisted(() => ({ execFile: vi.fn(), execFileSync: vi.fn() }))
vi.mock('node:child_process', () => processMock)

import { localAdminKey, localDatabaseTime } from '../../e2e/support/localSupabase'

type Completion = (error: Error | null, stdout: string, stderr: string) => void

beforeEach(() => vi.resetAllMocks())
afterEach(() => vi.useRealTimers())

describe('local database browser-test clock', () => {
  it('uses an asynchronous bounded process and leaves event-loop work runnable while stalled', async () => {
    vi.useFakeTimers()
    processMock.execFile.mockImplementation(
      (_file: string, _args: string[], options: { timeout: number }, complete: Completion) => {
        setTimeout(
          () => complete(new Error('private child stderr'), 'private stdout', 'private stderr'),
          options.timeout,
        )
      },
    )
    let settled = false
    const result = localDatabaseTime().catch((error: unknown) => {
      settled = true
      return error
    })
    const independentWork = vi.fn()
    setTimeout(independentWork, 0)
    await vi.advanceTimersByTimeAsync(0)
    expect(independentWork).toHaveBeenCalledOnce()
    expect(settled).toBe(false)
    expect(processMock.execFileSync).not.toHaveBeenCalled()
    expect(processMock.execFile).toHaveBeenCalledExactlyOnceWith(
      'docker',
      [
        'exec',
        'supabase_db_book-corpus',
        'psql',
        '-U',
        'postgres',
        '-d',
        'postgres',
        '-Atc',
        'select floor(extract(epoch from clock_timestamp()) * 1000)::bigint',
      ],
      { encoding: 'utf8', timeout: 10_000, killSignal: 'SIGKILL', maxBuffer: 1024 },
      expect.any(Function),
    )
    await vi.advanceTimersByTimeAsync(9999)
    expect(settled).toBe(false)
    await vi.advanceTimersByTimeAsync(1)
    const error = await result
    expect(error).toBeInstanceOf(Error)
    expect(String(error)).toBe(
      'Error: Could not read local database time within the bounded clock check',
    )
    expect(error).not.toHaveProperty('cause')
    expect(JSON.stringify(error)).not.toContain('private')
    expect(processMock.execFile).toHaveBeenCalledTimes(1)
  })

  it('accepts one positive millisecond timestamp with psql whitespace', async () => {
    processMock.execFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, complete: Completion) =>
        complete(null, ' 1792324800000\n', ''),
    )
    await expect(localDatabaseTime()).resolves.toBe(1792324800000)
  })

  it.each([
    '',
    '\n  ',
    '0',
    '-1',
    '1.5',
    '1e12',
    'NaN',
    'Infinity',
    '9007199254740992',
    '8640000000000001',
    '1792324800000\n1792324800001',
    'private malformed output',
  ])('rejects invalid clock output without falling back or echoing it: %j', async (output) => {
    processMock.execFile.mockImplementation(
      (_file: string, _args: string[], _options: unknown, complete: Completion) =>
        complete(null, output, 'private stderr'),
    )
    await expect(localDatabaseTime()).rejects.toThrow(
      /^Local database clock returned an invalid timestamp$/,
    )
    expect(processMock.execFile).toHaveBeenCalledTimes(1)
  })

  it('sanitizes synchronous spawn failures as well as callback failures', async () => {
    processMock.execFile.mockImplementation(() => {
      throw Object.assign(new Error('secret environment detail'), { stderr: 'secret token' })
    })
    await expect(localDatabaseTime()).rejects.toThrow(
      /^Could not read local database time within the bounded clock check$/,
    )
    expect(processMock.execFile).toHaveBeenCalledTimes(1)
  })
})

describe('existing local administrator-key selection', () => {
  it.each([
    [{ SECRET_KEY: 'new-key', SERVICE_ROLE_KEY: 'old-key' }, 'new-key'],
    [{ SERVICE_ROLE_KEY: 'old-key' }, 'old-key'],
  ])('preserves credential preference while bounding local CLI execution', (status, expected) => {
    processMock.execFileSync.mockReturnValue(JSON.stringify(status))
    expect(localAdminKey()).toBe(expected)
    expect(processMock.execFileSync).toHaveBeenCalledExactlyOnceWith(
      'supabase',
      ['status', '-o', 'json'],
      {
        encoding: 'utf8',
        stdio: ['ignore', 'pipe', 'ignore'],
        timeout: 15_000,
        killSignal: 'SIGKILL',
      },
    )
  })
  it('retains a visible failure when no administrator credential exists', () => {
    processMock.execFileSync.mockReturnValue('{}')
    expect(() => localAdminKey()).toThrow('Local Supabase did not report an administrator key')
  })
})
