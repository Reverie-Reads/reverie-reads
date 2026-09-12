import { isBookRead, type Book } from '@reverie/core'

export const MILESTONES = ['books', 'reading', 'finished', 'planned'] as const
export type Milestone = (typeof MILESTONES)[number]
export const GUIDE_IDS = [
  'books',
  'reading',
  'choose',
  'plan',
  'organize',
  'reflect',
  'explore',
  'share',
  'personalize',
  'privacy',
] as const
export type GuideId = (typeof GUIDE_IDS)[number]
export type GuidanceMode = 'gentle' | 'full'
export interface Guidance {
  version: 1
  mode: GuidanceMode
  setupComplete: boolean
  milestones: Milestone[]
  revealed: GuideId[]
  tour: GuideId | null
  resume?: GuideId
}

export function guidanceFromUnknown(value: unknown): Guidance | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null
  const row = value as Record<string, unknown>
  if (
    row.version !== 1 ||
    !['gentle', 'full'].includes(String(row.mode)) ||
    typeof row.setupComplete !== 'boolean'
  )
    return null
  if (!Array.isArray(row.milestones) || !Array.isArray(row.revealed)) return null
  return {
    version: 1,
    mode: row.mode as GuidanceMode,
    setupComplete: row.setupComplete,
    milestones: MILESTONES.filter((id) => (row.milestones as unknown[]).includes(id)),
    revealed: GUIDE_IDS.filter((id) => (row.revealed as unknown[]).includes(id)),
    ...(GUIDE_IDS.includes(row.resume as GuideId) ? { resume: row.resume as GuideId } : {}),
    tour: GUIDE_IDS.includes(row.tour as GuideId) ? (row.tour as GuideId) : null,
  }
}

/** Only coarse facts leave this function. No title, book id, note, mood or timestamp is stored. */
export function libraryMilestones(books: readonly Book[]): Milestone[] {
  const found: Milestone[] = []
  if (books.length) found.push('books')
  if (
    books.some(
      (book) => book.readStatus === 'Reading' || book.readStatus === 'DNF' || isBookRead(book),
    )
  )
    found.push('reading')
  if (books.some(isBookRead)) found.push('finished')
  if (books.some((book) => book.planPosition != null || book.plan.y != null)) found.push('planned')
  return found
}

export interface GuideChapter {
  id: GuideId
  title: string
  summary: string
  steps: readonly string[]
  links: readonly { label: string; to: string }[]
  after?: Milestone
  later: string
}

export const GUIDE_CHAPTERS: readonly GuideChapter[] = [
  {
    id: 'books',
    title: 'Bring your books home',
    summary: 'A few books are enough to begin. Your library can grow at your pace.',
    steps: [
      'Use Add to search a title or ISBN, scan a barcode on a supported device, or enter a book yourself. Import a Goodreads or StoryGraph file from Settings when you are ready.',
      'Review the book and edition before saving. Mark owned, borrowed and wishlist separately; wanting another copy does not mean giving up the one you own.',
      'Open a cover in Library to find its details, copies, reading history and personal choices.',
    ],
    links: [
      { label: 'Add a book', to: '/add' },
      { label: 'Open Library', to: '/library' },
      { label: 'Import in Settings', to: '/settings' },
    ],
    later: 'Available from the start.',
  },
  {
    id: 'reading',
    title: 'Settle into a book',
    summary: 'Home holds what you are reading now. The book keeps the history.',
    steps: [
      'Open a book and start reading. It appears on Home so you can pick up where you left off.',
      'Update your progress and choose Save. Finish a read to record its date, format, rating and a private note.',
      'Read it again later without replacing the first reading. Setting a book aside keeps its history too.',
    ],
    links: [
      { label: 'Open Home', to: '/' },
      { label: 'Choose a book in Library', to: '/library' },
    ],
    later: 'Available from the start.',
  },
  {
    id: 'choose',
    title: 'Find your next read',
    summary: 'Choose from the books you already own or have borrowed.',
    after: 'books',
    steps: [
      'Open Next read and choose the moods or preferences that fit today.',
      'Compare the shortlist and its reasons. You can include rereads or stopped books when you want to return to one.',
      'Open a book for a closer look, then start reading or make a plan.',
    ],
    links: [{ label: 'Open Next read', to: '/match' }],
    later: 'Introduced after you add or import a book.',
  },
  {
    id: 'plan',
    title: 'Leave a place for what comes next',
    summary: 'Soon, a month, or an exact day: a plan can be as loose as you need.',
    after: 'books',
    steps: [
      'Use a book’s planning control or Planner to add it to Soon or choose a date.',
      'Move books in the queue and keep an intention for your future self. A year or month stays a year or month.',
      'Calendar holds dated plans and reading history. Releases shows approaching books with the date precision their sources support.',
    ],
    links: [{ label: 'Open Planner', to: '/planner' }],
    later: 'Introduced after you add or import a book.',
  },
  {
    id: 'organize',
    title: 'Make the shelves your own',
    summary: 'Use the amount of structure that helps you find a book again.',
    after: 'reading',
    steps: [
      'Create a shelf or TBR in Shelves, add books, and choose a priority shelf for Home.',
      'Series holds order and gaps. Open a series to review its entries; remove an incorrect category without removing your books.',
      'Cover Studio helps you review or replace covers. Personal tropes and moods hold your own language for a book.',
    ],
    links: [
      { label: 'Open Shelves', to: '/shelves' },
      { label: 'Open Series', to: '/series' },
      { label: 'Open Cover Studio', to: '/covers' },
      { label: 'Open Tropes', to: '/tropes' },
    ],
    later: 'Introduced after you start or record a read.',
  },
  {
    id: 'reflect',
    title: 'Keep what the reading leaves',
    summary: 'Your reading history becomes a private record you can look back on.',
    after: 'finished',
    steps: [
      'Choose a period in Stats to see your completed reads, rereads and reading patterns.',
      'Open a number or chart segment to see the actual records behind it. Undated history stays separate.',
      'Return to a book to revisit your notes or correct a reading record. Your rating describes your experience.',
    ],
    links: [{ label: 'Open Stats', to: '/stats' }],
    later: 'Introduced after you record a finished read, including imported history.',
  },
  {
    id: 'explore',
    title: 'Look beyond your shelves',
    summary: 'Discover something new when you want to venture further.',
    after: 'planned',
    steps: [
      'Use Discover with a chosen book, a mood or a genre. Your reading room does not decide your taste.',
      'Open a result to inspect its information. Saving a shortlist does not add every result to your personal library.',
      'Bookshops helps you find independent stores. Search a city if location permission is unavailable; listings do not promise live stock.',
    ],
    links: [
      { label: 'Open Discover', to: '/discover' },
      { label: 'Find Bookshops', to: '/indie' },
    ],
    later: 'Introduced after you save a reading plan, or whenever you choose to explore.',
  },
  {
    id: 'share',
    title: 'Read alongside someone',
    summary: 'Bring someone into a shared space deliberately.',
    steps: [
      'A household catalog is separate from your personal copies. Choose a household destination explicitly when adding a book.',
      'Use Clubs for read-alongs and shared lists. Read-along comments follow each reader’s recorded progress.',
      'Your personal notes, ratings and reading history remain yours. Joining a shared space does not make your library public.',
    ],
    links: [
      { label: 'Open Clubs', to: '/clubs' },
      { label: 'Household in Settings', to: '/settings' },
    ],
    later: 'Explore whenever you want to read with someone.',
  },
  {
    id: 'personalize',
    title: 'Make yourself at home',
    summary: 'The same library, in a room that feels like yours.',
    steps: [
      'Preview the nine rooms in Appearance and choose Day, Night or System. A room never restricts the genres you can read.',
      'Use Arrange Reverie in Settings to choose your dock and Home modules. Your saved priorities stay close even in the gentle path.',
      'Return to this guide to change pace, replay a walkthrough or show every destination.',
    ],
    links: [
      { label: 'Open Appearance', to: '/skins' },
      { label: 'Arrange in Settings', to: '/settings' },
    ],
    later: 'Available from the start.',
  },
  {
    id: 'privacy',
    title: 'Know what stays yours',
    summary: 'Your books and reading life belong to you.',
    steps: [
      'Settings holds account, privacy, import and export controls. Download a complete backup whenever you want.',
      'Review a restore before saving it: restoring can change records and preferences in your account.',
      'You can stop any walkthrough, change the guidance path, sign out or delete your account without earning a milestone.',
    ],
    links: [{ label: 'Open Settings', to: '/settings' }],
    later: 'Available from the start.',
  },
]

const ALWAYS = new Set<GuideId>(['books', 'reading', 'personalize', 'privacy'])
export function chapterAvailable(
  chapter: GuideChapter,
  guidance: Guidance | null | undefined,
): boolean {
  return (
    !guidance ||
    guidance.mode === 'full' ||
    ALWAYS.has(chapter.id) ||
    guidance.revealed.includes(chapter.id) ||
    (!!chapter.after && guidance.milestones.includes(chapter.after))
  )
}
const PATH_CHAPTER: Record<string, GuideId> = {
  '/match': 'choose',
  '/planner': 'plan',
  '/shelves': 'organize',
  '/series': 'organize',
  '/tropes': 'organize',
  '/covers': 'organize',
  '/stats': 'reflect',
  '/discover': 'explore',
  '/indie': 'explore',
  '/clubs': 'share',
}
export function guidanceAllowsPath(path: string, guidance: Guidance | null | undefined): boolean {
  const id = PATH_CHAPTER[path]
  const chapter = GUIDE_CHAPTERS.find((item) => item.id === id)
  return !chapter || chapterAvailable(chapter, guidance)
}
