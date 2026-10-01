import { useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { APP_NAME, readProductPreferences, type ProductPreferences } from '@reverie/core'
import { fetchProductPreferences, saveProductPreferences } from '../data/productPreferences'
import { profileKey } from '../data/profile'
import { Button } from '../components/Button'
import { BrandAtmosphere } from '../auth/BrandAtmosphere'
import { Wordmark } from '../auth/Wordmark'
import { registeredProducts, type ProductRegistration } from './registry'

type Snapshot = Awaited<ReturnType<typeof fetchProductPreferences>>

/** Mount keyed by account. No automatic selection, background save, or conflict rebase. Entry is
 * explicit for now; the existing auth/guest/welcome journey stays intact during staged rollout.
 */
export function ProductEntry({
  actorId,
  signOut,
}: {
  actorId: string
  signOut: () => Promise<void>
}) {
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [snapshot, setSnapshot] = useState<Snapshot | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<'load' | 'save' | 'conflict' | null>(null)
  const [saving, setSaving] = useState(false)
  const [attempt, setAttempt] = useState(0)
  const live = useRef(false)
  const busy = useRef(false)
  const products = registeredProducts()

  useEffect(() => {
    live.current = true
    let current = true
    setLoading(true)
    setSnapshot(null)
    setError(null)
    void fetchProductPreferences(actorId)
      .then((value) => {
        if (current) setSnapshot(value)
      })
      .catch(() => {
        if (current) setError('load')
      })
      .finally(() => {
        if (current) setLoading(false)
      })
    return () => {
      current = false
      live.current = false
    }
  }, [actorId, attempt])

  const read = snapshot ? readProductPreferences(snapshot.document) : null
  const unsupported = read?.kind === 'unsupported' || read?.kind === 'invalid'
  const unavailable =
    read?.kind === 'supported' && !products.some((p) => p.id === read.document.activeProduct)

  const open = (product: ProductRegistration) => void navigate({ to: product.homePath })
  const choose = async (product: ProductRegistration) => {
    if (busy.current || !snapshot || loading || unsupported || error === 'conflict') return
    if (
      read?.kind === 'supported' &&
      read.document.initialChoiceComplete &&
      read.document.activeProduct === product.id
    ) {
      open(product)
      return
    }
    const document: ProductPreferences =
      read?.kind === 'supported'
        ? {
            ...read.document,
            enabledProducts: [...new Set([...read.document.enabledProducts, product.id])],
            activeProduct: product.id,
            initialChoiceComplete: true,
          }
        : {
            version: 1,
            enabledProducts: [product.id],
            activeProduct: product.id,
            initialChoiceComplete: true,
            presentation: {},
          }
    busy.current = true
    setSaving(true)
    setError(null)
    try {
      await saveProductPreferences(actorId, snapshot.revision, document)
      if (!live.current) return
      void qc.invalidateQueries({ queryKey: profileKey })
      open(product)
    } catch (err) {
      if (live.current) setError((err as { code?: string })?.code === 'PT409' ? 'conflict' : 'save')
    } finally {
      busy.current = false
      if (live.current) setSaving(false)
    }
  }

  return (
    <div className="gold-brand relative min-h-dvh px-5 py-12">
      <BrandAtmosphere />
      <main
        className="relative z-[1] mx-auto flex w-full max-w-xl flex-col gap-6"
        aria-busy={loading || saving}
      >
        <Wordmark />
        <h1
          className="text-[clamp(2rem,8vw,3rem)] leading-tight text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Your {APP_NAME} experience
        </h1>
        {loading ? (
          <p role="status" className="text-muted">
            Loading your saved choice…
          </p>
        ) : (
          <>
            <p className="text-[15px] leading-relaxed text-muted">
              One account, one personal library. Choose where to settle in.
            </p>
            {unavailable && (
              <p role="status" className="text-[15px] leading-relaxed text-ink">
                Your saved Collector experience isn’t available in this version. Your choice and
                collection data are unchanged.
              </p>
            )}
            {unsupported && (
              <p role="status" className="text-[15px] leading-relaxed text-ink">
                This version can’t edit your saved choices. They will stay intact. You can still
                open Reader for now.
              </p>
            )}
            {error && (
              <div
                role="alert"
                className="flex flex-col items-start gap-3 text-[15px] leading-relaxed text-ink"
              >
                <p>
                  {error === 'load'
                    ? 'We couldn’t load your saved choices. Your library is unchanged.'
                    : error === 'conflict'
                      ? 'Your choices changed in another window or device. Load those choices before deciding again.'
                      : 'We couldn’t confirm your choice was saved. Try the same choice again; your library is unchanged.'}
                </p>
                {(error === 'load' || error === 'conflict') && (
                  <Button variant="secondary" onClick={() => setAttempt((n) => n + 1)}>
                    {error === 'conflict' ? 'Load current choices' : 'Try again'}
                  </Button>
                )}
              </div>
            )}
            {!unsupported &&
              snapshot &&
              products.map((product) => (
                <section key={product.id} className="rounded-2xl border border-line bg-card p-6">
                  <h2
                    className="text-2xl leading-tight text-ink"
                    style={{ fontFamily: 'var(--font-display)' }}
                  >
                    {product.name}
                  </h2>
                  <p className="mb-5 mt-3 text-[15px] leading-relaxed text-muted">
                    {product.description}
                  </p>
                  <Button
                    disabled={saving || error === 'conflict'}
                    onClick={() => void choose(product)}
                  >
                    {saving
                      ? 'Saving…'
                      : read?.kind === 'supported' &&
                          read.document.activeProduct === product.id &&
                          read.document.initialChoiceComplete
                        ? `Open ${product.id === 'reader' ? 'Reader' : 'Collector'}`
                        : `Use ${product.id === 'reader' ? 'Reader' : 'Collector'}`}
                  </Button>
                </section>
              ))}
            {(unsupported || unavailable || error === 'load') && (
              <Button
                variant="secondary"
                disabled={saving}
                onClick={() => open(products.find((p) => p.id === 'reader')!)}
              >
                Open Reader for now
              </Button>
            )}
            {(unavailable || error === 'load') && (
              <p className="text-[13px] leading-relaxed text-muted">
                Opening Reader for now does not change your saved choice.
              </p>
            )}
          </>
        )}
        <div className="flex flex-wrap gap-3">
          <Button
            variant="ghost"
            disabled={saving}
            onClick={() => void navigate({ to: '/settings' })}
          >
            Back to Settings
          </Button>
          <Button variant="ghost" disabled={saving} onClick={() => void signOut()}>
            Sign out
          </Button>
        </div>
      </main>
    </div>
  )
}
