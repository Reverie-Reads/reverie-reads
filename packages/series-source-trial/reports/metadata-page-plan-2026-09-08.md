# Page-observation comparison: preregistration

Registered before any tested-provider request on this frame. Development only; this is neither
series qualification nor an automatic metadata-correction release.

## Question and selection

When the unchanged page-review path admits both a baseline page observation and ISBNdb, which
observation agrees with the independently reviewed exact-edition publisher reference? Does a
page conflict coexist with an otherwise useful format fill? Unlike the completed gap-only runs,
this separate command can compare pages even when no metadata gap exists.

Ten English editions cover five underlying works, four authors, and three publishing groups
(Simon & Schuster, Macmillan, Penguin Random House): nonfiction/nature, literary fiction,
time-travel fiction, and fantasy backlist. This is a nonrandom convenience challenge, not ten
independent works or a representative catalog sample. Two editions have format references left
unknown; two are known-audio controls. All non-audio current objects are empty. Audio current
objects contain only the publisher-confirmed audiobook format; page references are null.

Selection used publisher product pages, not tested-provider availability or disagreement. An
early publisher-search attempt surfaced unsolicited Google Books results for The Book of Doors;
that work is not admitted to this fresh frame, and those values are not retained in the input or
used to choose the selected editions. Publisher search for The Tainted Cup instead surfaced two
older titles by the same author; those exact-title publisher pages supplied the selected fantasy
backlist. No selected case has been screened through Google, Open Library, or ISBNdb responses.

Expected titles preserve the publisher's displayed subtitles: The Ministry of Time and Intermezzo
include `A Novel`; The Serviceberry print/ebook include `Abundance and Reciprocity in the Natural
World`. Its audio publisher heading omits the subtitle, and the audio input follows that heading.
Only credited authors enter authorship: John Burgoyne is explicitly the illustrator, while George
Weightman and Katie Leung are narrators. An undifferentiated provider contributor list still fails
the existing strict author guard; contributors are not dropped after acquisition to force a match.

## Independent exact-edition references

Only bibliographic facts were transcribed. No descriptions, excerpts, praise, images, or provider
snapshots are retained. The observations are scored against publisher catalog facts, not a physical
inspection of each book or a guarantee that pagination means the same thing across every format.
Publisher and downstream catalogs may share an upstream feed; agreement is not independence.

| Work | Exact publisher reference | Pages | Format reference |
| --- | --- | ---: | --- |
| The Serviceberry — Robin Wall Kimmerer | [9781668072240](https://www.simonandschuster.com/books/The-Serviceberry/Robin-Wall-Kimmerer/9781668072240) | 128 | Hardcover (publisher labels Paper Over Board) |
| The Serviceberry — Robin Wall Kimmerer | [9781668072257](https://www.simonandschuster.com/books/The-Serviceberry/Robin-Wall-Kimmerer/9781668072257) | 128 | Ebook |
| The Serviceberry — Robin Wall Kimmerer | [9781668116692](https://www.simonandschuster.com/books/The-Serviceberry/Robin-Wall-Kimmerer/9781668116692) | Unscored | Audiobook |
| The Ministry of Time — Kaliane Bradley | [9781668045145](https://www.simonandschuster.com/books/The-Ministry-of-Time/Kaliane-Bradley/9781668045145) | 352 | Hardcover |
| The Ministry of Time — Kaliane Bradley | [9781668045152](https://www.simonandschuster.com/books/The-Ministry-of-Time/Kaliane-Bradley/9781668045152) | 368 | Paperback |
| The Ministry of Time — Kaliane Bradley | [9781797176888](https://www.simonandschuster.com/books/The-Ministry-of-Time/Kaliane-Bradley/9781797176888) | Unscored | Audiobook |
| Intermezzo — Sally Rooney | [9780374602635](https://us.macmillan.com/books/9780374602635/intermezzo/) | 464 | Unscored |
| Intermezzo — Sally Rooney | [9781250397560](https://us.macmillan.com/books/9781250397560/intermezzo/) | 464 | Unscored |
| City of Blades — Robert Jackson Bennett | [9780553419719](https://www.penguinrandomhouse.com/books/246707/city-of-blades-by-robert-jackson-bennett/) | 496 | Paperback |
| City of Miracles — Robert Jackson Bennett | [9780553419733](https://www.penguinrandomhouse.com/books/246708/city-of-miracles-by-robert-jackson-bennett/) | 464 | Paperback |

The inspected Macmillan product text exposes page counts and exact ISBNs, but its format selector
does not expose the selected binding. Neither price nor presumed ISBN convention fills that gap.
There are eight scored page references and eight scored format references. Null is unscored.

## Isolation and lock

The ignored input is `private-inputs/metadata-page-10-2026-09-08.json`, purpose
`development-page-review`. Canonical JSON SHA-256:

```text
eedbac4ec921e6a9cf3bbbfb51eeedcd43269f58a0faa78030abcaff7566c2af
```

An in-memory audit found zero ISBN overlaps with the completed 20-edition and 10-edition gap
inputs. Robin Wall Kimmerer appeared in the older study through a different work; this is not an
author-independent holdout. The older 12-edition private input was not located, so no refreshed
exhaustive overlap claim is made for it. A separate identity-only check found zero author overlaps
with the 1,180-case private qualification candidate pool. No private qualification truth was used,
displayed, or copied, and no qualification run is consumed.

All runtime files remain identical to merged #492 at `568d62741e4e596d5118ae7cbc30ac48f63d9e0f`.
The commit first adding this preregistration is the exact run lock. An ignored single-use wrapper
must check that commit, the clean tracked tree, frame hash, and existing credential presence,
then exclusively create a start marker before network calls. It may write one aggregate result
exclusively. A started/completed run is never repeated; its frame and runtime are not edited to
rescue yield or improve agreement.

## Request bounds and interpretation

- Maximum 10 Google HTTP requests, 40 Open Library HTTP requests (including author/redirect hops),
  and 8 ISBNdb HTTP requests; existing subscription/keys only, no purchase or upgrade.
- Use the unchanged `metadata:review` routing. Both baseline attempts must complete; exact-work
  identity, binding, language, and audiobook checks stay intact. There must be an admitted baseline
  page observation. No minimum lookup count, masked gap, alternate endpoint, retry, or bypass.
- Existing 1.1-second pacing, 15-second deadlines, payload caps, and authentication/quota/repeated
  infrastructure stop rules remain unchanged. Reference truth never enters acquisition or routing.
- Persist the version-1 aggregate page-review report only: field states, protected current counts,
  admitted observation/proposal agreement, paired pages (both agree, baseline only agrees, ISBNdb
  only agrees, neither agrees, unscored), finite review reasons, transport counts, and wall time.
- Per-source denominators are conditional on admission; never compare their headline agreement as
  if they covered the same cases. Paired counts compare only the same admitted editions, not every
  selected book. Proposed missing fields and competing existing-field observations remain distinct.
- Any disagreement is a result, not permission to overwrite. Even perfect agreement on this small
  sample cannot qualify automatic correction or the full source/LLM system. Zero paired observations
  is a valid finding. Do not infer case-level causes from aggregates or re-query to recover them.

No LLM, Exa, PRH API, Supabase, shared-corpus, personal-row, public-gold, or private-repo writes.
Request counts are the cost proxy; this experiment does not query billing or invent subscription
per-request prices or credit balances. It does not authorize storing or sharing provider values
with an LLM. Rights/privacy, broader qualification, and production review/write integration remain
separate gates. This branch changes documentation/aggregate results only; no runtime changes or
local-stack use are needed, and the local full-e2e docs-only exemption applies.
