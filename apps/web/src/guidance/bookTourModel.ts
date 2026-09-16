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
export type NextReadTourStep =
  | 'next-scope'
  | 'next-mood'
  | 'next-picks'
  | 'next-saved'
  | 'next-opening'
export type PlannerView = 'queue' | 'calendar' | 'releases' | 'waiting'
export type PlannerContext =
  | { kind: 'view'; view: PlannerView }
  | { kind: 'picker'; view: PlannerView }
  | { kind: 'editor'; bookId: string; editorId: string; view: PlannerView }
export type PlannerTourStep =
  | 'plan-waiting'
  | 'plan-queue'
  | 'plan-calendar'
  | 'plan-releases'
  | 'plan-picker'
  | 'plan-timing'
  | 'plan-note'
  | 'plan-save'
  | 'plan-saved'
export type BookTourStep =
  | 'add'
  | 'search'
  | 'choose'
  | 'details'
  | 'saved-loading'
  | 'saved'
  | 'library'
  | 'opened'
  | ReadingTourStep
  | NextReadTourStep
  | PlannerTourStep
export interface BookTourState {
  status: 'off' | 'active' | 'paused'
  run: number
  journey: 'first-book' | 'reading' | 'next-read' | 'planner'
  plannerView?: PlannerView
  plannerEditorId?: string
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
  | { type: 'start-next-read' }
  | { type: 'start-planner' }
  | { type: 'planner-context'; run: number; context: PlannerContext }
  | { type: 'planner-step'; run: number; step: 'plan-timing' | 'plan-note' | 'plan-save' }
  | { type: 'planner-saved'; run: number; bookId: string; editorId: string }
  | { type: 'next-read'; run: number; action: 'scope' | 'mood' | 'picks' | 'saved' }
  | { type: 'next-read'; run: number; action: 'select'; bookId: string }
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
  if (event.type === 'start-next-read')
    return {
      ...INITIAL_BOOK_TOUR,
      status: 'active',
      run: state.run + 1,
      journey: 'next-read',
      step: 'next-scope',
    }
  if (event.type === 'start-planner')
    return {
      ...INITIAL_BOOK_TOUR,
      status: 'active',
      run: state.run + 1,
      journey: 'planner',
      step: 'plan-queue',
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
  if (state.journey === 'planner') {
    if (event.type === 'planner-context') {
      const context = event.context
      if (context.kind === 'editor') {
        if (state.plannerEditorId === context.editorId && state.bookId === context.bookId)
          return state
        return {
          ...state,
          step: 'plan-timing',
          bookId: context.bookId,
          plannerEditorId: context.editorId,
          plannerView: context.view,
        }
      }
      if (context.kind === 'picker')
        return {
          ...state,
          step: 'plan-picker',
          bookId: null,
          plannerEditorId: undefined,
          plannerView: context.view,
        }
      // Closing after a confirmed save keeps the success visible. A different view is a new context.
      const step =
        state.step === 'plan-saved' && state.plannerView === context.view
          ? state.step
          : (`plan-${context.view}` as PlannerTourStep)
      if (state.step === step && state.plannerView === context.view && !state.plannerEditorId)
        return state
      return { ...state, step, plannerView: context.view, plannerEditorId: undefined, bookId: null }
    }
    if (event.type === 'planner-step' && state.plannerEditorId)
      return { ...state, step: event.step }
    if (
      event.type === 'planner-saved' &&
      state.plannerEditorId === event.editorId &&
      state.bookId === event.bookId
    )
      return { ...state, step: 'plan-saved' }
    return state
  }
  if (state.journey === 'next-read') {
    if (
      event.type === 'reading-open' &&
      state.step === 'next-opening' &&
      event.bookId === state.bookId
    )
      return { ...state, journey: 'reading', step: event.reading ? 'read-progress' : 'read-start' }
    if (event.type !== 'next-read') return state
    if (event.action === 'select') return { ...state, bookId: event.bookId, step: 'next-opening' }
    // A shelf response cannot replace an in-flight reader-selected book handoff.
    if (state.step === 'next-opening') return state
    const step: NextReadTourStep = `next-${event.action}`
    return step === state.step ? state : { ...state, step }
  }
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
  if (
    event.type !== 'observe' ||
    event.step.startsWith('read-') ||
    event.step.startsWith('next-') ||
    event.step.startsWith('plan-')
  )
    return state
  if (['saved', 'saved-loading'].includes(event.step) && !event.bookId) return state
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
  if (state.journey === 'planner') return pathname === '/planner'
  if (state.journey === 'next-read')
    return pathname === '/match' || (!!state.bookId && pathname === `/book/${state.bookId}`)
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
  if (state.journey === 'planner')
    return state.returnTo?.split('?')[0] === '/planner' ? state.returnTo : '/planner'
  if (state.journey === 'next-read')
    return state.returnTo?.split('?')[0] === '/match' ? state.returnTo : '/match'
  if (state.bookId && (state.journey === 'reading' || state.step === 'opened'))
    return `/book/${encodeURIComponent(state.bookId)}`
  if (state.bookId)
    return state.returnTo?.split('?')[0] === '/library' ? state.returnTo : '/library'
  return state.returnTo ?? (state.journey === 'reading' ? '/library' : '/add')
}

export const BOOK_TOUR_STEPS = {
  'plan-waiting': {
    title: 'Your library comes first',
    text: 'Planner needs your personal books before you can choose a plan. The message here shows whether they are loading, offline or need another try.',
    target: 'plan-status',
    action: 'Show the library status',
    demonstration: 'point',
  },
  'plan-queue': {
    title: 'Leave a little room',
    text: 'Choose a book for your plan, or edit one already here. “Soon” is enough; nothing needs a deadline.',
    target: 'plan-add',
    action: 'Open the book picker',
    demonstration: 'click',
  },
  'plan-calendar': {
    title: 'Your reading life in view',
    text: 'Explore a month or year. Plans are possibilities; reading history records what happened. Choose a day to plan, or edit an existing plan.',
    target: 'plan-calendar',
    action: 'Show your calendar',
    demonstration: 'point',
  },
  'plan-releases': {
    title: 'What is coming into view',
    text: 'Explore upcoming books from your library and authors. A release date is not a reading plan. Open a book to review it, or switch to Plan when you want to leave it a place.',
    target: 'plan-releases',
    action: 'Show your release horizon',
    demonstration: 'point',
  },
  'plan-picker': {
    title: 'A book of your choosing',
    text: 'Find a book in your library and choose it yourself. Books already planned or currently being read are left out; existing plans can be edited in Planner.',
    target: 'plan-picker',
    action: 'Go to the book search',
    demonstration: 'focus',
  },
  'plan-timing': {
    title: 'As open-ended as you like',
    text: 'Keep it at Soon, or choose a year, month or day. Your current timing stays in place. A plan never starts a read.',
    target: 'plan-timing',
    action: 'Show the timing choices',
    demonstration: 'point',
  },
  'plan-note': {
    title: 'A note for another day',
    text: 'Leave yourself a thought about this book, if you like. This note is private and optional; you can leave it exactly as it is.',
    target: 'plan-note',
    action: 'Go to the optional note',
    demonstration: 'focus',
  },
  'plan-save': {
    title: 'Keep this possibility',
    text: 'Save plan when it feels right. Cancel keeps your saved plan unchanged. Only you choose to save or remove a plan.',
    target: 'plan-save',
    action: 'Show where to save the plan',
    demonstration: 'point',
  },
  'plan-saved': {
    title: 'A place is waiting',
    text: 'Your plan is saved. You can change its timing, move it or remove it later. Your reading history is unchanged.',
    target: 'plan-view',
    action: 'Show your Planner views',
    demonstration: 'point',
  },
  'next-scope': {
    title: 'Begin with your shelves',
    text: 'Choose books you have, your wishlist, or your whole library. Your current selection stays in place.',
    target: 'next-scope',
    action: 'Show the library selection',
    demonstration: 'point',
  },
  'next-mood': {
    title: 'A mood, if you have one',
    text: 'Describe what you feel like reading, or use Help me choose. You can also go straight to your picks without changing a thing.',
    target: 'next-mood',
    action: 'Go to the mood field',
    demonstration: 'focus',
  },
  'next-picks': {
    title: 'Find a book to open',
    text: 'Open a book to look closer, save a choice to TBR, or start reading. Your library explains each pick; you make the choice.',
    target: 'next-picks',
    action: 'Show your choices',
    demonstration: 'point',
  },
  'next-saved': {
    title: 'Kept for another day',
    text: 'Your choice is saved to TBR. This keeps it close without starting a read or setting a deadline.',
    target: 'next-picks',
    action: 'Return to your choices',
    demonstration: 'point',
  },
  'next-opening': {
    title: 'A closer look',
    text: 'Your chosen book is opening. Once its reading record is ready, the guide can help you keep your place.',
    target: 'tour-opened-book',
    action: 'Show your chosen book',
    demonstration: 'point',
  },
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
  'saved-loading': {
    title: 'Loading your saved book',
    text: 'The save is confirmed. The message here explains whether its details are loading or need another try. You can also leave and come back later.',
    target: 'book-load',
    action: 'Show the loading status',
    demonstration: 'point',
  },
  saved: {
    title: 'Your book is saved',
    text: 'You can refine its cover and tags, or open your book now. Return to your library to see where it lives on your shelf.',
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
