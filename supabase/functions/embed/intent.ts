/** Bounded, content-only query ranking. No taste centroid, user notes, or inferred metadata. */
export interface IntentRankInput {
  query: string
  items: { key: string; text: string }[]
}
export function parseIntentRankInput(body: unknown): IntentRankInput | null {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return null
  const row = body as Record<string, unknown>
  if (
    typeof row.query !== 'string' ||
    !row.query.trim() ||
    row.query.length > 1200 ||
    !Array.isArray(row.items) ||
    !row.items.length ||
    row.items.length > 12
  )
    return null
  const items: IntentRankInput['items'] = []
  const seen = new Set<string>()
  for (const value of row.items) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return null
    const item = value as Record<string, unknown>
    if (
      typeof item.key !== 'string' ||
      !item.key ||
      item.key.length > 1200 ||
      seen.has(item.key) ||
      typeof item.text !== 'string' ||
      !item.text.trim() ||
      item.text.length > 1600
    )
      return null
    seen.add(item.key)
    items.push({ key: item.key, text: item.text })
  }
  return { query: row.query.trim(), items }
}
export function cosineScore(a: readonly number[], b: readonly number[]): number | null {
  if (!a.length || a.length !== b.length || [...a, ...b].some((n) => !Number.isFinite(n)))
    return null
  const an = Math.hypot(...a),
    bn = Math.hypot(...b)
  if (!an || !bn) return null
  return Math.max(-1, Math.min(1, a.reduce((sum, n, i) => sum + n * b[i]!, 0) / (an * bn)))
}
