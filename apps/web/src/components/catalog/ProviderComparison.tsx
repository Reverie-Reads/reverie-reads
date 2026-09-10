import { useEffect, useRef, useState } from 'react'
import {
  projectProviderComparison,
  PROVIDER_COMPARISON_MESSAGES,
  validProviderComparisonContext,
  type ProviderComparisonContext,
  type ProviderComparisonView,
} from '@reverie/core'
import { Button } from '../Button'

interface Props {
  // The eventual caller must obtain complete/unique identity and current permission from the
  // server, not infer them from the displayed author string or the first ISBN. Null fails closed.
  context: ProviderComparisonContext | null
  accountId: string | null
  permission: 'confirmed' | 'unknown' | 'denied'
  permissionEpoch: string
  online: boolean
  sharedPages: number | null
  // Required injection: this draft has no default transport, production import, or route action.
  // Only synthetic tests supply it until the separate live-adapter/policy gate is cleared.
  load: (context: ProviderComparisonContext, signal: AbortSignal) => Promise<unknown>
}

export function ProviderComparison(props: Props) {
  const { context, accountId, permission, online, permissionEpoch } = props
  if (!accountId || permission !== 'confirmed' || !online) return null
  if (!context || !validProviderComparisonContext(context))
    return (
      <p className="text-sm text-muted">
        Choose a valid, uniquely assigned ISBN with complete title and author identity before
        comparing.
      </p>
    )
  // Keying the owner removes old values in the same render, before effects or late promises.
  return (
    <ComparisonSession
      {...props}
      context={context}
      key={JSON.stringify([
        accountId,
        context.workId,
        context.isbn,
        context.fingerprint,
        context.revision,
        permissionEpoch,
        props.sharedPages,
      ])}
    />
  )
}

function ComparisonSession({
  context,
  sharedPages,
  load,
}: Props & { context: ProviderComparisonContext }) {
  const [view, setView] = useState<ProviderComparisonView | null>(null)
  const [state, setState] = useState<'idle' | 'loading' | 'ready' | 'expired' | 'failed' | 'check'>(
    'idle',
  )
  const flight = useRef<AbortController | null>(null)
  const mounted = useRef(true)
  const needsCheck = useRef(false)
  const requestTimer = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    mounted.current = true
    const discard = () => {
      needsCheck.current = true
      flight.current?.abort()
      flight.current = null
      if (requestTimer.current) clearTimeout(requestTimer.current)
      setView(null)
      setState('check')
    }
    const onVisibility = () => {
      if (document.visibilityState === 'hidden') discard()
    }
    window.addEventListener('blur', discard)
    window.addEventListener('pagehide', discard)
    window.addEventListener('offline', discard)
    document.addEventListener('visibilitychange', onVisibility)
    return () => {
      mounted.current = false
      flight.current?.abort()
      flight.current = null
      if (requestTimer.current) clearTimeout(requestTimer.current)
      window.removeEventListener('blur', discard)
      window.removeEventListener('pagehide', discard)
      window.removeEventListener('offline', discard)
      document.removeEventListener('visibilitychange', onVisibility)
    }
  }, [])

  useEffect(() => {
    if (!view) return
    const timer = setTimeout(
      () => {
        setView(null)
        setState('expired')
      },
      Math.max(0, Date.parse(view.expiresAt) - Date.now()),
    )
    return () => clearTimeout(timer)
  }, [view])

  async function compare() {
    if (
      flight.current ||
      needsCheck.current ||
      document.visibilityState === 'hidden' ||
      !navigator.onLine
    )
      return
    const controller = new AbortController()
    flight.current = controller
    setView(null)
    setState('loading')
    requestTimer.current = setTimeout(() => {
      controller.abort()
      if (mounted.current && flight.current === controller) {
        flight.current = null
        setView(null)
        setState('failed')
      }
    }, 30000)
    try {
      // Never pass account IDs, drafts, model output, reference answers, or arbitrary URLs.
      const response = await load(
        {
          workId: context.workId,
          isbn: context.isbn,
          fingerprint: context.fingerprint,
          revision: context.revision,
        },
        controller.signal,
      )
      if (!mounted.current || controller.signal.aborted || flight.current !== controller) return
      const next = projectProviderComparison(response, context, Date.now())
      setView(next)
      setState(next ? 'ready' : 'failed')
    } catch {
      // Error bodies can contain provider text/credentials. Do not render, log, or report them.
      if (mounted.current && !controller.signal.aborted && flight.current === controller) {
        setView(null)
        setState('failed')
      }
    } finally {
      if (flight.current === controller) {
        flight.current = null
        if (requestTimer.current) clearTimeout(requestTimer.current)
      }
    }
  }

  // Re-check time at every render too; a throttled timer must not resurrect an expired result.
  const visible = view && Date.parse(view.expiresAt) > Date.now() ? view : null
  const shared =
    Number.isInteger(sharedPages) && sharedPages !== null && sharedPages > 0 && sharedPages <= 20000
      ? sharedPages
      : 'Unknown'
  return (
    <section
      aria-label="Compare provider evidence"
      className="skin-card min-w-0 border border-line p-4 text-ink sm:p-6"
      style={{ background: 'var(--card-solid)' }}
    >
      <h3 className="text-lg font-semibold">Compare provider evidence</h3>
      <p className="mt-2 text-sm leading-relaxed text-muted">
        Compare one edition. Provider details are observations, not saved catalog changes.
      </p>
      <p className="mt-3 break-all text-sm">Selected ISBN: {context.isbn}</p>
      <p className="mt-2 text-sm">Shared record pages: {shared}. Edition not established.</p>
      <Button
        type="button"
        variant="secondary"
        className="mt-4"
        disabled={state === 'loading' || state === 'check'}
        onClick={() => void compare()}
      >
        {state === 'loading' ? 'Comparing edition…' : 'Compare selected edition'}
      </Button>
      <p role="status" className="mt-3 text-sm leading-relaxed">
        {visible
          ? PROVIDER_COMPARISON_MESSAGES[visible.joint]
          : state === 'loading'
            ? 'Checking this edition. No changes made.'
            : state === 'check'
              ? 'Comparison cleared. Permission and catalog context must be checked again before comparing.'
              : state === 'failed'
                ? 'Comparison unavailable or invalid. No changes made.'
                : state === 'expired' || state === 'ready'
                  ? 'Comparison expired. Compare again for fresh observations.'
                  : 'No comparison requested.'}
      </p>
      {visible && (
        <>
          <ul aria-label="Provider observations" className="mt-4 grid min-w-0 gap-3 sm:grid-cols-2">
            {visible.cards.map((card) => (
              <li key={card.provider} className="skin-tile min-w-0 border border-line p-3 text-sm">
                <h4 className="font-semibold">{card.name}</h4>
                <p className="mt-2 leading-relaxed">{card.status}</p>
                <p className="mt-2 break-all">ISBN: {visible.isbn}</p>
                <p className="mt-2">
                  Pages:{' '}
                  {card.pageState === 'observed'
                    ? card.pages
                    : card.pageState === 'not_applicable'
                      ? 'Not applicable to audio'
                      : card.pageState === 'not_comparable'
                        ? 'Not comparable across formats'
                        : card.pageState === 'withheld'
                          ? 'Withheld'
                          : 'Unknown'}
                </p>
                <p className="mt-1">
                  Binding: {card.language === null ? 'Withheld' : (card.binding ?? 'Unknown')}
                </p>
                <p className="mt-1">
                  Language check:{' '}
                  {card.language === null
                    ? 'Withheld'
                    : card.language === 'unknown'
                      ? 'Unknown'
                      : 'Matched'}
                </p>
                <p className="mt-2 break-words text-muted">
                  Observed:{' '}
                  <time dateTime={card.observedAt}>
                    {new Date(card.observedAt).toLocaleString()}
                  </time>
                </p>
                {card.sourceUrl && (
                  <a
                    href={card.sourceUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    referrerPolicy="no-referrer"
                    className="skin-control mt-2 inline-flex min-h-11 items-center underline"
                  >
                    Open {card.name} record
                  </a>
                )}
              </li>
            ))}
          </ul>
          <p className="mt-3 text-sm text-muted">
            Read-only comparison. No values are applied or saved. Observations clear when this view
            expires or loses focus.
          </p>
        </>
      )}
    </section>
  )
}
