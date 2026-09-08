// Domain types — the client-side shapes the prototype's logic operates on
// (docs/reference/DATA_MODEL.md §1). Step 4 maps these to/from the relational rows in §2.

/** The reader's status on a book. 'unset' means *no selection* — cataloguing a book must not force
 *  a read state (docs/archive/task-ownership-v2.md). It is the default for a newly added book. */
export type ReadStatus = 'unset' | 'Unread' | 'Reading' | 'Read' | 'DNF'
/** The SERIES' publication status (is the series still being written?) — never the reader's
 *  position in it, which is derived from read states. */
export type SeriesStatus =
  | 'standalone'
  | 'ongoing'
  | 'completed'
  | 'on_hiatus'
  | 'cancelled'
  | 'interconnected_standalone'
  | 'interconnected_series'

/**
 * A date the reader may only partly know — any part may be null.
 *
 * Two fields carry this shape, and they are the SAME shape on purpose: the publish date (`pub_y /
 * pub_m / pub_d`) and the planned-read date (`plan_y / plan_m / plan_d`). Aliasing both to one
 * interface is what stops them drifting into two dialects — a change to the shape cannot reach one
 * without the other, and `formatPartialDate` renders both.
 */
export interface PartialDate {
  y: number | null
  m: number | null
  d: number | null
}

/** Flexible publish-date precision — any part may be null. */
export type PubDate = PartialDate

/**
 * Flexible planned-read precision. "Sometime in March" is `{y, m, d: null}` — a real plan, not an
 * incomplete one. Replaces the bare `plan_date` string, which could only say a specific day.
 */
export type PlanDate = PartialDate

/** One entry in a book's reread log. */
export interface ReadEntry {
  date: string
  format: string
  rating: number
  notes: string
  /** ISO timestamp of when the row was logged (`reads.created_at`). OPTIONAL, deliberately: the
   *  DB mapper always supplies it, but CSV imports and the merge/match paths construct entries
   *  from sources where no such timestamp exists. It is the rule-3 tiebreak for the per-format
   *  rating (same `read_on`, or both undated → the later-LOGGED read is the more recent
   *  statement); where it is absent the tiebreak honestly degrades to first-encountered. */
  createdAt?: string
}

/** Which formats the reader HAS (independent of the format read). `false` physical = not
 * possessed physically; a string narrows the physical copy. Meaningful when the book is in hand
 * (owned or borrowed) — a book that is neither carries latent flags that no surface reads: they are
 * SUPPRESSED, not cleared, so drop → re-acquire loses nothing (see bookOwnedFormats). */
export interface Owned {
  physical: false | 'paperback' | 'hardcover' | true
  ebook: boolean
  audiobook: boolean
}

/** Whether the reader OWNS a copy — the single claim this field makes (docs/archive/task-shelf-model.md).
 *  Borrowed and wishlist are no longer values here: they are independent flags on the book, because
 *  they can co-occur with ownership and with each other ("own the paperback, borrowed the audio,
 *  still want the special edition"). `unowned` is the default and asserts nothing beyond not owning
 *  — it is the old 'unset' under a name that matches the narrowed question.
 *  Possession never gates reading history: a book you've read is in your library whatever this says. */
export type BookOwnership = 'owned' | 'unowned'

/** The four-state possession WORD, derived from ownership + the two flags for controls and badges
 *  that must show one answer. Storage is five independent flags; this is a view of them, never a
 *  stored column. Precedence owned > borrowed > wishlist > unset — the old OWNERSHIP_RANK order. */
export type PossessionState = 'owned' | 'borrowed' | 'wishlist' | 'unset'

/** A contributor's role on a book. Ordered, multi-contributor (docs/reference/DATA_MODEL.md). `narrator` is
 * really audiobook-edition-scoped — kept as a role for now (edition-scoping is a later refinement). */
export type ContributorRole =
  | 'author'
  | 'co_author'
  | 'translator'
  | 'illustrator'
  | 'narrator'
  | 'editor'

/** One ordered contributor on a book (normalized: an `authors` row + a `book_authors` link). */
export interface Contributor {
  /** authors.id once persisted (absent for a not-yet-saved contributor) */
  id?: string
  name: string
  role: ContributorRole
  /** 0-based order within the book */
  position: number
}

/** An individual review from another reader — shown as a distinct voice, never averaged. */
export interface Review {
  id?: string
  by: string
  byName: string
  rating: number
  text: string
  date: string
}

/** Why the current personal series claim exists. `unknown` is the deliberate migration default:
 * historical rows are not reclassified merely because the new field exists. */
export type SeriesClaimOrigin = 'unknown' | 'reader' | 'import' | 'enrichment' | 'corpus'
export type SeriesClaimConfidence = 'high' | 'medium' | 'low' | 'none'

/** Field-level provenance for the personal compatibility series tuple. Structured membership will
 * become canonical in a later slice; until then this record prevents unlike writers from collapsing
 * into the same unflagged string. */
export interface SeriesClaim {
  origin: SeriesClaimOrigin
  source?: string
  sourceRef?: string
  confidence?: SeriesClaimConfidence
  at?: string
}

export interface Book {
  id: string
  /** Shared-corpus identity. Optional only for pre-migration backups and in-memory fixtures. */
  corpusWorkId?: string
  title: string
  /** Primary author's given/family name — kept as the back-compat denormalized primary (it equals
   *  contributors[0] with an author role). All ordered contributors live in `contributors`. */
  first: string
  last: string
  /** Ordered contributors (authors, co-authors, translators, …). Empty until the join is loaded;
   *  the primary author mirrors first/last. */
  contributors: Contributor[]
  series: string
  position: number | '' // fractional positions exist (e.g. 3.5); '' means unset
  seriesCount: number | null // null => length not set ("None set" filter)
  /** the reader named/cleared this series (any gesture) — enrichment NEVER overwrites it (non-overwrite rule, mirrors coverUserChosen) */
  seriesUserChosen?: boolean
  /** Why the current series tuple exists. Missing means a pre-migration/rolling-deploy row and is
   * read as `{ origin: 'unknown' }`; absence never licenses an inferred backfill. */
  seriesClaim?: SeriesClaim
  status: SeriesStatus
  /** Primary genre (lowercased CORE_GENRES key; drives skin + adaptive logic and picks the
   *  subgenre/trope vocabularies). '' = not chosen yet — the edit form prompts, never guesses. */
  genre: string
  /** Denormalized FIRST subgenre — kept equal to subgenres[0] (like first/last mirrors
   *  contributors[0]) so single-value readers (e.g. the subgenre gradient) stay cheap. */
  subgenre: string
  /** All subgenres (multi-select). The single `subgenre` mirrors element 0. */
  subgenres: string[]
  genres: string[]
  tags: string[] // legacy free tags (pre-trope-system; kept for search + fallback)
  /** when Hardcover community descriptors were last fetched for suggestions (null = never) */
  tropesSuggestedAt?: string | null
  /** the trope join, inline: pinned/present refs (loaded with the book like contributors) */
  tropes: { id: string; name: string; emphasis: 'pinned' | 'present' }[]
  /** reader-assigned moods (join, inline) — how the book LANDED on the reader. NEVER derived:
   *  absence is a valid, quiet state, never backfilled with a guess (docs/archive/task-mood.md). */
  moods: { id: string; name: string }[]
  intensity: number | null // 0..5, null = unset (HEAT — every skin labels this "Spice")
  darkness: number | null // 0..5, null = not assessed (DARKNESS/emotional intensity — a different axis from intensity; see labels.ts)
  cover: string
  /** confidence of the enrichment-resolved cover/match (E1); unset for user/seed covers (trusted).
   *  Drives the import-review "low-confidence cover" bucket. Union mirrors enrichResolve's Confidence. */
  coverConfidence?: 'high' | 'medium' | 'low' | 'none'
  /** ~300px stored thumbnail (grids/spines/shelves); unset until the cover has been ingested. */
  coverThumb?: string
  /** provenance of the current cover (hardcover | google | openlibrary | upload | camera | url) */
  coverSource?: string
  /** the external URL the stored cover was ingested from (re-fetch/provenance), where applicable */
  coverSourceUrl?: string
  /** the reader chose this cover (any sheet path) — enrichment NEVER overwrites it (non-overwrite rule) */
  coverUserChosen?: boolean
  /** dominant cover colour (hex), extracted at ingest — feeds the per-book spine tint */
  coverColor?: string
  isbn: string
  /** Page count for the edition in hand. null = UNKNOWN — renders blank, never a fabricated 0. */
  pages: number | null
  fave: boolean
  ownership: BookOwnership // owns a copy? presence in the library never implies possession
  owned: Owned // per-format detail for a book in hand (which formats)
  /** has a borrowed copy in hand — independent of `ownership`; borrowed is not owned */
  borrowed: boolean
  /** wants a copy — independent of `ownership`; an owned book can still be wanted in another edition */
  wishlist: boolean
  format: string // the format most often read (reread default)
  rating: number // 0..5 — the READER'S own rating (myRating). No aggregate exists anywhere.
  readStatus: ReadStatus
  source: string
  pub: PubDate
  reads: ReadEntry[]
  /** planned "need to read" date, at whatever precision the reader actually has */
  plan: PlanDate
  /** Queue membership and private preference order. Non-null with an empty date means "Soon". */
  planPosition?: number | null
  /** Optional note to the reader's future self for this plan; never a review or reading note. */
  planIntention?: string
  progress: number // 0..100 while Reading
  /** manual Reading Now order (spaced numeric; null = unordered, sorts by recency) */
  readingPosition?: number | null
  /** hidden from the home Reading Now display without changing status/progress */
  readingNowHidden?: boolean
  addedTs: number
}

/** A TBR or a collection. */
export interface List {
  id: string
  name: string
  priority?: boolean
  ids: string[]
}

// --- Clubs & sharing (capability-keyed documents, docs/reference/DATA_MODEL.md §1) ---

export type ClubUnitType = 'chapter' | 'page' | 'percent'

export interface ClubUnit {
  type: ClubUnitType
  count: number
  label: string
}

export interface ClubMember {
  id: string
  name: string
  progress: number
}

export interface ClubComment {
  id: string
  by: string
  byName: string
  unit: number
  text: string
  ts: number
}

export interface Club {
  type: 'club'
  title: string
  author: string
  cover: string
  unit: ClubUnit
  members: ClubMember[]
  comments: ClubComment[] // visible only where unit <= my progress (see spoiler.ts)
  updatedAt: number
}

export interface SharedListItem {
  id: string
  title: string
  author: string
  cover: string
  by: string
}

export interface SharedList {
  type: 'list'
  kind: 'list' | 'clubtbr'
  name: string
  items: SharedListItem[]
  updatedAt: number
}
