import { splitName, type Book, type Incoming } from '@reverie/core'

/** Public bibliographic facts from the landing's catalog examples. Each cover is the exact-ISBN
 * Open Library path for the edition carried into the guest handoff. No reader seed, account,
 * private notes, or provider credentials are used. */
export const GUEST_CATALOG = [
  {
    key: 'jane-eyre',
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    genre: 'literary',
    isbn: '9780141441146',
    cover: 'https://covers.openlibrary.org/b/isbn/9780141441146-L.jpg?default=false',
  },
  {
    key: 'left-hand-of-darkness',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    genre: 'sci-fi',
    isbn: '9780441478125',
    cover: 'https://covers.openlibrary.org/b/isbn/9780441478125-L.jpg?default=false',
  },
  {
    key: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    genre: 'horror',
    isbn: '9780141439471',
    cover: 'https://covers.openlibrary.org/b/isbn/9780141439471-L.jpg?default=false',
  },
  {
    key: 'braiding-sweetgrass',
    title: 'Braiding Sweetgrass',
    author: 'Robin Wall Kimmerer',
    genre: 'nonfiction',
    isbn: '9781571313560',
    cover: 'https://covers.openlibrary.org/b/isbn/9781571313560-L.jpg?default=false',
  },
  {
    key: 'acotar',
    title: 'A Court of Thorns and Roses',
    author: 'Sarah J. Maas',
    genre: 'fantasy',
    isbn: '9781619634442',
    cover: 'https://covers.openlibrary.org/b/isbn/9781619634442-L.jpg?default=false',
  },
  {
    key: 'throne-of-glass',
    title: 'Throne of Glass',
    author: 'Sarah J. Maas',
    genre: 'fantasy',
    isbn: '9781619630345',
    cover: 'https://covers.openlibrary.org/b/isbn/9781619630345-L.jpg?default=false',
  },
] as const

export function catalogIncoming(key: string): Incoming {
  const item = GUEST_CATALOG.find((book) => book.key === key)
  if (!item) throw new Error('Choose a book from the sample catalog.')
  const { first, last } = splitName(item.author)
  return {
    title: item.title,
    first,
    last,
    contributors: [{ name: item.author, role: 'author', position: 0 }],
    genre: item.genre,
    cover: item.cover,
    isbn: item.isbn,
  }
}

export function guestBook(id: string, incoming: Incoming): Book {
  return {
    title: incoming.title,
    first: '',
    last: '',
    contributors: [],
    series: '',
    position: '',
    seriesCount: null,
    status: 'standalone',
    genre: '',
    subgenre: '',
    subgenres: [],
    genres: [],
    tags: [],
    tropes: [],
    moods: [],
    intensity: null,
    darkness: null,
    cover: '',
    pages: null,
    isbn: '',
    fave: false,
    ownership: 'unowned',
    borrowed: false,
    wishlist: false,
    owned: { physical: false, ebook: false, audiobook: false },
    format: '',
    rating: 0,
    readStatus: 'unset',
    source: '',
    pub: { y: null, m: null, d: null },
    reads: [],
    plan: { y: null, m: null, d: null },
    progress: 0,
    addedTs: 0,
    ...Object.fromEntries(Object.entries(incoming).filter(([, value]) => value !== undefined)),
    id,
  }
}
