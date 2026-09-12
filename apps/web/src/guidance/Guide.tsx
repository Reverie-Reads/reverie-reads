import { useState } from 'react'
import { Link, useNavigate, useRouterState } from '@tanstack/react-router'
import { useProfile } from '../data/profile'
import { Button } from '../components/Button'
import { Surface } from '../components/Surface'
import { PageHeader } from '../components/PageHeader'
import { useUpdateGuidance } from './data'
import { GUIDE_CHAPTERS, chapterAvailable, type GuidanceMode, type GuideId } from './model'

const linkClass =
  'skin-control skin-btn-secondary inline-flex min-h-11 items-center justify-center px-4 py-2 text-[14px] leading-relaxed'

export function GuidanceChoice({
  onChoose,
  pending = false,
}: {
  onChoose: (mode: GuidanceMode, tour: boolean) => void
  pending?: boolean
}) {
  return (
    <div className="space-y-3">
      <Surface tone="card-solid" radius="panel" pad={5}>
        <p className="skin-label text-[12px] text-muted">A little at a time</p>
        <h2
          className="mt-2 text-[24px] leading-tight text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Start gently
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Begin with your books and the reading flow. More tools appear as you add books, read and
          plan. You can explore anything sooner.
        </p>
        <Button className="mt-4" disabled={pending} onClick={() => onChoose('gentle', true)}>
          Start gently
        </Button>
      </Surface>
      <Surface tone="card-solid" radius="panel" pad={5}>
        <p className="skin-label text-[12px] text-muted">The whole library</p>
        <h2
          className="mt-2 text-[24px] leading-tight text-ink"
          style={{ fontFamily: 'var(--font-display)' }}
        >
          Show me around
        </h2>
        <p className="mt-3 text-[15px] leading-relaxed text-muted">
          Keep every destination visible. Take a walkthrough from adding a book to reading,
          organizing, discovering and looking back.
        </p>
        <Button
          variant="secondary"
          className="mt-4"
          disabled={pending}
          onClick={() => onChoose('full', true)}
        >
          Show me around
        </Button>
      </Surface>
      <Button variant="ghost" disabled={pending} onClick={() => onChoose('full', false)}>
        Explore on my own
      </Button>
    </div>
  )
}

export function GuideScreen() {
  const profile = useProfile()
  const update = useUpdateGuidance()
  const guidance = profile.data?.guidance
  const [selected, setSelected] = useState<GuideId | null>(null)
  const [changing, setChanging] = useState(false)
  const chapter =
    GUIDE_CHAPTERS.find(
      (item) => item.id === (guidance?.tour ?? selected ?? guidance?.resume ?? 'books'),
    ) ?? GUIDE_CHAPTERS[0]!
  const tourChapters =
    guidance?.mode === 'gentle' &&
    guidance.tour &&
    ['books', 'reading', 'choose', 'plan'].includes(guidance.tour)
      ? GUIDE_CHAPTERS.slice(0, 4)
      : GUIDE_CHAPTERS
  const index = tourChapters.indexOf(chapter)
  const available = chapterAvailable(chapter, guidance)
  const saveTour = (id: GuideId | null) =>
    update.mutate({ tour: id, ...(id ? { reveal: [id] } : {}) })
  return (
    <section className="mx-auto w-full max-w-5xl px-4 py-6 sm:px-6 lg:py-10">
      <PageHeader
        eyebrow="Make yourself at home"
        title="Your library guide"
        showDescriptionOnMobile
        description="A place to begin, and a place to come back to. Walk through the reading flow or open just the part you need."
      />
      {profile.isPending ? (
        <p role="status" className="mt-6 text-muted">
          Loading your saved guide…
        </p>
      ) : profile.isError || !profile.data ? (
        <div className="mt-6">
          <p role="alert" className="text-ink">
            Your guide could not be loaded. Your library is still available.
          </p>
          <Button className="mt-3" onClick={() => void profile.refetch()}>
            Try again
          </Button>
        </div>
      ) : (
        <>
          <div className="my-6 flex flex-wrap items-center gap-2">
            <p className="mr-auto text-[14px] leading-relaxed text-muted">
              {guidance?.mode === 'gentle'
                ? 'Your library is opening a little at a time.'
                : 'Every destination is available in your navigation.'}
            </p>
            <Button
              variant="secondary"
              onClick={() => setChanging(!changing)}
              aria-expanded={changing}
            >
              Change my pace
            </Button>
            <Button
              variant="ghost"
              disabled={update.isPending}
              onClick={() => update.mutate({ mode: 'full', complete: true, tour: null })}
            >
              Show all features
            </Button>
          </div>
          {changing && (
            <div className="mb-6 max-w-xl">
              <GuidanceChoice
                pending={update.isPending}
                onChoose={(mode, tour) =>
                  update.mutate(
                    { mode, complete: true, tour: tour ? 'books' : null },
                    { onSuccess: () => setChanging(false) },
                  )
                }
              />
            </div>
          )}
          {update.isError && (
            <p role="alert" className="mb-4 text-[14px] text-ink">
              Your choice could not be saved. Check your connection and try again; your previous
              guide is kept.
            </p>
          )}
          <div className="grid items-start gap-5 lg:grid-cols-[240px_minmax(0,1fr)]">
            <div>
              <label className="block text-[14px] text-ink lg:hidden">
                Choose a stop
                <select
                  className="skin-field mt-2 min-h-11 w-full border border-line bg-[color:var(--field)] px-3 text-ink"
                  value={chapter.id}
                  disabled={update.isPending}
                  onChange={(event) => {
                    const id = event.target.value as GuideId
                    setSelected(id)
                    if (guidance?.tour) saveTour(id)
                  }}
                >
                  {GUIDE_CHAPTERS.map((item, i) => (
                    <option key={item.id} value={item.id}>
                      {i + 1}. {item.title}
                    </option>
                  ))}
                </select>
              </label>
              <nav aria-label="Guide chapters" className="hidden flex-col gap-1 lg:flex">
                {GUIDE_CHAPTERS.map((item, i) => (
                  <button
                    key={item.id}
                    type="button"
                    aria-current={item.id === chapter.id ? 'step' : undefined}
                    className="skin-control flex min-h-11 gap-3 border border-line px-3 py-3 text-left text-[14px] leading-relaxed text-ink"
                    style={{
                      background: item.id === chapter.id ? 'var(--card-solid)' : 'transparent',
                    }}
                    disabled={update.isPending}
                    onClick={() => {
                      setSelected(item.id)
                      if (guidance?.tour) saveTour(item.id)
                    }}
                  >
                    <span className="text-muted" aria-hidden>
                      {String(i + 1).padStart(2, '0')}
                    </span>
                    <span>
                      {item.title}
                      {!chapterAvailable(item, guidance) && (
                        <span className="mt-0.5 block text-[12px] text-muted">
                          Explore when ready
                        </span>
                      )}
                    </span>
                  </button>
                ))}
              </nav>
            </div>
            <Surface tone="card-solid" radius="panel" pad={5} className="min-w-0 sm:p-7">
              <p className="skin-label text-[12px] leading-relaxed text-muted">
                {guidance?.tour
                  ? `Walkthrough · Stop ${index + 1} of ${tourChapters.length}`
                  : 'In your own time'}
              </p>
              <h2
                className="mt-3 text-[28px] leading-[1.2] text-ink sm:text-[34px]"
                style={{ fontFamily: 'var(--font-display)' }}
              >
                {chapter.title}
              </h2>
              <p className="mt-3 text-[16px] leading-relaxed text-muted">{chapter.summary}</p>
              <ol className="mt-6 list-decimal space-y-4 pl-5 text-[15px] leading-relaxed text-ink">
                {chapter.steps.map((step) => (
                  <li key={step} className="pl-1">
                    {step}
                  </li>
                ))}
              </ol>
              {!available && (
                <div className="mt-6 border-t border-line pt-4">
                  <p className="text-[14px] leading-relaxed text-muted">
                    {chapter.later} No need to wait if this would help you now.
                  </p>
                  <Button
                    className="mt-3"
                    disabled={update.isPending}
                    onClick={() => update.mutate({ reveal: [chapter.id] })}
                  >
                    Add this to my navigation
                  </Button>
                </div>
              )}
              <div className="mt-6 flex flex-wrap gap-2">
                {chapter.links.map((link) => (
                  <Link
                    key={link.to}
                    to={link.to}
                    className={linkClass}
                    onClick={() => {
                      if (!available) update.mutate({ reveal: [chapter.id] })
                    }}
                  >
                    {link.label}
                  </Link>
                ))}
              </div>
              <p className="mt-3 text-[13px] leading-relaxed text-muted">
                Try a step in your own library, then return here whenever you want.
              </p>
              <div className="mt-6 flex flex-wrap gap-2 border-t border-line pt-4">
                <Button
                  variant="secondary"
                  disabled={index === 0 || update.isPending}
                  onClick={() => {
                    const prev = tourChapters[index - 1]!.id
                    setSelected(prev)
                    if (guidance?.tour) saveTour(prev)
                  }}
                >
                  Previous stop
                </Button>
                {index < tourChapters.length - 1 ? (
                  <Button
                    disabled={update.isPending}
                    onClick={() => {
                      const next = tourChapters[index + 1]!.id
                      setSelected(next)
                      if (guidance?.tour) saveTour(next)
                    }}
                  >
                    Next stop
                  </Button>
                ) : (
                  <Button disabled={update.isPending} onClick={() => saveTour(null)}>
                    Finish walkthrough
                  </Button>
                )}
                {guidance?.tour ? (
                  <Button
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => saveTour(null)}
                  >
                    Pause walkthrough
                  </Button>
                ) : (
                  <Button
                    variant="ghost"
                    disabled={update.isPending}
                    onClick={() => saveTour(chapter.id)}
                  >
                    {guidance?.resume === chapter.id
                      ? 'Resume walkthrough'
                      : 'Walk me through this'}
                  </Button>
                )}
              </div>
            </Surface>
          </div>
        </>
      )}
    </section>
  )
}

/** An in-flow note, never a modal, spotlight, focus trap or fixed overlay over a reader's work. */
export function GuidanceTrail() {
  const { data: profile } = useProfile()
  const navigate = useNavigate()
  const pathname = useRouterState({ select: (state) => state.location.pathname })
  const update = useUpdateGuidance()
  const guidance = profile?.guidance
  if (!guidance?.setupComplete || pathname === '/guide') return null
  const chapter = GUIDE_CHAPTERS.find((item) => item.id === guidance.tour)
  if (!chapter && (guidance.mode !== 'gentle' || pathname !== '/')) return null
  const following =
    chapter && !(guidance.mode === 'gentle' && chapter.id === 'plan')
      ? GUIDE_CHAPTERS[GUIDE_CHAPTERS.indexOf(chapter) + 1]
      : undefined
  const introduction = guidance.milestones.includes('planned')
    ? 'Discover and Bookshops are ready when you want to look further.'
    : guidance.milestones.includes('finished')
      ? 'Stats can now help you look back on your completed reading.'
      : guidance.milestones.includes('reading')
        ? 'Shelves, Series and Cover Studio are ready to help you organize.'
        : guidance.milestones.includes('books')
          ? 'Next read and Planner are now close at hand.'
          : 'Begin with Add to bring your first book home.'
  const next =
    chapter ??
    GUIDE_CHAPTERS.find((item) => !chapterAvailable(item, guidance)) ??
    GUIDE_CHAPTERS[0]!
  return (
    <aside aria-label="Your library guide" className="mx-4 mt-4 border-b border-line pb-4 lg:mx-6">
      <div className="flex flex-wrap items-center gap-x-5 gap-y-2">
        <div className="min-w-0 flex-1">
          <p className="skin-label text-[12px] leading-relaxed text-muted">
            {chapter ? 'Your walkthrough' : 'A little at a time'}
          </p>
          <p className="mt-1 text-[17px] leading-relaxed text-ink">
            {chapter ? next.title : introduction}
          </p>
        </div>
        <Link to="/guide" className={linkClass}>
          {chapter ? 'Continue walkthrough' : 'Explore the guide'}
        </Link>
        {chapter && (
          <Button
            variant="secondary"
            disabled={update.isPending}
            onClick={() =>
              update.mutate(
                { tour: following?.id ?? null, reveal: following ? [following.id] : [] },
                {
                  onSuccess: () => {
                    if (following) void navigate({ to: following.links[0]!.to })
                  },
                },
              )
            }
          >
            {following ? 'Next stop' : 'Finish walkthrough'}
          </Button>
        )}
        {chapter && (
          <Button
            variant="ghost"
            disabled={update.isPending}
            onClick={() => update.mutate({ tour: null })}
          >
            Pause
          </Button>
        )}
      </div>
      {chapter && (
        <p className="mt-2 max-w-[78ch] text-[14px] leading-relaxed text-muted">
          {chapter.steps[0]}
        </p>
      )}
      {update.isError && (
        <p role="alert" className="mt-2 text-[14px] text-ink">
          Your guide could not be saved. Try again when connected.
        </p>
      )}
    </aside>
  )
}
