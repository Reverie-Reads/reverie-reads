import { beforeEach, expect, it, vi } from 'vitest'
import { supabase } from './supabase'
import { enrichBookOutcome } from './enrich'
vi.mock('./supabase', () => ({ supabase: { functions: { invoke: vi.fn() } } }))
beforeEach(() => vi.resetAllMocks())
it.each([
  [
    { admissionVersion: 2, sourcesFailed: true, identityUnresolved: true },
    'failed',
    'identity_hold',
  ],
  [{ admissionVersion: 2, sourcesFailed: true }, 'failed', undefined],
  [{ admissionVersion: 1, confidence: 'none' }, 'failed', 'service_mismatch'],
  [
    { admissionVersion: 2, confidence: 'none', identityUnresolved: true },
    'failed',
    'identity_hold',
  ],
  [{ admissionVersion: 2, confidence: 'none' }, 'empty', undefined],
] as const)(
  'keeps diagnostic causes distinct without changing outcome routing',
  async (data, status, kind) => {
    vi.mocked(supabase.functions.invoke).mockResolvedValue({ data, error: null })
    const result = await enrichBookOutcome({ isbn: '9780306406157' })
    expect(result.status).toBe(status)
    expect('kind' in result ? result.kind : undefined).toBe(kind)
  },
)
