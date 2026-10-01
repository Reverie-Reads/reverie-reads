import { APP_NAME, type ProductId } from '@reverie/core'

/** Build registration, never entitlement. Register only delivered routes before rendering the app.
 * This registry is the shared extension contract: private implementations register here after
 * their minimum Free journey is usable. Reader navigation/guidance remain in their existing shell.
 */
export interface ProductRegistration {
  id: ProductId
  name: string
  description: string
  homePath: string
}
const reader: ProductRegistration = Object.freeze({
  id: 'reader',
  name: `${APP_NAME} Reader`,
  description:
    'Keep your books close. Choose a next read, plan a little, and remember what stays with you.',
  homePath: '/',
})
const products = new Map<ProductId, ProductRegistration>([['reader', reader]])

export function registeredProducts(): readonly ProductRegistration[] {
  return [...products.values()]
}

/** Declared registry seam; registering a product is a build decision, never a profile write. */
export function registerProduct(product: ProductRegistration): () => void {
  if (
    product.id !== 'collector' ||
    products.has(product.id) ||
    !/^\/[a-z][a-z0-9/-]*$/.test(product.homePath) ||
    !product.name.trim() ||
    !product.description.trim()
  )
    throw new Error('Invalid or duplicate product registration')
  const entry = Object.freeze({ ...product })
  products.set(entry.id, entry)
  return () => {
    if (products.get(entry.id) === entry) products.delete(entry.id)
  }
}
