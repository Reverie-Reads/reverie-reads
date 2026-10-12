import { expect, it } from 'vitest'
import { makeBook } from '../../../../packages/core/src/book.fixture'
import type { CorpusRecord } from '../data/corpusEditions'
import { bookCorpusProposal } from './corpusPush'

const corpus: CorpusRecord = {
  id: 'work',
  title: 'Example',
  author: 'Writer',
  description: null,
  genre: 'fantasy',
  genres: ['fantasy'],
  subgenre: null,
  subgenres: [],
  spice: 3,
  darkness: 4,
  guidanceSource: null,
  isbns: ['9780306406157'],
  fingerprint: 'original',
  reports: [],
  history: [],
  editions: [
    {
      id: 'shared-edition',
      work_id: 'work',
      isbn: '9780306406157',
      details: {
        publisher: 'Known publisher',
        language: 'en',
        statement: 'Second printing',
        pages: 100,
      },
      reviewed: true,
      revision: 1,
      source_url: 'https://publisher.example/book',
    },
  ],
}
const book = makeBook({
  id: 'personal-book',
  title: 'Personal title',
  corpusWorkId: 'work',
  isbn: '0306406152',
  pages: 240,
  pub: { y: 2024, m: 6, d: null },
  genre: '',
  genres: [],
  subgenre: '',
  subgenres: [],
  intensity: null,
  darkness: 0,
  format: 'audiobook',
  rating: 5,
  planIntention: 'PRIVATE NOTE',
})
it('matches equivalent ISBNs, preserves unknown shared facts and never infers format from reading', () => {
  expect(bookCorpusProposal(book, corpus, 'edition', '', 'new')).toEqual({
    action: 'edition',
    value: {
      id: 'shared-edition',
      isbn: '9780306406157',
      details: {
        publisher: 'Known publisher',
        language: 'en',
        statement: 'Second printing',
        pages: 240,
        publication: { y: 2024, m: 6, d: null },
      },
    },
  })
})
it('shares only selected personal guidance, preserving unknowns and explicit zero', () => {
  expect(bookCorpusProposal(book, corpus, 'guidance', '', 'new')).toEqual({
    action: 'guidance',
    value: { genres: ['fantasy'], subgenres: [], spice: 3, darkness: 0 },
  })
})
it('requires an exact inventory edition and excludes private copy identities and labels', () => {
  const inventory = {
    version: 1 as const,
    editions: [
      {
        id: 'personal-edition',
        label: 'Private gift',
        format: 'hardcover' as const,
        isbn: '',
        publisher: 'Rare Press',
        published: '1902',
        pages: null,
        cover: '',
        sourceUrl: 'https://hardcover.app/books/private-reference',
      },
    ],
    copies: [
      {
        id: 'private-copy',
        editionId: 'personal-edition',
        state: 'owned' as const,
        label: 'For Mum',
        location: 'Bedroom',
      },
    ],
  }
  expect(() =>
    bookCorpusProposal({ ...book, copyInventory: inventory }, corpus, 'edition', '', 'new'),
  ).toThrow('Choose the exact edition')
  expect(
    bookCorpusProposal(
      { ...book, copyInventory: inventory },
      corpus,
      'edition',
      'personal-edition',
      'new',
    ),
  ).toEqual({
    action: 'edition',
    value: {
      id: 'new',
      isbn: null,
      details: {
        format: 'hardcover',
        publisher: 'Rare Press',
        publication: { y: 1902, m: null, d: null },
      },
    },
  })
})
it('refuses invalid ISBNs and mismatched works before a request exists', () => {
  expect(() =>
    bookCorpusProposal({ ...book, isbn: '9780306406158' }, corpus, 'edition', '', 'new'),
  ).toThrow('Correct the ISBN')
  expect(() =>
    bookCorpusProposal({ ...book, corpusWorkId: 'other' }, corpus, 'guidance', '', 'new'),
  ).toThrow('different corpus record')
})
it('reuses the attempted new edition after an explicit reload finds an ISBN-less save', () => {
  const record = {
    ...corpus,
    editions: [...corpus.editions, { ...corpus.editions[0]!, id: 'new', isbn: null }],
  }
  expect(bookCorpusProposal({ ...book, isbn: '' }, record, 'edition', '', 'new')).toMatchObject({
    value: { id: 'new' },
  })
})
it('requires a deliberate target when the corpus already has an ISBN-less edition', () => {
  const record = {
    ...corpus,
    editions: [{ ...corpus.editions[0]!, isbn: null }],
  }
  const isbnless = { ...book, isbn: '' }
  expect(() => bookCorpusProposal(isbnless, record, 'edition', '', 'new-id')).toThrow(
    'Choose an existing ISBN-less edition',
  )
  expect(
    bookCorpusProposal(isbnless, record, 'edition', '', 'new-id', 'shared-edition'),
  ).toMatchObject({ value: { id: 'shared-edition', isbn: null } })
  expect(bookCorpusProposal(isbnless, record, 'edition', '', 'new-id', 'new')).toMatchObject({
    value: { id: 'new-id', isbn: null },
  })
  expect(() =>
    bookCorpusProposal(isbnless, corpus, 'edition', '', 'new-id', 'shared-edition'),
  ).toThrow('no longer available')
})
