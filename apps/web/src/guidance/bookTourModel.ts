export type BookTourStep = 'add' | 'search' | 'choose' | 'details' | 'saved' | 'library' | 'opened'
export interface BookTourState {
  status: 'off' | 'active' | 'paused'
  step: BookTourStep
  /** Session-only; never written to the profile, storage or analytics. */
  bookId: string | null
}
export const INITIAL_BOOK_TOUR: BookTourState = { status: 'off', step: 'add', bookId: null }
export type BookTourEvent =
  | { type: 'start' | 'end' | 'pause' | 'resume' }
  | { type: 'observe'; step: BookTourStep; bookId?: string }

export function bookTourReducer(state: BookTourState, event: BookTourEvent): BookTourState {
  if (event.type === 'start') return { ...INITIAL_BOOK_TOUR, status: 'active' }
  if (event.type === 'end') return INITIAL_BOOK_TOUR
  if (state.status === 'off') return state
  if (event.type === 'pause')
    return state.status === 'paused' ? state : { ...state, status: 'paused' }
  if (event.type === 'resume')
    return state.status === 'active' ? state : { ...state, status: 'active' }
  if (event.type !== 'observe') return state
  if (event.step === 'saved' && !event.bookId) return state
  if (['library', 'opened'].includes(event.step) && event.bookId !== state.bookId) return state
  const bookId = ['search', 'choose', 'details'].includes(event.step)
    ? null
    : (event.bookId ?? state.bookId)
  if (state.step === event.step && state.bookId === bookId) return state
  return { ...state, step: event.step, bookId }
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
  opened: {
    title: 'You have found your way',
    text: 'This is your book: its details, copies and reading history stay together. Keep exploring, or return to the guide for the next part.',
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
