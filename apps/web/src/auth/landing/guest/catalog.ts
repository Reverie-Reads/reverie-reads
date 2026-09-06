import { splitName, type Book, type Incoming } from '@reverie/core'

/** Public bibliographic facts from the landing's existing catalog examples. Each Google Books
 * URL points at a verified edition whose zoom=0 render is at least 800px wide. CoverImage chooses
 * that full tier for the prominent landing demo and the lighter tier inside ordinary app grids.
 * No reader seed, account, private notes, or provider credentials are used. */
export const GUEST_CATALOG = [
  {
    key: 'jane-eyre',
    title: 'Jane Eyre',
    author: 'Charlotte Brontë',
    genre: 'literary',
    cover:
      'https://books.google.com/books/content?id=VIdMOzpFBgoC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
  {
    key: 'left-hand-of-darkness',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    genre: 'sci-fi',
    cover:
      'https://books.google.com/books/content?id=f9QiDQAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
  {
    key: 'frankenstein',
    title: 'Frankenstein',
    author: 'Mary Shelley',
    genre: 'horror',
    cover:
      'https://books.google.com/books/content?id=6W24a29p9GQC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
  {
    key: 'braiding-sweetgrass',
    title: 'Braiding Sweetgrass',
    author: 'Robin Wall Kimmerer',
    genre: 'nonfiction',
    cover:
      'https://books.google.com/books/content?id=vmM9BAAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
  {
    key: 'acotar',
    title: 'A Court of Thorns and Roses',
    author: 'Sarah J. Maas',
    genre: 'fantasy',
    cover:
      'https://books.google.com/books/content?id=E-kdBQAAQBAJ&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
  },
  {
    key: 'throne-of-glass',
    title: 'Throne of Glass',
    author: 'Sarah J. Maas',
    genre: 'fantasy',
    cover:
      'https://books.google.com/books/content?id=mezhxQ0twPUC&printsec=frontcover&img=1&zoom=1&edge=curl&source=gbs_api',
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
