// Public book facts only. Moods, relationships, and reading history below are authored design
// fixtures, not corpus classification or the account owner's data. No image bytes are redistributed.
export interface StudyBook {
  id: string
  title: string
  author: string
  genre: string
  year: number
  cover: string
  description: string
  source: string
  sourceLabel: string
  moods: string[]
}

export const books: StudyBook[] = [
  {
    id: 'earthsea',
    title: 'A Wizard of Earthsea',
    author: 'Ursula K. Le Guin',
    genre: 'Fantasy',
    year: 1968,
    cover:
      'https://static1.squarespace.com/static/5cad42ef90f904e520359371/t/619567d82e86c774b1e9502f/1659569078633/Wizard+of+Earthsea.jpg?format=1000w',
    description:
      'A young wizard’s hunger for knowledge releases a shadow he must learn to face. Ged’s journey through an island world becomes a reckoning with power and responsibility.',
    source: 'https://www.ursulakleguin.com/a-wizard-of-earthsea',
    sourceLabel: 'Ursula K. Le Guin’s official site',
    moods: ['Reflective', 'Adventurous'],
  },
  {
    id: 'psalm',
    title: 'A Psalm for the Wild-Built',
    author: 'Becky Chambers',
    genre: 'Science fiction',
    year: 2021,
    cover: 'https://mpd-biblio-covers.imgix.net/9781250236210.jpg?w=1000',
    description:
      'A travelling tea monk meets a robot with a question: what do people need? Their encounter opens a conversation about purpose, rest, and having enough.',
    source: 'https://us.macmillan.com/books/9781250236210/apsalmforthewildbuilt/',
    sourceLabel: 'Macmillan / Tordotcom',
    moods: ['Reflective', 'Hopeful'],
  },
  {
    id: 'sweetgrass',
    title: 'Braiding Sweetgrass',
    author: 'Robin Wall Kimmerer',
    genre: 'Nonfiction',
    year: 2013,
    cover:
      'https://books.google.com/books/content?id=vmM9BAAAQBAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api',
    description:
      'A botanist and Citizen Potawatomi Nation member brings scientific knowledge and Indigenous teachings into conversation, exploring reciprocity with the living world.',
    source: 'https://milkweed.org/book/braiding-sweetgrass',
    sourceLabel: 'Milkweed Editions',
    moods: ['Reflective', 'Hopeful'],
  },
  {
    id: 'tombs',
    title: 'The Tombs of Atuan',
    author: 'Ursula K. Le Guin',
    genre: 'Fantasy',
    year: 1971,
    cover:
      'https://static1.squarespace.com/static/5cad42ef90f904e520359371/t/6195680011cf9f7c29de57e3/1637181440287/tombs-saga.jpg?format=1000w',
    description:
      'Chosen to guard the labyrinthine Tombs of Atuan, Tenar has surrendered her name and former life. An intruder brings the possibility of a different future.',
    source: 'https://www.ursulakleguin.com/the-tombs-of-atuan',
    sourceLabel: 'Ursula K. Le Guin’s official site',
    moods: ['Unsettling', 'Adventurous'],
  },
]

export const anchors = [
  {
    id: 'left-hand',
    title: 'The Left Hand of Darkness',
    author: 'Ursula K. Le Guin',
    genre: 'Science fiction',
    cover:
      'https://books.google.com/books/content?id=f9QiDQAAQBAJ&printsec=frontcover&img=1&zoom=0&source=gbs_api',
  },
  {
    id: 'earthsea',
    title: 'A Wizard of Earthsea',
    author: 'Ursula K. Le Guin',
    genre: 'Fantasy',
    cover: books[0]!.cover,
  },
]

export type Direction = 'anchor' | 'mood' | 'stretch'
export const directions: { id: Direction; title: string; description: string; glyph: string }[] = [
  {
    id: 'anchor',
    title: 'More like a book I loved',
    description: 'Begin with a book that stayed with you.',
    glyph: 'book',
  },
  {
    id: 'mood',
    title: 'Meet me in this mood',
    description: 'A little of what you need right now.',
    glyph: 'moon',
  },
  {
    id: 'stretch',
    title: 'Somewhere a little different',
    description: 'Let your curiosity lead to another shelf.',
    glyph: 'compass',
  },
]
export const moods = ['Reflective', 'Hopeful', 'Unsettling', 'Adventurous']

// Deterministic fixtures demonstrate the interaction contract. They are deliberately separate
// from the production ranking engine, and all interpretation is identified as editorial.
export function selectBooks(
  direction: Direction,
  anchorId: string,
  selectedMoods: string[],
  genre: string,
): StudyBook[] {
  if (direction === 'mood')
    return books.filter((b) => selectedMoods.every((m) => b.moods.includes(m))).slice(0, 3)
  if (direction === 'stretch') return books.filter((b) => b.genre === genre).slice(0, 3)
  return anchorId === 'earthsea' ? [books[3]!, books[1]!] : [books[0]!, books[1]!, books[3]!]
}

export function reasonFor(
  book: StudyBook,
  direction: Direction,
  anchorId: string,
  selectedMoods: string[],
  genre: string,
): string {
  if (direction === 'mood')
    return `An editorial ${selectedMoods.map((m) => m.toLowerCase()).join(' + ')} pick. See the description to decide if it fits.`
  if (direction === 'stretch')
    return `You chose ${genre.toLowerCase()}. A different shelf to explore at your own pace.`
  const anchor = anchors.find((a) => a.id === anchorId)!
  if (book.author === anchor.author)
    return `Another book by ${anchor.author}, the author of ${anchor.title}.`
  if (book.genre === anchor.genre)
    return `More ${anchor.genre.toLowerCase()}, the genre you started from.`
  return 'An editorial suggestion to explore alongside your starting book.'
}
