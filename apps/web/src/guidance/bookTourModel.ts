export type ReadingTourStep =
  | 'read-choose'
  | 'read-start'
  | 'read-progress'
  | 'read-editor'
  | 'read-saved'
  | 'read-finish'
  | 'read-finish-editor'
  | 'read-reflect'
  | 'read-finished'
export type BookTourStep =
  | 'add'
  | 'search'
  | 'choose'
  | 'details'
  | 'saved'
  | 'library'
  | 'opened'
  | ReadingTourStep
export interface BookTourState {
  status: 'off' | 'active' | 'paused'
  run: number
  journey: 'first-book' | 'reading'
  step: BookTourStep
  /** Session-only; never written to the profile, storage or analytics. */
  bookId: string | null
  /** Last usable in-app URL, including filters. Account-keyed memory only. */
  returnTo: string | null
}
export const INITIAL_BOOK_TOUR: BookTourState = {
  status: 'off',
  run: 0,
  journey: 'first-book',
  step: 'add',
  bookId: null,
  returnTo: null,
}
export type BookTourEvent =
  | { type: 'start' | 'end' | 'pause' | 'resume' }
  | { type: 'start-reading'; bookId?: string }
  | { type: 'reading-open'; run: number; bookId: string; reading: boolean }
  | { type: 'location'; run: number; href: string }
  | {
      type: 'reading'
      run: number
      action:
        | 'started'
        | 'progress-open'
        | 'progress-close'
        | 'progress-saved'
        | 'offer-finish'
        | 'finish-open'
        | 'finish-close'
        | 'reflect-open'
        | 'reflect-close'
        | 'finished'
      bookId: string
    }
  | { type: 'observe'; run: number; step: BookTourStep; bookId?: string }

export function bookTourReducer(state: BookTourState, event: BookTourEvent): BookTourState {
  if (event.type === 'start') return { ...INITIAL_BOOK_TOUR, status: 'active', run: state.run + 1 }
  if (event.type === 'start-reading')
    return {
      ...INITIAL_BOOK_TOUR,
      status: 'active',
      run: state.run + 1,
      journey: 'reading',
      step: 'read-choose',
      bookId: event.bookId ?? null,
    }
  if (event.type === 'end') return { ...INITIAL_BOOK_TOUR, run: state.run }
  if (state.status === 'off') return state
  if ('run' in event && event.run !== state.run) return state
  if (event.type === 'location')
    return state.returnTo === event.href ? state : { ...state, returnTo: event.href }
  if (event.type === 'pause')
    return state.status === 'paused' ? state : { ...state, status: 'paused' }
  if (event.type === 'resume')
    return state.status === 'active' ? state : { ...state, status: 'active' }
  if (state.journey === 'reading') {
    if (event.type === 'reading-open') {
      // Only the reader's initial choice selects a book. Optimistic updates and other books
      // cannot turn a started/finished operation into a confirmed success.
      if (state.step !== 'read-choose' || (state.bookId && state.bookId !== event.bookId))
        return state
      return {
        ...state,
        bookId: event.bookId,
        step: event.reading ? 'read-progress' : 'read-start',
      }
    }
    if (event.type !== 'reading' || event.bookId !== state.bookId || event.run !== state.run)
      return state
    const transitions: Record<
      Extract<BookTourEvent, { type: 'reading' }>['action'],
      [ReadingTourStep[], ReadingTourStep]
    > = {
      started: [['read-start'], 'read-progress'],
      'progress-open': [['read-progress', 'read-saved'], 'read-editor'],
      'progress-close': [['read-editor'], 'read-progress'],
      'progress-saved': [['read-editor'], 'read-saved'],
      'offer-finish': [['read-saved', 'read-progress'], 'read-finish'],
      'finish-open': [['read-finish', 'read-progress', 'read-saved'], 'read-finish-editor'],
      'finish-close': [['read-finish-editor'], 'read-finish'],
      finished: [['read-finish-editor'], 'read-finished'],
      'reflect-open': [['read-finished'], 'read-reflect'],
      'reflect-close': [['read-reflect'], 'read-finished'],
    }
    const transition = transitions[event.action]
    return transition?.[0].includes(state.step as ReadingTourStep)
      ? { ...state, step: transition[1] }
      : state
  }
  if (event.type !== 'observe' || event.step.startsWith('read-')) return state
  if (event.step === 'saved' && !event.bookId) return state
  if (['library', 'opened'].includes(event.step) && event.bookId !== state.bookId) return state
  const bookId = ['search', 'choose', 'details'].includes(event.step)
    ? null
    : (event.bookId ?? state.bookId)
  if (state.step === event.step && state.bookId === bookId) return state
  return { ...state, step: event.step, bookId }
}

/** Route availability is shared by launch, pause and resume; a resume cannot briefly run elsewhere. */
export function isBookTourLocation(
  state: Pick<BookTourState, 'journey' | 'bookId'>,
  pathname: string,
): boolean {
  if (state.journey === 'reading')
    return state.bookId
      ? pathname === `/book/${state.bookId}`
      : pathname === '/library' || /^\/book\/[^/]+$/.test(pathname)
  return (
    pathname === '/add' ||
    pathname === '/library' ||
    (!!state.bookId && pathname === `/book/${state.bookId}`)
  )
}

export function bookTourReturnHref(state: BookTourState): string {
  if (state.bookId && (state.journey === 'reading' || state.step === 'opened'))
    return `/book/${encodeURIComponent(state.bookId)}`
  if (state.bookId)
    return state.returnTo?.split('?')[0] === '/library' ? state.returnTo : '/library'
  return state.returnTo ?? (state.journey === 'reading' ? '/library' : '/add')
}

export const BOOK_TOUR_STEPS = {
  add: {
    title: 'Bring a book home',
    text: 'Start with Add a book. You can search for a title, scan its barcode or enter the details yourself.',
    target: 'add-book',
    action: 'Open Add a book',
    demonstration: 'click',
  },
  search: {
    title: 'Find a book you know',
    text: 'Type a title, author or ISBN, then search. Add manually is here if the book cannot be found.',
    target: 'book-search',
    action: 'Go to the search field',
    demonstration: 'focus',
  },
  choose: {
    title: 'Choose the right book',
    text: 'Check the title and author, then choose a result. A book already in your library can be opened directly.',
    target: 'book-results',
    action: 'Show the results',
    demonstration: 'point',
  },
  details: {
    title: 'Make it yours',
    text: 'Check the details and destination. Choose whether you own, borrowed or want it, then add the book when you are ready.',
    target: 'book-save',
    action: 'Show where to save',
    demonstration: 'point',
  },
  saved: {
    title: 'Your book is saved',
    text: 'You can refine its cover and tags here. Choose Done when you are ready to return to your library.',
    target: 'book-done',
    action: 'Return to the library',
    demonstration: 'click',
  },
  library: {
    title: 'A place on your shelf',
    text: 'Here is the book you just added. Open it to see its details and the place for your reading history.',
    target: 'tour-saved-book',
    action: 'Open your book',
    demonstration: 'click',
  },
  'read-choose': {
    title: 'Choose a book to spend time with',
    text: 'Open one of your books. Your current library filters stay in place; use search or change the view if you need to. No books yet? Begin with Add a book.',
    target: 'reading-library',
    action: 'Show your library',
    demonstration: 'point',
  },
  'read-start': {
    title: 'Begin where you are',
    text: 'Choose Start reading, Resume reading or Read again when you are ready. Resume keeps your place; a new read keeps earlier finishes in your history.',
    target: 'reading-start',
    action: 'Show the reading control',
    demonstration: 'point',
  },
  'read-progress': {
    title: 'Keep your place',
    text: 'Open Update progress to record how far you have read. You choose the percentage and save it yourself.',
    target: 'reading-progress',
    action: 'Open Update progress',
    demonstration: 'click',
  },
  'read-editor': {
    title: 'Your place, in your own time',
    text: 'Enter your actual whole percentage, then Save progress. Cancel leaves your place unchanged. Even 100% does not create a finished read.',
    target: 'reading-progress-save',
    action: 'Show where to save progress',
    demonstration: 'point',
  },
  'read-saved': {
    title: 'Your place is saved',
    text: 'That is enough for today. Continue reading, or see where to record a finish when you reach the end.',
    target: 'reading-progress',
    action: 'Show your reading control',
    demonstration: 'point',
  },
  'read-finish': {
    title: 'When you reach the end',
    text: 'Finish this read opens a record for this time through the book. You can look and cancel; only save a finish you actually made.',
    target: 'reading-finish',
    action: 'Open Finish this read',
    demonstration: 'click',
  },
  'read-finish-editor': {
    title: 'Keep what this read leaves with you',
    text: 'Choose the date and format. Your rating and thoughts are optional. Save only when you have finished; cancel whenever you like.',
    target: 'reading-finish-save',
    action: 'Show where to save the finished read',
    demonstration: 'point',
  },
  'read-reflect': {
    title: 'A moment before your next book',
    text: 'Your finish is saved. This optional sheet lets you keep a mood or consider the next book. Make any choices yourself, or choose Done to return to your reading history.',
    target: 'reading-reflect-done',
    action: 'Return to reading history',
    demonstration: 'click',
  },
  'read-finished': {
    title: 'A read to return to',
    text: 'Your finished read is saved in this book’s history. Each time through has its own date, format and thoughts.',
    target: 'reading-history',
    action: 'Show the saved reading history',
    demonstration: 'point',
  },
  opened: {
    title: 'You have found your way',
    text: 'This is your book: its details, copies and reading history stay together. Keep exploring, or follow the reading walkthrough with a book of your choice.',
    target: 'tour-opened-book',
    action: 'Show the book details',
    demonstration: 'point',
  },
} as const satisfies Record<
  BookTourStep,
  {
    title: string
    text: string
    target: string
    action: string
    demonstration: 'click' | 'focus' | 'point'
  }
>
