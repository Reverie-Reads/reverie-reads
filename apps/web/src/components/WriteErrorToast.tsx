import { dismissWriteError, useWriteErrors } from '../lib/writeErrors'

/**
 * Tells the reader when a save didn't land — accent-bordered rather than the gold gradient, because
 * this is a thing that went wrong, not an invitation.
 *
 * `role="alert"` so it's announced: a failed write that only appears visually is barely better than
 * the silence it replaces.
 *
 * Anchored TOP, unlike UpdateToast. It has to outrank open dialogs (z-50) — a cover-sheet failure
 * happens while its sheet is open and would otherwise go unseen — but a bottom-anchored overlay at
 * that depth sits exactly on top of every dialog's action row and swallows the clicks. Top, plus a
 * click-through container with only the card itself interactive, keeps it visible without ever
 * standing between the reader and a button.
 */
export function WriteErrorToast() {
  const errors = useWriteErrors()
  if (!errors.length) return null

  return (
    <div
      role="alert"
      aria-live="assertive"
      className="pointer-events-none fixed inset-x-0 z-[60] flex flex-col items-center gap-2 px-4"
      style={{ top: 'calc(12px + var(--safe-top))' }}
    >
      {errors.map((e) => (
        <div
          key={e.id}
          className="pointer-events-auto flex max-w-md items-start gap-3 rounded-2xl border py-2.5 pl-4 pr-2 text-[13px] text-ink"
          style={{
            borderColor: 'var(--accent-ink)',
            // The same opaque-card idiom the §7.4 collapse retires — this toast is OUT of the
            // Surface population (accent border, not border-line), so only the spelling changes:
            // the authored solid replaces the composite, keeping it in step with Modal/UpdateToast.
            background: 'var(--card-solid)',
            boxShadow: 'var(--shadow)',
          }}
        >
          <span className="min-w-0">
            <span className="block font-semibold">{e.action} didn’t save</span>
            <span className="block text-[12.5px] text-muted">{e.detail}</span>
          </span>
          <button
            type="button"
            onClick={() => dismissWriteError(e.id)}
            aria-label="Dismiss"
            className="flex h-7 w-7 flex-none items-center justify-center rounded-full border border-line text-muted hover:text-ink"
          >
            ✕
          </button>
        </div>
      ))}
    </div>
  )
}
