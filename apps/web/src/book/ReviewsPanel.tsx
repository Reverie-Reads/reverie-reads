import { useState } from 'react'
import { Stars } from '../components/Stars'
import { useReviews, useSetReviewHidden, useUpsertReview } from '../data/reviews'
import { useReportContent } from '../data/moderation'
import { useAuth } from '../auth/AuthProvider'
import { Surface } from '../components/Surface'

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((p) => p[0] ?? '')
    .join('')
    .slice(0, 2)
    .toUpperCase()
}

/**
 * Opt-in individual reviews from other readers — a scrollable list of distinct voices,
 * deliberately never collapsed into an aggregate/average number.
 */
export function ReviewsPanel({ workKey, reviewerName }: { workKey: string; reviewerName: string }) {
  const [open, setOpen] = useState(false)
  const { data: reviews } = useReviews(workKey, open)
  const upsert = useUpsertReview(workKey)
  const setHidden = useSetReviewHidden(workKey)
  const report = useReportContent()
  const { session } = useAuth()
  const uid = session?.user.id
  const [reported, setReported] = useState<Record<string, boolean>>({})
  const [rating, setRating] = useState(0)
  const [body, setBody] = useState('')

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="text-[13px] font-semibold text-primary"
      >
        Read reviews →
      </button>
    )
  }

  return (
    <Surface tone="card" radius="card" pad={3}>
      <div className="flex items-center justify-between">
        <span className="text-[14px] font-semibold text-ink">
          Reviews{reviews ? ` (${reviews.length})` : ''}
        </span>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-[12px] text-muted hover:text-ink"
        >
          hide
        </button>
      </div>
      <p className="mb-3 mt-0.5 text-[12px] text-muted">
        Individual voices from other readers — never averaged into one number.
      </p>

      <div className="flex flex-col gap-2">
        {reviews?.length ? (
          reviews.map((r) => (
            <Surface key={r.id} tone="field" radius="card" pad={2}>
              <div className="flex items-center gap-2">
                <span
                  className="flex h-7 w-7 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{ background: 'var(--chip)', color: 'var(--ink)' }}
                >
                  {initials(r.reviewerName)}
                </span>
                <b className="text-[13px] text-ink">{r.reviewerName}</b>
                <Stars value={r.rating} size={13} />
                <span className="ml-auto text-[11px] text-muted">{r.date.slice(0, 10)}</span>
              </div>
              {r.body && <div className="mt-1.5 text-[13.5px] text-ink">{r.body}</div>}
              <div className="mt-2 flex items-center gap-3 text-[11.5px]">
                {r.hidden && (
                  <span
                    className="rounded-full px-2 py-0.5 text-[11px] font-semibold"
                    style={{ background: 'var(--chip)', color: 'var(--muted)' }}
                  >
                    Hidden — only you can see this
                  </span>
                )}
                {uid === r.reviewerId ? (
                  <button
                    type="button"
                    onClick={() => setHidden.mutate({ id: r.id, hidden: !r.hidden })}
                    className="text-muted hover:text-ink"
                  >
                    {r.hidden ? 'Unhide' : 'Hide'}
                  </button>
                ) : reported[r.id] ? (
                  <span className="text-muted">Reported — thanks</span>
                ) : (
                  <button
                    type="button"
                    onClick={() =>
                      report.mutate(
                        { targetType: 'review', targetId: r.id },
                        { onSuccess: () => setReported((p) => ({ ...p, [r.id]: true })) },
                      )
                    }
                    className="text-muted hover:text-ink"
                  >
                    Report
                  </button>
                )}
              </div>
            </Surface>
          ))
        ) : (
          <p className="text-[13px] text-muted">No reviews yet — be the first voice.</p>
        )}
      </div>

      <div className="mt-3 border-t border-line pt-3">
        <div className="mb-1 text-[11px] uppercase tracking-[0.15em] text-muted">
          Write your review
        </div>
        <Stars value={rating} onChange={setRating} />
        <textarea
          aria-label="Write your review"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={2}
          placeholder="Your honest take…"
          className="skin-field mt-2 w-full border border-line p-3 text-[14px] text-ink outline-none"
          style={{ background: 'var(--field)' }}
        />
        <button
          type="button"
          disabled={upsert.isPending || (!rating && !body.trim())}
          onClick={() => upsert.mutate({ rating, body: body.trim(), reviewerName })}
          className="skin-control mt-2 px-4 py-2 text-[13px] font-semibold disabled:opacity-50"
          style={{
            background: 'linear-gradient(135deg, var(--primary), var(--gold))',
            color: 'var(--on-primary)',
          }}
        >
          Post review
        </button>
      </div>
    </Surface>
  )
}
