# Fresh edition-page diagnostic sample

Preregistered development pilot, 2026-09-09. Runtime: merged PR #511,
`ad9665487a1902232bc9f11149f98bf99f97fcb8`. This follow-up changes no runtime or production behavior.

## Question and sample

Which fixed-enum identity reasons and terminal stages appear in a fresh Google volume-detail / Open
Library exact-edition run, and how many review-only page candidates agree with publisher references?

Freeze ten English-language editions of eight works, all with numeric page references and empty
current values. Two works have paired editions; two are translated works; two are nonfiction.
Five edition identities include an explicit publisher subtitle. Reference formats are two hardcover,
six paperback, one ebook and one unknown. Editions span 1998 through 2026. This is a purposive
diagnostic sample selected from accessible publisher pages, not a random population, qualification
holdout, audio-safety test, or measurement of corrections to existing reader data.

Use publisher-displayed titles and explicit subtitles, exact ISBNs and full primary authors.
Translator/narrator credits do not silently become authors. An unknown binding stays unknown;
publisher reference binding never enters acquisition. Paired ebook/print extents stay distinct.
Reference truth enters scoring only. Do not change identities after provider results arrive.

The private preflight checks ISBNs, normalized overlapping titles and exact full-author overlap
against ten located historical frames, including the consumed 100-work study, the 1,180-case
qualification pool and the completed sixteen-edition pilot. Zero overlaps are required. ID-only
public subsets resolve through the public source frames; no qualification truth enters the new
sample. Four earlier diagnostic works are also excluded. Frame counts overlap and must not be
summed as a unique population. The historical twelve-edition input remains unlocated, so this is
not an exhaustive exclusion audit. No selected cases required replacement after the overlap check.

## Publisher references reviewed before acquisition

- The Anthropologists: [hardback](https://www.bloomsbury.com/us/anthropologists-9781639733064/) and [paperback](https://www.bloomsbury.com/us/anthropologists-9781639736683/), each 192 pages.
- Ripe: A Novel: [paperback](https://www.simonandschuster.com/books/Ripe/Sarah-Rose-Etter/9781668011645), 304 pages; [ebook](https://www.simonandschuster.com/books/Ripe/Sarah-Rose-Etter/9781668011652), 288 pages.
- Biography of X: A Novel: [Macmillan](https://us.macmillan.com/books/9780374606176/biographyofx/), 416 pages; binding unknown because the retrieved format selector was not explicit.
- The Rediscovery of America: Native Peoples and the Unmaking of U.S. History: [Yale paperback](https://yalebooks.yale.edu/book/9780300276671/the-rediscovery-of-america/), 616 pages.
- Temple of the Scapegoat: [New Directions paperback](https://www.ndbooks.com/book/temple-of-the-scapegoat/), 288 pages; no subtitle displayed in the publisher heading.
- Nightmare of the Embryos: [New Directions paperback](https://www.ndbooks.com/book/nightmare-of-the-embryos/), 128 pages.
- The Girls of Slender Means: [New Directions paperback](https://www.ndbooks.com/book/the-girls-of-slender-means/), 144 pages.
- A Danger to the Minds of Young Girls: Margaret C. Anderson, Book Bans, and the Fight to Modernize Literature: [Simon & Schuster hardcover](https://www.simonandschuster.com/books/A-Danger-to-the-Minds-of-Young-Girls/Adam-Morgan/9781668053645), 288 pages. The forthcoming paperback was not selected.

These are web-indexed publisher references, not physical-copy certification or proof of independent
lineage from provider feeds. Broad reference discovery incidentally surfaced third-party snippets;
none supplied truth or provider matching decisions. Pink Slime was not selected after an incidental
Google Books preview appeared. No Google Books API or Open Library acquisition preceded the lock.

## Execution, freeze and retention

Commit this plan and its dataset/system lock before the one-time run. The private wrapper validates
the canonical frame hash, exclusion hashes, Node version and file manifest; verifies credentials
without printing them; and requires a clean tracked checkout with unchanged runtime. Create an
exclusive hash-keyed start marker in the Git common directory's `edition-page-trials` namespace
before acquisition. Preserve it and any partial output on failure. No retries, reset, resume,
replay, replacement cases, or response-driven reference changes. Old frames and markers are untouched.

Use the unchanged live edition-page command with maximum 20 Google and 60 Open Library HTTP
requests, including author lookups and redirects. Existing limits remain: 1,100 ms between request
starts per provider, 15-second timeout, 512 KiB response cap; authentication/quota failure or two
consecutive infrastructure failures stop that provider. Google detail requires one exact-identity
search match; neither search page counts nor printed-page fields are fallbacks.

Only identity enters acquisition. Raw responses and case-level provider evidence stay memory-only.
Persist aggregate report-v2 counters, hashes, timestamps and transport statistics. Diagnostics are
fixed-enum marginal histograms collected before reference scoring. No ISBNdb, PRH API, Exa,
application LLM, Supabase, local database, billing, deployment or production actions.

## Registered interpretation

Report all outcomes, diagnostic reasons/stages/formats, request counts and elapsed time. The ten
numeric references are the page-gap denominator; candidate agreements and differences are separate.
Marginals cannot connect a particular reason, provider or format to a particular scoring failure,
or identify the rejected work. Terminal stage identifies the returning branch, not necessarily a
completed HTTP request. Joint-packet observation counts are not independent raw provider coverage:
ambiguity or unavailability in either provider can suppress both observations.

Do not infer improvement over the prior sixteen-edition sample: the samples differ and there is no
paired search-versus-detail control. Any reference disagreement keeps automatic filling off; even
perfect agreement here supports further testing only. Prefer synthetic follow-up for observed gate
limitations, without weakening exact-edition identity. No runtime fix or rerun belongs in this
docs-only follow-up. Fresh full browser E2E is exempt for documentation-only changes; verify report
arithmetic, retention, formatting and repository non-browser gates instead.
