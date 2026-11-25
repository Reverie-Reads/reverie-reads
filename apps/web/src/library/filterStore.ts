import { create } from 'zustand'
import {
  defaultFilters,
  type LibraryFilters,
  type LibraryShelfLink,
  type LibrarySort,
  type SeriesLenBucket,
} from '@reverie/core'

interface FilterState {
  filters: LibraryFilters
  panelOpen: boolean
  setQuery: (q: string) => void
  toggleTag: (t: string) => void
  setGenre: (g: string) => void
  setSub: (s: string) => void
  setStatus: (s: LibraryFilters['status']) => void
  setLen: (s: SeriesLenBucket) => void
  setRead: (s: LibraryFilters['read']) => void
  setEditionLabel: (s: string) => void
  setFormat: (s: string) => void
  setAuthor: (a: string) => void
  toggleCopyFacet: (key: 'specialEdition' | 'previouslyOwned') => void
  toggleFave: () => void
  toggleWishlist: () => void
  /** `null` toggles the NOT-ASSESSED selection — never folded into 0 (assessed as none) */
  toggleIntensity: (level: number | null) => void
  /** same contract as toggleIntensity, for the darkness axis */
  toggleDarkness: (level: number | null) => void
  setSort: (s: LibrarySort) => void
  setShelf: (s: LibraryShelfLink) => void
  togglePanel: () => void
  clear: () => void
}

export const useFilters = create<FilterState>((set) => ({
  filters: defaultFilters(),
  panelOpen: false,
  setQuery: (q) => set((s) => ({ filters: { ...s.filters, q } })),
  toggleTag: (t) =>
    set((s) => ({
      filters: {
        ...s.filters,
        tags: s.filters.tags.includes(t)
          ? s.filters.tags.filter((x) => x !== t)
          : [...s.filters.tags, t],
      },
    })),
  setGenre: (genre) => set((s) => ({ filters: { ...s.filters, genre } })),
  setSub: (sub) => set((s) => ({ filters: { ...s.filters, sub } })),
  setStatus: (status) => set((s) => ({ filters: { ...s.filters, status } })),
  setLen: (len) => set((s) => ({ filters: { ...s.filters, len } })),
  setRead: (read) => set((s) => ({ filters: { ...s.filters, read } })),
  setEditionLabel: (editionLabel) => set((s) => ({ filters: { ...s.filters, editionLabel } })),
  setFormat: (format) => set((s) => ({ filters: { ...s.filters, format } })),
  setAuthor: (author) => set((s) => ({ filters: { ...s.filters, author } })),
  toggleCopyFacet: (key) => set((s) => ({ filters: { ...s.filters, [key]: !s.filters[key] } })),
  toggleFave: () => set((s) => ({ filters: { ...s.filters, fave: !s.filters.fave } })),
  toggleWishlist: () => set((s) => ({ filters: { ...s.filters, wishlist: !s.filters.wishlist } })),
  toggleIntensity: (level) =>
    set((s) => ({
      filters: {
        ...s.filters,
        intensity: s.filters.intensity.includes(level)
          ? s.filters.intensity.filter((x) => x !== level)
          : [...s.filters.intensity, level],
      },
    })),
  toggleDarkness: (level) =>
    set((s) => ({
      filters: {
        ...s.filters,
        darkness: s.filters.darkness.includes(level)
          ? s.filters.darkness.filter((x) => x !== level)
          : [...s.filters.darkness, level],
      },
    })),
  setSort: (sort) => set((s) => ({ filters: { ...s.filters, sort } })),
  setShelf: (shelf) => set((s) => ({ filters: { ...s.filters, shelf } })),
  togglePanel: () => set((s) => ({ panelOpen: !s.panelOpen })),
  // Clear all facets but keep the search box and chosen sort (matches the prototype).
  clear: () =>
    set((s) => ({ filters: { ...defaultFilters(), q: s.filters.q, sort: s.filters.sort } })),
}))
