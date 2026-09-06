# Data model

**This describes what is built, not what is proposed.** The client shapes in §1 are the
authoritative TypeScript in `packages/core/src/types.ts`; the tables in §2 are the
accumulated result of `supabase/migrations/`. When this file and either of those disagree,
they are right and this is stale — fix it here.

Read this before writing code that touches a book. Several fields changed meaning after the
prototype (`spice` → `intensity`, `status` → the series' publication status, ownership from
two states to four), and the old names are still the intuitive guess.

---

## 1. Client state

Books, lists and reads come from Supabase through TanStack Query. Only preferences and the
share registry are ambient:

```jsonc
{
  books: [ Book, … ],
  lists: [ List, … ],          // TBRs and collections; one may be priority
  me:    { id, name },         // profile identity (clubs/shares)
  shared:{ lists: [ {code,name,kind} ], clubs: [ {code,name,cover} ] },
  skin:  SkinId,               // one of NINE skins — see below; `mode` is light/dark/system
  goal:  { year, target } | null
}
```

> **There are nine skins, not two themes.** `tryst`, `grimoire`, `aphelion`, `marrow`,
> `umbra`, `folio`, `hearth`, `almanac`, `bloom` (`packages/core/src/skins.ts`). Each carries
> its own token set and its own light/dark pair. "Nocturne / Magnolia Dawn" is prototype-era
> vocabulary and no longer names anything in the code.

### Book

The full shape is `Book` in `packages/core/src/types.ts`, which carries per-field doc
comments. Reproduced here with the parts that most often get guessed wrong called out:

```jsonc
{
  id, corpusWorkId, title,      // stable link to the shared works row
  first, last,                 // primary author, denormalized — mirrors contributors[0]
  contributors: [ { id?, name, role, position } ],   // ordered; role ∈ author | co_author |
                                                     // translator | illustrator | narrator | editor

  // --- series ---
  series,
  position: number | '',       // fractional positions exist (3.5); '' = unset
  seriesCount: number | null,  // null => "length not set" (drives the "None set" filter)
  seriesUserChosen?: boolean,  // compatibility reader-gesture guard; provenance below is richer
  seriesClaim?: {              // current source of the personal series value (including a clear)
    origin: 'unknown' | 'reader' | 'import' | 'enrichment' | 'corpus',
    source?: string, sourceRef?: string,
    confidence?: 'high' | 'medium' | 'low' | 'none',
    at?: string
  },
  status: SeriesStatus,        // the SERIES' publication status — NOT the reader's position:
                               // 'standalone' | 'ongoing' | 'completed' | 'on_hiatus'
                               // | 'cancelled' | 'interconnected_standalone'
                               // | 'interconnected_series'

  // --- taxonomy ---
  genre: string,               // PRIMARY genre, lowercased CORE_GENRES key. Drives the skin,
                               // the adaptive logic, and which subgenre/trope vocabulary the
                               // pickers offer. '' = not chosen — the form prompts, never guesses.
  subgenre: string,            // denormalized FIRST subgenre — kept equal to subgenres[0]
  subgenres: string[],         // multi-select, and NOT scoped to `genre`: storage is a flat
                               // text[] and the picker discloses the other genres' vocabulary
  genres: string[],            // secondary genre tags
  tags: string[],              // legacy free tags (pre-trope-system) — kept for search/fallback

  tropes: [ { id, name, emphasis: 'pinned' | 'present' } ],   // a JOIN, not an array of strings
  tropesSuggestedAt: string | null,                           // last Hardcover descriptor fetch
  moods:  [ { id, name } ],    // reader-assigned. NEVER derived — absence is a valid, quiet
                               // state and is never backfilled with a guess

  intensity: number | null,    // 0..5, null = unset. Was `spice`; the Tryst skin still LABELS
                               // it "Spice", but no other skin does and the field is neutral.

  // --- cover + provenance ---
  cover, coverThumb?,          // full + 720px stored card derivative (grids/spines/shelves)
  coverSource?: string,        // hardcover | google | openlibrary | upload | camera | url
  coverSourceUrl?: string,     // the external URL it was ingested from
  coverUserChosen?: boolean,   // the reader picked it — enrichment NEVER overwrites it
  coverColor?: string,         // dominant hex, extracted at ingest; feeds the spine tint
  coverConfidence?: 'high' | 'medium' | 'low' | 'none',       // enrichment match confidence

  isbn,
  pages: number | null,        // null = UNKNOWN → renders blank, never a fabricated 0
  fave: boolean,

  // --- possession (FIVE independent flags — see below) ---
  ownership: 'owned' | 'unowned',   // do you own a copy? default 'unowned'
  borrowed: boolean,                // have one on loan — independent of ownership
  wishlist: boolean,                // want one — independent of both
  owned: {                     // WHICH formats, for a book in hand
    physical: false | 'paperback' | 'hardcover' | true,
    ebook: boolean,
    audiobook: boolean
  },
  format: string,              // the format most often read (reread default)

  // --- the reader's own record ---
  rating: number,              // 0..5, the READER'S rating. No aggregate exists anywhere.
  readStatus: 'unset' | 'Unread' | 'Reading' | 'Read' | 'DNF',   // 'unset' is the DEFAULT
  source: string,
  pub: { y, m, d },            // any part may be null (flexible precision)
  reads: [ { date, format, rating, notes } ],   // reread log; format read may differ from owned
  plan: string | null,         // planned "need to read" date, YYYY-MM-DD
  progress: number,            // 0..100 while Reading
  readingPosition?: number | null,   // manual Reading Now order (spaced numeric)
  readingNowHidden?: boolean,        // hidden from Reading Now without changing status/progress
  addedTs
}
```

#### Possession is five independent flags

`ownership` answers one question — _do you own a copy_ — and nothing else. Borrowed and
wishlist are **flags beside it, not values inside it**, because they co-occur with ownership
and with each other. `owned` answers _which formats_.

| field                             | meaning                                                                                                            |
| --------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `ownership`                       | `'owned'` = the reader owns a copy; `'unowned'` = they do not. **Default `'unowned'`** — a bare add claims nothing |
| `borrowed`                        | has a copy on loan (library, a friend). **In hand:** carries a format, stays in the default library                |
| `wishlist`                        | wants a copy. An owned book can still be wanted in another edition                                                 |
| `owned.physical`                  | `false` \| `'paperback'` \| `'hardcover'` \| `true` — which physical copy, if any                                  |
| `owned.ebook` / `owned.audiobook` | boolean, same idea                                                                                                 |

**All combinations are legal and the schema constrains none of them.** "Owned in paperback,
borrowed the audio, still want the special edition" is a real reader state.

Two derived helpers, neither of them stored:

- `possessionState(book)` → the one WORD a control or badge shows: `owned` > `borrowed` >
  `wishlist` > `unset`, in that precedence. Lossy by design (an owned-and-wanted book reads
  `owned`); storage keeps both. `possessionPatch(word)` is the inverse a four-state control
  writes — picking a word is exclusive, so it clears the others.
- `isPossessed(book)` = `ownership === 'owned' || borrowed` — **in hand**. This is the gate for
  format detail and the default library.

> **Never infer possession from the `owned` booleans.** `all-false = wishlist` was the pre-#68
> model and has been wrong ever since. A not-in-hand book carries whatever latent format flags
> it happens to have and no surface reads them — `bookOwnedFormats` **suppresses, never clears**,
> so drop → re-acquire loses nothing.
>
> Possession never gates reading history: a book you have read — or abandoned — is in your
> library whatever these flags say.

The **Owned · Physical / Ebook / Audiobook** shelves are _smart shelves_ derived from
`isPossessed` + `owned`, not manual lists. Ownership is independent of `reads[].format` — you
can read a borrowed copy you don't own.

#### Library scope: two predicates that disagree on DNF, deliberately

- `isBookRead(b)` — `readStatus === 'Read'` or any logged read. Feeds series progress, the taste
  profile, stats and the matcher. **DNF is not read**, and must stay that way: an abandoned book
  would otherwise overstate a series' completion and teach the recommender from a bail-out.
- `hasReadingHistory(b)` — `isBookRead(b) || readStatus === 'DNF'`. Feeds **visibility only**.
- `inDefaultLibrary(b)` = `isPossessed(b) || hasReadingHistory(b)`.

A DNF book you never owned used to be invisible: not in hand, not read, so outside the default
scope and reachable only through the wishlist chip — a book the reader definitely handled, hidden
by a predicate meant to hide books they had not.

#### Ratings

`rating` (the prototype called it `myRating`) is the reader's own, alongside per-read
ratings in `reads[]`. **Never compute or display an average.** `reviews` are individual
entries from other readers, surfaced only when the reader opts to look, and shown as a list
of distinct voices — never reduced to a headline number. There is no aggregate column
anywhere in the schema, by design.

### List (TBR or collection)

```jsonc
{ id, name, priority?: bool, ids: [ bookId, … ] }
```

### Shared documents (capability-keyed; stored remotely under a share code)

```jsonc
// shared list / book-club TBR
{ type:"list", kind:"list"|"clubtbr", name, items:[{id,title,author,cover,by}], updatedAt }

// read-along
{ type:"club", title, author, cover,
  unit:{ type:"chapter"|"page"|"percent", count, label },
  members:[ {id,name,progress} ],
  comments:[ {id,by,byName,unit,text,ts} ],   // visible only if unit <= my progress
  updatedAt }
```

---

## 2. Relational schema

Postgres, row-level security scoped to the authenticated user on every user-owned table.
Column lists below are indicative of shape; `supabase/migrations/` is authoritative.

```sql
profiles            (id pk = auth user, display_name, created_at,
                     skin text not null default 'tryst',     -- one of the nine
                     mode text not null default 'system',    -- light | dark | system
                     goal_year, goal_target,
                     adaptive_skin jsonb, adaptive_pending jsonb,
                     adaptive_dismissed jsonb, adaptive_locked bool,
                     auto_merge_duplicates bool not null default true,
                     default_store_id, default_store_name, default_store_website,
                     arrangement jsonb not null)          -- versioned priority nav + Home modules

books               (id pk, owner_id fk→profiles, corpus_work_id fk→works not null, title,
                     author_first, author_last, authors_display,
                     series, position numeric, series_count smallint,
                     series_user_chosen boolean, series_claim jsonb not null,
                                          -- current field provenance; old rows are origin=unknown
                     status text,          -- books_status_check: the 7 SeriesStatus values
                     genre text not null default 'romance',
                     subgenre text, subgenres text[] not null default '{}',
                     genres text[], tags text[],      -- `tags` was renamed FROM `tropes`
                     intensity smallint,              -- renamed FROM `spice`
                     cover_url, cover_thumb_url, cover_source, cover_source_url,
                     cover_user_chosen bool not null default false,
                     cover_color, cover_confidence,
                     isbn, pages integer,             -- books_pages_check: null or 1..20000
                     fave bool,
                     ownership text not null default 'unowned',
                                          -- books_ownership_check: owned|unowned
                     borrowed boolean not null default false,
                     wishlist boolean not null default false,
                     owned_physical text, -- null | 'paperback' | 'hardcover' | 'yes'
                     owned_ebook bool, owned_audiobook bool,
                     format, rating numeric(2,1),
                     read_status text not null default 'unset',
                                          -- books_read_status_check: unset|Unread|Reading|Read|DNF
                     source, pub_y, pub_m, pub_d,     -- flexible precision; m/d range-checked
                     plan_y, plan_m, plan_d, progress smallint,
                     reading_position numeric, reading_now_hidden bool,
                     enriched_at, tropes_suggested_at,
                     added_at, updated_at,
                     removed_at, removed_by)          -- soft personal-library removal
                     -- corpus_work_id is immutable to authenticated owner updates; insert and
                     -- server rebind resolve one unique ISBN or Unicode title/full-author match
                     -- NOTE: no aggregate_rating column, and there will not be one.

-- contributors: ordered, multi-role. `books.author_first/last` stay as the denormalized primary.
authors             (id pk, owner_id fk, name, name_key, created_at,
                     unique (owner_id, name_key))     -- name_key matches core normalizeName
book_authors        (book_id fk, author_id fk, owner_id fk, position int, role text,
                     primary key (book_id, author_id, role))

-- tropes: a curated join with EMPHASIS, plus a suggestion inbox. Not a text[].
tropes              (id pk, owner_id fk null → canonical, canonical_id fk, name, aliases text[],
                     facet text,          -- dynamics|plot|characters|setting_world|vibe
                     genre_affinity text[],   -- an ORDERING HINT, never a gate
                     created_at)
book_tropes         (book_id fk, trope_id fk, owner_id fk,
                     emphasis text not null default 'present',   -- 'pinned' | 'present'
                     added_at, primary key (book_id, trope_id))
work_tropes         (work_id fk, trope_id fk, added_by fk, source_scope,
                     added_at, primary key (work_id, trope_id))
                     -- canonical, additive corpus associations. An administrator's new personal
                     -- or household assignment promotes here; deleting the scoped assignment does
                     -- not retract the accepted corpus fact. `vote` is reserved for the separately
                     -- designed three-reader authorization mechanism.
trope_suggestions   (book_id fk, trope_id fk, owner_id fk, source, state 'open'|'dismissed',
                     created_at, primary key (book_id, trope_id))

-- moods: reader-assigned only. Nothing derives or backfills these.
moods               (id pk, owner_id fk null → canonical, canonical_id fk, name, created_at)
book_moods          (book_id fk, mood_id fk, owner_id fk, added_at,
                     primary key (book_id, mood_id))

reads               (id pk, book_id fk, owner_id fk, read_on date, format, rating, notes,
                     created_at)          -- the reread log
reviews             (id pk, work_key text, reviewer_id fk, reviewer_name, rating, body,
                     created_at, unique (work_key, reviewer_id))
                     -- keyed by WORK, not book_id: reviews are cross-library, readable by all
                     -- authenticated users, writable only by their author. Never averaged.

-- series: a first-class record with an ordered entry list that may contain GHOSTS
-- (a slot for a book the reader doesn't own yet).
series              (id pk, owner_id fk, name, status, source 'manual'|'hardcover',
                     source_ref, refreshed_at, archived_at, created_at,
                     unique (owner_id, name))
series_entries      (id pk, series_id fk, owner_id fk,
                     position numeric,      -- canonical volume number, e.g. 3.5
                     sort_order numeric,    -- private reader shelf order; never displayed as volume
                     sort_user_edited bool,
                     label,
                     title, author,       -- ghost display fields; a linked entry renders the book
                     book_id fk null, source, user_edited bool,
                     is_primary bool,
                     archive_primary_intent bool,
                     membership_claim jsonb, -- unknown|reader|import|enrichment|corpus
                     position_claim jsonb,   -- independent provenance for the canonical volume
                     removed_at timestamptz,      -- SOFT-DELETE TOMBSTONE — see below
                     created_at)

`series` + `series_entries` are the personal membership authority. A book may have several live
entries in different series, but exactly one may be `is_primary`; that entry projects its series
name, position, and series length back to `books.series/position/series_count` for legacy consumers.
A secondary membership never changes those scalar fields. Existing pre-Phase-2B entries default to
`is_primary=false` with both claims `origin=unknown` and stay excluded from progress/gaps until an
explicit review. Trusted forward Add/import/corpus claims and high-confidence enrichment claims
materialize transactionally; opening a series page performs no write. Membership provenance and
position provenance are separate because knowing that a book belongs does not prove its number.
`sort_order` is a third, private fact: moving a title earlier or later changes only the shelf order,
never `position` or `books.position`. The interface can therefore render an item as fourth in the
reading order while retaining its canonical volume number 3.5. Midpoint decimals used to persist a
drag are implementation details and are never presented to the reader.
User-facing series deletion is a reversible archive: `series.archived_at` hides the series and all
of its entries from ordinary authenticated reads without deleting the series, books, reading
history, live slots, ghosts, or removal tombstones. `archive_primary_intent` remembers the exact
memberships whose compatibility projection was suspended. Restore promotes one only when the book
has no newer active primary choice; otherwise that restored membership remains secondary.

lists               (id pk, owner_id fk, name, kind 'tbr'|'collection', is_priority bool,
                     sort_order numeric, description, created_at)
list_items          (list_id fk, book_id fk, owner_id fk, position, added_at,
                     primary key (list_id, book_id))

### The nullable-ordering class — CLOSED, three of three (2026-08-20)

**The pattern: a nullable ordering column, no default, read without a tiebreak.** One grep found
three instances and **two were shipping defects**, which is why the pattern is named here rather
than left as three fixes.

| column | what it turned out to be | closed by |
| --- | --- | --- |
| `lists.sort_order` | **real, data loss** — a backup restore wrote NULL for every shelf, destroying the reader's manual arrangement in the one operation whose purpose is destroying nothing | #294 |
| `reads.read_on` | **real, nondeterminism** — ties produced an unstable per-format rating under the audiobook-vs-print surface; the "dated beats undated" rule was holding by accident | #296 |
| `list_items.position` | **real but narrow, display instability** — three ordinary write paths (add-one, bulk-add, CSV import) left NULL, so an imported shelf collapsed to one sort key and reshuffled between fetches. No data loss: restore already preserved positions | this entry's PR |

**What generalises, for the next reader.** A nullable ordering column is only safe if BOTH halves
hold: every write path sets it (one shared helper, not a per-site re-implementation — see
`nextListSortOrderFor` / `nextItemPositionFor`), and the read is a TOTAL order (`series.ts`'s
entries query is the reference: value, then a meaningful tiebreak, then an identity tiebreak).
Client-side sorting is fine; a client-side sort over an unordered fetch is not, because
`Array.prototype.sort` is stable and therefore faithfully preserves arbitrary input order.

**Pick the tiebreak for meaning, not convenience.** `list_items` already carried
`added_at NOT NULL DEFAULT now()`, so its unpositioned rows order as "the order you added them"
rather than by a random uuid — same determinism, an order a reader can actually recognise. Check
for such a column before reaching for the primary key.

**No migration in any of the three.** Existing NULLs are made deterministic at READ time; a
`NOT NULL` backfill stays a separate decision, and #294's step-4 reasoning (enumerate every write
path first) is the precedent.

**Breaking ties totally is one of TWO correct answers — the other is preventing them.** This repo
already does both: `series_entries_position_uidx` (`20260816010000`) is a partial unique index on
`(series_id, position) where removed_at is null`, over a `position numeric NOT NULL` column — so a
live-position tie is IMPOSSIBLE at write time rather than resolved at read time (verified against
the migration and `20260716010000`'s column definition before citing it here). Roughly when each
fits: **prevention** where the column is authoritative and every write goes through controlled
paths (series positions: NOT NULL, RPC-managed, and a collision is a data defect worth rejecting);
**total ordering at read** where NULLs are legitimate values the read has to cope with
(`read_on` — an undated read is real data; `sort_order`/`position` pre-backfill).

**Nullability is the discriminator, not a circumstance — check it and the answer follows.**
Postgres treats NULLs as DISTINCT in a unique index, so a constraint on a nullable column has
nothing to grip: verified on this project's server (PostgreSQL 17.6, config pins major 17), a
plain `UNIQUE (parent, pos)` accepted three `(1, NULL)` rows without complaint. So: column is
`NOT NULL` → prevention is available (that NOT NULL on `series_entries.position` is what makes
`series_position_uidx` bite); NULLs are legitimate data → only total read ordering works, because
no ordinary constraint can reach the NULLs — and a read-side tiebreak, conversely, cannot stop two
writers committing the same value. The class's own three members are the evidence: all three were
NULLABLE ordering columns, which is exactly why prevention was never on the table for any of them.
One closure so the third shape isn't proposed later: PostgreSQL 15+'s `UNIQUE NULLS NOT DISTINCT`
CAN constrain NULL ties (verified here too — it rejected a second `(1, NULL)` row), and that is
precisely why it does not fit ordering columns: it permits exactly ONE unpositioned row per
parent, and "not yet positioned" is a state many rows legitimately share at once (#298's bulk-add
and CSV import wrote whole batches of them).

households           (id pk, name, created_at, updated_at)
household_members    (household_id fk, user_id fk unique, role 'owner'|'member',
                     allow_member_library_adds boolean default false, joined_at,
                     primary key (household_id, user_id))
household_works      (household_id fk, work_id fk→works, added_by, inclusion_source,
                     added_at, removed_at, removed_by,
                     primary key (household_id, work_id))
household_book_shares(book_id fk→books, household_id fk, work_id fk, shared_by, shared_at,
                     removed_at, removed_by)          -- per-person borrowed checkbox source
household_work_enrichment
                    (household_id, work_id, tags text[], tropes jsonb, updated_by, updated_at,
                     primary key (household_id, work_id))

works                (id pk, work_key unique, work_id, title, contributors jsonb, author_text,
                     series/position/count/status, series_check_state/checked_at/source,
                     series_check_evidence jsonb, series_check_reason, pages, publication date,
                     publisher, language, description, edition_ids text[],
                     cover_url/source/source_url/color/confidence, cover_options jsonb,
                     genre, subgenre, genres text[], subgenres text[], tags text[], isbns text[],
                     metadata_provenance jsonb, enrichment_confidence, enriched_at,
                     metadata_status, creation_source, created_by, created_at, updated_at)
                     -- work_key preserves Unicode letters/numbers after NFKD + mark removal;
                     -- creation_source may be reconciliation for an ambiguous safe refusal;
                     -- canonical ISBN-13 assignments serialize in sorted advisory-lock order
work_metadata_edits  (id pk, work_id fk, editor_id, previous_value jsonb, next_value jsonb,
                     created_at)                      -- append-only corpus edit audit
work_series_suggestions
                    (id pk, work_id fk, proposed_series/position/count, source/source_ref,
                     identity_confidence, membership confidence, evidence jsonb, reason,
                     status, checked/review fields)
                     -- singleton/conflicting relational evidence waits for an administrator
corpus_series       (id pk, name/name_key, creator_key, status, declared_count,
                     catalog_state, evidence jsonb, revision, reviewed_by,
                     archived_at, merged_into, timestamps)
corpus_series_names (id pk, series_id fk, name/name_key, creator_key,
                     kind canonical|alias, source/source_ref, created_at)
corpus_series_sources
                    (id pk, series_id fk, source/source_ref unique, evidence, observed_at)
corpus_series_entries
                    (id pk, series_id fk, work_id fk null, position, label, title/author_text,
                     is_primary, archive_primary_intent, membership_claim, position_claim,
                     evidence, source/source_ref, removed_at, timestamps)
                     -- unbound slots retain known books not yet represented by a corpus work
corpus_series_edits (id pk, series_id/editor_id fk null, action,
                     previous_value/next_value jsonb, created_at)
                     -- append-only administrator and synchronization audit
corpus_admins        (user_id pk fk→profiles, granted_at, granted_by fk→profiles)
                     -- service-managed authorization; never restored from a reader backup
corpus_cover_recovery_marks
                    (book_id pk fk→books, source_fingerprint, succeeded, error_message,
                     retry_after, attempt_count, recovered_by fk→profiles, recovered_at)
                     -- internal resumability state; API roles have no direct table access

clubs               (id pk, title, author, cover_url,
                     unit_type 'chapter'|'page'|'percent', unit_count, unit_label,
                     created_by fk, created_at)
club_members        (club_id fk, user_id fk, display_name, progress int, joined_at,
                     primary key (club_id, user_id))
club_comments       (id pk, club_id fk, user_id fk, unit int, body, created_at)

shared_docs         (key text pk, value jsonb, updated_at)   -- the shared doc itself; the
                     -- share CODE is the key, and knowing it is the capability (RLS is open)
shared_refs         (owner_id fk, code, kind 'list'|'clubtbr', name, created_at,
                     primary key (owner_id, code))           -- a reader's joined codes
```

Also present, supporting features rather than the core library: `book_embeddings` and
`match_feedback` (taste/semantic search, pgvector), `enrichment_cache` / `cover_cache` /
`geo_cache` / `releases_cache`, `rate_limits`, `content_reports`, `merge_verdicts`,
`author_follows`.

`reading_orders` / `reading_order_items` are **not present**. They were dropped by
`20260730010000_drop_reading_orders.sql` after their product surface was retired. Proposed
connected-series universes are documented separately in `docs/decisions/0007-series-universes.md`;
they are not part of the built schema described here.

**Personal, household, and corpus membership are independent.** `books` is owner-only reader state;
`household_works` is collective membership; `works` is shared catalog identity. Owned personal
copies ensure household membership. Borrowed copies create a per-book share only after the reader
checks the household control. Wishlist and reading state never create household membership.

`household_library_works()` returns one curated row per work plus only active possession/copy
attribution. It deliberately omits ratings, favourites, read state/logs, notes, intensity/darkness,
plans/progress, wishlist, moods, and lists. Household tags/tropes live in the household overlay;
genre, subgenre, and cover candidates flow to the corpus through an attributable allowlisted path.
An eligible copy's personal cover URL, thumbnail, and color are included inside that copy's
already-authorized owner projection; its original source URL stays private. A reader may see their
own personal URL, but a peer receives only a real project-hosted `u/{owner}/{book}/` object or an
exact allowlisted Google Books display URL. An arbitrary member-controlled hotlink never crosses
the household response boundary. The client renders the canonical corpus cover first, then the
current reader's eligible copy, then the first eligible household copy. This is a display fallback
only: it never becomes canonical merely because a household member viewed it.
An owned row is visible as a copy; a borrowed row is visible only when an active
`household_book_shares` row exists for that exact book, work, and household. A different copy that
admits the same work cannot reveal it. The legacy `household_library_books()` compatibility RPC uses
those same sources and returns its retained `wishlist` field as false.

Migration deployment does not synthesize `household_work_enrichment` from historical personal tags
or tropes. Historical sharing is an owner-approved, target-scoped reconciliation data fix after an
inventory and dry run. Neither automatic owned inclusion nor the borrowed-share checkbox publishes
pre-existing annotations. New edits made after household inclusion synchronize field-by-field: a
personal tag edit replaces household tags only, and a personal trope edit replaces household tropes
only. Each preserves the sibling household field, serializes with unlink, and rechecks the exact
owner membership, personal work link, exact-copy eligibility, and active household work while
holding both the personal-book and household locks. An owned copy is eligible automatically; a
borrowed copy is eligible only through an active share for that exact book, work, and household.
`book_tropes` INSERT/UPDATE authorization also requires the referenced trope to be canonical or
owned by the acting reader. Definer snapshots independently require both a join `owner_id` matching
the personal book owner and a canonical-or-same-owner referenced trope, so either shape of malformed
legacy cross-owner row remains private. The trigger captures the expected corpus binding before
waiting on any personal-book lock; a moved join captures both bindings and prelocks both books in
UUID order before either household lock, then refreshes the source before the destination so a
duplicate-copy destination is the final semantic snapshot. A concurrent server rebind therefore
suppresses the stale household side effect without discarding the personal edit, and opposite
book/household lock order cannot form a moved-join deadlock.
Backup restore stages every restored book as unowned, replays historical personal tropes, and only
then restores owned state in sequential batches of at most 100 UUIDs, so replay does not masquerade
as new household-sharing consent and large libraries do not exceed gateway request-line limits.

Canonical ISBN resolution acquires transaction advisory locks for every normalized ISBN-13 in
deduplicated sorted order before counting candidates or inserting a work. Concurrent first-time adds
therefore reuse one corpus work even when their title keys differ, and multi-ISBN writers cannot form
opposite-order deadlocks. The same boundary rejects future cross-work ISBN collisions from direct
corpus writes. Duplicate ISBN ownership that predates the boundary is not rewritten: personal adds
against that ambiguous data still receive a reconciliation work instead of an arbitrary match.

Corpus cover publication reuses the existing cover ingestion boundary: a newly shared personal
candidate must have the reviewed `url`/optional `source`/optional `sourceUrl` shape, resolve to the
project origin derived from the signed JWT issuer, and correspond to a real `covers` object under
`u/{owner}/{book}/`. That candidate may temporarily seed a missing canonical cover, but it is not
the durable owner of shared artwork. The administrator corpus sweep re-ingests the exact selected
image under `w/{work}/`, and only a real object on that path (or an allowlisted Google Books
display-only URL) is accepted by the corpus completion RPC. Request Host headers are never trusted.
Source preservation is a durable queue rather than one unbounded preflight:
`admin_recover_corpus_cover_batch` handles at most 25 changed personal or eligible household
sources, and `corpus_cover_recovery_marks` stores the objective/cover fingerprint and outcome.
Successful fingerprints are idempotent. A failed fingerprint is deferred for 15 minutes so later
sources continue, while any source change retries immediately. The client interleaves one recovery
batch with each metadata/series group, re-reads that group before classification, and continues
classification when recovery is temporarily unavailable.
Existing curated external options may be retained or selected, but arbitrary new remote URLs cannot
be introduced by `edit_corpus_work_metadata`. Routine edits to an active personal row remain
personal and never publish a corpus cover implicitly. A corpus administrator may explicitly turn on
the review switch for their own hosted or allowlisted Google cover. That authenticated action is
the narrow exception: the RPC binds the gesture to the exact work ID and cover URL displayed in the
browser, rechecks both after locking the personal book, appends an audited corpus option, and fills
the canonical cover only when none exists. A changed binding or cover is refused and must be
reviewed again from fresh state. A valid personal ISBN does not have to be present in the linked
work's `isbns` array before review: the ISBN advisory lock plus the unique binding resolver still
refuse an ISBN claimed by another work and any ambiguous title/full-author fallback, while allowing
an unclaimed edition ISBN under one unique linked work. The switch is unavailable when
accepted-option state cannot be loaded and is otherwise off until the action succeeds. Accepted option URLs stay additive across
authenticated metadata edits while a future reviewer-quorum model is designed; only deliberate
service-role maintenance can remove one. Review never replaces an established default, and an
ordinary reader's personal cover never crosses that corpus boundary. The existing fill-only preservation invoked
before personal removal, merge deletion, or account deletion may still populate objective corpus
gaps so the final source is not lost, but series/position/count are excluded because a personal
label is not relational membership evidence. `COVER_PUBLIC_URL` must remain unset or use that same origin; a
different CDN origin is safely rejected until it has an explicit database-controlled trust
configuration. Membership and work eligibility are rechecked after the row locks in every
household/corpus mutation so a concurrent unlink wins in the safe direction.
Personal removal is a soft archive and cannot remove the household or corpus row. Household removal
cannot remove personal or corpus rows and is refused while any active owned personal copy requires
membership. The legacy `household_library_books()` RPC remains only for staged-deploy compatibility.

An existing corpus work can be added directly to `household_works` without creating a personal
`books` row. An active member may create a missing attributed provisional `works` row, matching the
authority already available through a personal Add; ambiguous ISBN or title/full-author identity is
refused. An allowlisted Google result may be retained as a display-only cover at creation. A
Hardcover result is stored only after the existing ingestion boundary creates a corpus-owned
`w/{work}/` object, and that path is limited to a household owner or corpus administrator for the
exact work. Editing an existing corpus work remains limited to the same roles; the editor may select
an already-reviewed cover option. Routine non-series corpus edits do not rewrite linked personal
rows. A personal owner may explicitly call `adopt_corpus_work_metadata` to copy genre, cover,
publication details, and deliberately replace a personal series choice with the shared series;
title/contributors, ISBN, possession, reading state, rating, and private annotations remain
untouched.

**Series classification is corpus-first and evidence-bearing.** A generic search document's series
label is only a candidate; it cannot write `works.series` or a personal membership. The classifier
must find the exact title/author inside a provider's series relationship and records identity and
membership confidence separately. Multi-book/later-position relational context may fill a blank;
singletons and cross-source conflicts enter `work_series_suggestions`. A source outage stays
`unresolved`, and a matched record with no label stays a dated `no_series` observation rather than
becoming a permanent standalone claim. Fantastic Fiction evidence is limited to membership, series,
order, source URL, and observation time and is never sufficient for automatic promotion.

**Canonical shared series are relational and separate from personal series.** `corpus_series` owns
the reviewed identity, aliases, provider ids, status, declared length, and revision;
`corpus_series_entries` owns shared order and may link a `works` row or retain an unbound known-book
slot. Provider identity wins over text matching. Name plus creator is a fallback only when it
resolves to one active catalog record, so homonymous series are not guessed together. Only reviewed
`found`/`review` work tuples seed the initial graph; unknown legacy strings do not. Signed-in readers
may browse active catalog rows but cannot write them directly. Corpus administrators rename, merge,
archive/restore, and maintain order through revision-checked RPCs; every decision is appended to
`corpus_series_edits`. Archive and slot removal are tombstones, not destructive deletion.

`works.series/position/series_count/status` remains the compatibility projection for household
surfaces and automatic personal defaults. A catalog change goes through that projection rather than
writing personal tables directly. Consequently, an eligible `unknown`/`enrichment`/`corpus` default
may follow a correction, while reader and CSV-import memberships remain unchanged. Personal
`series`/`series_entries` and private Pro universe links remain reader-authored overlays.

When canonical series/position/count changes, household views receive it directly from `works` and
eligible active personal rows receive it as an `origin=corpus` default. Only rows whose current
origin is `unknown`, `enrichment`, or `corpus` and whose reader-choice guard is false are eligible;
reader and CSV-import choices remain private authority. Conflicting old automatic structured entries
are tombstoned before the trusted corpus membership materializes. An authorized shared editor's
direct change becomes high-confidence manual corpus evidence and seeds through the same default
path. A later high-confidence confirmation of the same canonical tuple replays this default path so
an eligible legacy personal scalar cannot remain detached from structured membership. It does not
overwrite personal reader/import choices.

Every Add and import surface names its destination. For a linked member the default is the reader's
personal library plus the household catalog; personal-only and household-only remain explicit
choices. Imports publish their resolved personal book IDs to the household in one checked batch and
never infer publication from wishlist or reading state. A member may separately opt in through
`allow_member_library_adds` to let peers add a corpus work to their personal library. That delegated
RPC requires both accounts in the same household and an active household work, and creates only a
neutral bibliographic personal row: unowned, not borrowed, not wishlisted, unread state unset, with
no rating, favourite, intensity/darkness, plan, progress, tags, tropes, moods, or private notes. The
recipient can revoke permission at any time; the permission setter can update only the caller's own
membership row.

Membership linking/unlinking remains service-role, owner-run, dry-run-first operation through
`link_household` and `unlink_household_member`. Runtime client mutations use narrow authenticated
RPCs with no direct table grants. The one-off household CSV reconciliation additionally requires an
exact complete-roster match. Its write-mode rollback artifact is captured in one `REPEATABLE
READ`/`READ ONLY` database snapshot, including deterministic fingerprints of every reviewed account book
row and household-work membership row; the mutation rechecks that fence under its normal serialization
locks and refuses any intervening reader edit, book insertion, household change, or unreviewed
member rather than applying a stale plan. Every book insert first shares a transaction-scoped,
per-owner advisory fence before taking ISBN/work locks. Reconciliation exclusively locks the two
reviewed owner fences in UUID order before any book row, so an earlier insert becomes visible and
invalidates the snapshot while a later insert waits until the reviewed transaction commits.

### Notes

- **`profiles` rows are created by a trigger, not by the app.** `on_auth_user_created` fires
  `after insert on auth.users` and inserts the profile, `security definer` so it writes
  regardless of the caller's role; `display_name` defaults to the `display_name` user-metadata
  key, falling back to the local part of the email
  (`supabase/migrations/20260624010100_profiles_trigger.sql`). Two consequences worth knowing:
  no client code should ever insert a profile — signing up is enough, and an explicit insert
  hits a `profiles_pkey` duplicate-key error; and the whole `auth.users → profiles → …` cascade
  chain exists from the first moment a user exists, which is what makes account deletion
  complete (see below).
- **Account deletion is one `delete from auth.users`, and everything else cascades.** The
  `delete-account` edge function deletes the caller's auth record; every user-owned table
  reaches `auth.users` through `ON DELETE CASCADE`, directly or via `profiles`. Verified
  against a live database, not just read off the migrations. Canonical (`owner_id is null`)
  `tropes`/`moods` rows correctly survive — they are shared vocabulary, not the reader's.
  `apps/web/src/data/ownedTables.test.ts` parses these migrations and fails if any owner-scoped
  table lacks a cascade path, so the property cannot quietly lapse.
  Household membership follows the same cascade. The collective `households` row has no creator
  FK; deleting the account that first linked it therefore does not destroy the remaining members'
  relationship.
- **`series_entries.removed_at` is a tombstone, not a delete.** Removing a book from a series
  soft-deletes the entry (`removed_at = now()`, `book_id = null`, `is_primary = false`,
  `user_edited = true`) rather
  than dropping the row, so a later Hardcover refresh cannot resurrect a slot the reader
  deliberately removed. Every live-entry query filters `removed_at is null` (partial index
  `series_entries_live_idx`).
- **Removal respects primary vs. secondary membership.** Removing a secondary tombstones only that
  membership. Removing or clearing the primary also clears the scalar compatibility tuple and does
  not silently promote an arbitrary remaining secondary; selecting another primary is an explicit
  reader action.
  See `docs/decisions/0004-series-removal-semantics.md`.
- **The application removes a series by archiving it, not by deleting it.**
  `archive_personal_series` preserves every child row and suspends its primary projections;
  `restore_personal_series` restores saved primary intent only where no newer primary exists.
  Ordinary RLS-backed series reads exclude archived parents and their entries.
  `list_archived_personal_series` is the explicit owner-scoped recovery read. The separate merge
  path may still retire its loser only after re-parenting every live, ghost, and tombstone entry.
- `series_count IS NULL` drives the **"None set"** filter ("what needs completing").
- `pub_y/m/d` keep flexible publish-date precision; `pub_m`/`pub_d` are range-checked in the
  DB and parsed through `parseNumericField` in the client, so a bad value is refused in the
  form rather than rejected by Postgres.
- The reread log stays a child table, so "books read with vs. without rereads" is a
  `COUNT(DISTINCT book_id)` vs `COUNT(*)` over `reads` in a date range.
- Genres/tags stayed `text[]` with GIN indexes (the "simpler" option). **Tropes and moods did
  not** — they became join tables when they gained structure (emphasis, facets, canonical vs.
  personal entries).
- `club_comments` spoiler gating is still honor-based (client-side, `spoiler.ts`). Server
  enforcement via RLS is a later upgrade (`AGENTS.md`, open decision 3).

### Logic ported from the prototype

- **Merge engine** — `packages/core/src/merge.ts` decides the winning fields; the
  `merge_books(p_primary, p_loser, p_fields)` RPC applies them server-side, carrying reads
  (dedup by date), list memberships, contributors, tropes, moods and ownership onto the
  primary before deleting the loser.
- **CSV import** — `csv.ts` / `importMap.ts` map Goodreads/StoryGraph headers, merging by
  title+author and bringing ratings, shelves and real read dates.
- **Spoiler gate** — `spoiler.ts`, `comment.unit <= myProgress`.
