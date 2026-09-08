import { useState } from 'react'
import {
  hasDate,
  isReadingPlan,
  nextReadingPlanPosition,
  parseNumericFields,
  PLAN_DAY,
  PLAN_MONTH,
  PLAN_YEAR,
  type Book,
} from '@reverie/core'
import { useBooks, useUpdateBook } from '../data/books'

const planFieldClass =
  'skin-field h-10 w-full border border-line px-3 text-[14px] text-ink outline-none'
const planFieldStyle = { background: 'var(--field)' } as const

/**
 * The planned-read date, at the precision the reader actually has.
 *
 * Replaces an `<input type="date">`, which could only ask for a specific day — so "sometime in
 * March" had to be entered as a day nobody chose, or not at all. Three fields, mirroring the pub
 * date's form in the edit dialog and validated through the same `parseNumericFields` against the
 * bounds the columns enforce. Year alone and year+month are both complete answers here.
 *
 * Commits when focus leaves the WHOLE editor, not on every keystroke and not per field. Writing on
 * change is impossible with three inputs — typing "2026" into an empty year would write 2, then 20,
 * then 202 — but per-field blur was wrong too: tabbing Year → Month → Day fired three writes, each
 * sending the entire trio, and the first (year only, month and day still empty) could land last and
 * overwrite the complete plan. Committing once means there is no earlier, less complete write for a
 * race to prefer. `useUpdateBook(book.id)` serializes what remains, since a reader can still leave
 * and re-enter the editor faster than a round trip.
 */
export function PlanEditor({
  book,
}: {
  book: Pick<Book, 'id' | 'title' | 'plan' | 'planPosition' | 'planIntention' | 'addedTs'>
}) {
  const updateBook = useUpdateBook(book.id)
  const library = useBooks().data ?? []
  const [f, setF] = useState(() => ({
    y: book.plan.y == null ? '' : String(book.plan.y),
    m: book.plan.m == null ? '' : String(book.plan.m),
    d: book.plan.d == null ? '' : String(book.plan.d),
  }))
  const [errors, setErrors] = useState<Record<string, string>>({})
  const soon = book.planPosition != null && !hasDate(book.plan)

  const clearFields = () => setF({ y: '', m: '', d: '' })
  const chooseSoon = () => {
    clearFields()
    setErrors({})
    if (soon) return
    updateBook.mutate({
      id: book.id,
      patch: {
        plan: { y: null, m: null, d: null },
        planPosition: book.planPosition ?? nextReadingPlanPosition(library),
      },
    })
  }
  const removePlan = () => {
    clearFields()
    setErrors({})
    updateBook.mutate({
      id: book.id,
      patch: { plan: { y: null, m: null, d: null }, planPosition: null, planIntention: '' },
    })
  }

  const commit = () => {
    const parsed = parseNumericFields({
      planY: { raw: f.y, spec: PLAN_YEAR },
      planM: { raw: f.m, spec: PLAN_MONTH },
      planD: { raw: f.d, spec: PLAN_DAY },
    })
    if (!parsed.ok) {
      setErrors(parsed.errors)
      return
    }
    const next = { y: parsed.values.planY, m: parsed.values.planM, d: parsed.values.planD }
    // The one cross-field rule, and the pub form has no equivalent because nothing reads pub the way
    // `hasDate` reads a plan: a month or day with no year is stored happily by the schema but is
    // invisible everywhere — it would not count as planned, sort, or render. Refusing it beats
    // accepting a write that silently does nothing.
    if (next.y == null && (next.m != null || next.d != null)) {
      setErrors({ planY: 'A plan needs a year.' })
      return
    }
    setErrors({})
    if (next.y === book.plan.y && next.m === book.plan.m && next.d === book.plan.d) return
    updateBook.mutate({
      id: book.id,
      patch: hasDate(next)
        ? {
            plan: next,
            planPosition: book.planPosition ?? nextReadingPlanPosition(library),
          }
        : { plan: next, planPosition: null, planIntention: '' },
    })
  }

  const field = (k: 'y' | 'm' | 'd', label: string, errKey: string, placeholder: string) => (
    <label className="block">
      <span className="mb-1 block text-[11px] uppercase tracking-[0.15em] text-muted">{label}</span>
      <input
        value={f[k]}
        onChange={(e) => {
          setF((prev) => ({ ...prev, [k]: e.target.value }))
          setErrors((prev) => (prev[errKey] ? { ...prev, [errKey]: '' } : prev))
        }}
        placeholder={placeholder}
        inputMode="numeric"
        aria-label={`Planned read ${label.toLowerCase()}`}
        aria-invalid={!!errors[errKey]}
        className={planFieldClass}
        style={planFieldStyle}
      />
      {errors[errKey] && (
        <span className="mt-1 block text-[11.5px]" style={{ color: 'var(--accent-ink)' }}>
          {errors[errKey]}
        </span>
      )}
    </label>
  )

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-pressed={soon}
          onClick={chooseSoon}
          className="skin-control min-h-11 border border-line px-4 text-[13px] font-semibold text-ink"
          style={
            soon ? { background: 'var(--accent-fill)', color: 'var(--on-primary)' } : undefined
          }
        >
          Soon
        </button>
        <span className="text-[12px] text-muted">No deadline</span>
        {isReadingPlan(book) && (
          <button
            type="button"
            onClick={removePlan}
            className="ml-auto min-h-11 text-[12.5px] text-muted underline underline-offset-4"
          >
            Remove plan
          </button>
        )}
      </div>
      {/* React's onBlur is focusout, so it bubbles: moving BETWEEN the three inputs keeps
          relatedTarget inside this div and commits nothing, while leaving the group entirely
          commits once with the whole trio. */}
      <div
        className="grid grid-cols-3 gap-3"
        onBlur={(e) => {
          if (!e.currentTarget.contains(e.relatedTarget)) commit()
        }}
      >
        {field('y', 'Year', 'planY', '2026')}
        {field('m', 'Month', 'planM', '1–12')}
        {field('d', 'Day', 'planD', 'optional')}
      </div>
    </div>
  )
}
