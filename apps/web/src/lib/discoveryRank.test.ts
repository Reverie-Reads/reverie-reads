import { describe, expect, it } from 'vitest'
import { cosineScore, parseIntentRankInput } from '../../../../supabase/functions/embed/intent'

describe('authenticated intent ranking input', () => {
  const valid = {
    query: 'A reflective adventure',
    items: [{ key: 'work:one', text: 'A contemplative journey.' }],
  }
  it('accepts bounded content and rejects duplicated, oversized, or malformed candidates', () => {
    expect(parseIntentRankInput(valid)).toEqual(valid)
    expect(parseIntentRankInput({ ...valid, query: 'x'.repeat(1201) })).toBeNull()
    expect(parseIntentRankInput({ ...valid, items: [valid.items[0], valid.items[0]] })).toBeNull()
    expect(
      parseIntentRankInput({ ...valid, items: [{ key: 'one', text: 'x'.repeat(1601) }] }),
    ).toBeNull()
    expect(
      parseIntentRankInput({
        ...valid,
        items: Array.from({ length: 13 }, (_, i) => ({ key: String(i), text: 'book' })),
      }),
    ).toBeNull()
    expect(parseIntentRankInput({ ...valid, query: { toString: () => 'query' } })).toBeNull()
  })
  it('normalizes both vectors and rejects invalid model outputs', () => {
    expect(cosineScore([2, 0], [3, 0])).toBe(1)
    expect(cosineScore([1, 0], [0, 1])).toBe(0)
    expect(cosineScore([0, 0], [1, 0])).toBeNull()
    expect(cosineScore([1, 0], [1])).toBeNull()
    expect(cosineScore([1, NaN], [1, 0])).toBeNull()
  })
})
