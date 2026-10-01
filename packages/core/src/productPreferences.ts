/** Portable presentation only. These values never prove paid access or workspace membership. */
export type ProductId = 'reader' | 'collector'
type Json = null | boolean | number | string | Json[] | { [key: string]: Json }
export interface ProductPreferences {
  version: 1
  enabledProducts: ProductId[]
  activeProduct: ProductId
  initialChoiceComplete: boolean
  /** Opaque versioned documents: never pass these through the Reader arrangement parser. */
  presentation: Partial<Record<ProductId, { version: number; [key: string]: Json }>>
}
export type ProductPreferencesRead =
  | { kind: 'unconfigured' }
  | { kind: 'supported'; document: ProductPreferences }
  | { kind: 'unsupported' }
  | { kind: 'invalid' }

function record(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
}
function json(value: unknown, depth = 0): boolean {
  if (depth > 16) return false
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return true
  if (typeof value === 'number') return Number.isFinite(value)
  if (Array.isArray(value)) return value.every((item) => json(item, depth + 1))
  return (
    record(value) &&
    Object.entries(value).every(
      ([key, item]) =>
        !['__proto__', 'constructor', 'prototype'].includes(key) && json(item, depth + 1),
    )
  )
}
const product = (value: unknown): value is ProductId => value === 'reader' || value === 'collector'

/** Inspect without normalizing. Keep the original raw value for readback/export, even if newer. */
export function readProductPreferences(value: unknown): ProductPreferencesRead {
  if (value === null || value === undefined) return { kind: 'unconfigured' }
  if (
    !record(value) ||
    !json(value) ||
    new TextEncoder().encode(JSON.stringify(value)).length > 8192
  )
    return { kind: 'invalid' }
  if (!Number.isSafeInteger(value.version) || (value.version as number) < 1)
    return { kind: 'invalid' }
  if (value.version !== 1) return { kind: 'unsupported' }
  const keys = [
    'version',
    'enabledProducts',
    'activeProduct',
    'initialChoiceComplete',
    'presentation',
  ]
  if (
    Object.keys(value).length !== keys.length ||
    !keys.every((key) => key in value) ||
    !Array.isArray(value.enabledProducts) ||
    value.enabledProducts.length === 0 ||
    new Set(value.enabledProducts).size !== value.enabledProducts.length ||
    typeof value.initialChoiceComplete !== 'boolean' ||
    !record(value.presentation)
  )
    return { kind: 'invalid' }
  if (
    !value.enabledProducts.every((item) => typeof item === 'string') ||
    typeof value.activeProduct !== 'string'
  )
    return { kind: 'invalid' }
  if (!value.enabledProducts.includes(value.activeProduct)) return { kind: 'invalid' }
  if (
    !value.enabledProducts.every(product) ||
    !product(value.activeProduct) ||
    !Object.keys(value.presentation).every(product)
  )
    return { kind: 'unsupported' }
  if (
    !Object.values(value.presentation).every(
      (item) => record(item) && Number.isSafeInteger(item.version) && (item.version as number) > 0,
    )
  )
    return { kind: 'invalid' }
  return { kind: 'supported', document: value as unknown as ProductPreferences }
}
