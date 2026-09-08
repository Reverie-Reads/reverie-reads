// Shapes of the relational rows (snake_case) as returned by Supabase/PostgREST.
// Mapped to/from the @reverie/core domain types in mappers.ts.

export interface BookRow {
  id: string
  owner_id: string
  corpus_work_id: string
  title: string
  author_first: string | null
  author_last: string | null
  series: string | null
  position: number | null
  series_count: number | null
  series_user_chosen: boolean
  /** Optional during the migration/web rolling window; the mapper fails closed to unknown. */
  series_claim?: unknown
  status: string | null
  genre: string | null
  subgenre: string | null
  subgenres: string[] | null
  genres: string[]
  tags: string[]
  intensity: number | null
  darkness: number | null
  cover_url: string | null
  cover_confidence: string | null
  cover_thumb_url: string | null
  cover_source: string | null
  cover_source_url: string | null
  cover_user_chosen: boolean
  cover_color: string | null
  isbn: string | null
  fave: boolean
  ownership: string
  /** null only from a row cached before the stage-A migration — mappers fall back to the old enum */
  borrowed: boolean | null
  wishlist: boolean | null
  owned_physical: string | null
  owned_ebook: boolean
  owned_audiobook: boolean
  format: string | null
  rating: number | null
  read_status: string
  source: string | null
  pages: number | null
  pub_y: number | null
  pub_m: number | null
  pub_d: number | null
  /**
   * DROPPED from `books` in 20260805010000 — never present on a row read from the database now.
   * Optional and still declared because archives written before that carry it, and `restoreBackup`
   * destructures it out so it never reaches the insert (see importExport.ts).
   */
  plan_date?: string | null
  plan_y: number | null
  plan_m: number | null
  plan_d: number | null
  /** Optional only during the migration/web rolling window. */
  plan_position?: number | null
  /** Optional only during the migration/web rolling window. */
  plan_intention?: string | null
  progress: number | null
  reading_position: number | null
  reading_now_hidden: boolean
  authors_display: string | null
  enriched_at: string | null
  added_at: string
  updated_at: string
  removed_at: string | null
  removed_by: string | null
  /** ordered contributor join (present when the books query selects it) */
  book_authors?: BookAuthorRow[]
  book_tropes?: { emphasis: string; tropes: { id: string; name: string } | null }[]
  /** reader-assigned mood join (present when the books query selects it) */
  book_moods?: { moods: { id: string; name: string } | null }[]
  tropes_suggested_at: string | null
}

/** A row of the book_authors join with its author embedded (PostgREST nested select). */
export interface BookAuthorRow {
  position: number
  role: string
  authors: { id: string; name: string } | null
}

export interface ListRow {
  id: string
  owner_id: string
  name: string
  kind: 'tbr' | 'collection'
  is_priority: boolean
  sort_order: number | null
  description: string | null
  created_at: string
  updated_at: string
}

export interface ReadRow {
  id: string
  book_id: string
  owner_id: string
  read_on: string | null
  format: string | null
  rating: number | null
  notes: string | null
  created_at: string
}
