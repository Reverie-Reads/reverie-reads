/** Parse a deliberate progress entry without silently rounding or clamping it. */
export function parseProgress(value: string): number | null {
  const trimmed = value.trim()
  if (!/^\d+$/.test(trimmed)) return null
  const progress = Number(trimmed)
  return Number.isInteger(progress) && progress >= 0 && progress <= 100 ? progress : null
}
