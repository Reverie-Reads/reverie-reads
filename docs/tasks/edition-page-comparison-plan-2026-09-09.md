# Fresh exact-edition page comparison

Preregistered development pilot, 2026-09-09. Runtime: merged PR #508,
`901afebc02d5f45bf4edd61624b62afaf3263126`. No production rollout is authorized by this pilot.

## Question and frozen sample

Can Google volume-detail and exact-edition Open Library produce useful, publisher-consistent
page-count review candidates under the existing conservative identity gates?

The ignored frame contains 16 editions of 13 works: 14 numeric page references and two audiobook
references with pages not applicable. Formats: two hardcover, five paperback, four ebook, two
audiobook, three unknown. All current values are empty: this tests filling gaps, not correcting
reader values. It includes four translated works, four independent/small-press works, three
nonfiction works, two pre-2021 works, and two multi-edition clusters. These categories overlap.
All selected editions are English-language. Small press does not mean self-published.

This is a purposive challenge sample selected from accessible publisher references, not a random
population or qualification holdout. Full publisher-displayed titles and explicit subtitles are
retained. Translators and narrators are not silently added as authors. Unknown binding stays
unknown. Different editions retain different publisher page counts; ebook extent is not inferred
from the print edition. Reference facts enter scoring only, never provider requests or selection.

The frame and exclusion-file hashes are frozen in the adjacent lock. Read-only checks exclude
matching ISBNs, normalized overlapping titles, and exact full authors against nine located frames,
including the consumed 100-work study and 1,180-case qualification pool. Public subset identities
are resolved by ID without reading their truth into this experiment. Also exclude the four works
from the prior six-edition Google diagnostic. Counts in overlapping exclusion frames are not a
unique population count. An older 12-edition input was not located: this is not an exhaustive audit
of all historical experiments. One overlap was replaced before freezing or provider acquisition.

## Reference review

Publisher ISBN, title, author, page extent and explicit binding were checked before acquisition.
The following primary-source register describes reference collection, not API result evidence:

- [Two Lines Press catalog, page 7](https://www.twolinespress.com/wp-content/uploads/2025/07/24-02-FALL-catalog-FINAL.pdf): Woodworm; visually verified exact ISBN, hardcover and 144 pages.
- [New Directions](https://www.ndbooks.com/book/the-employees/): The Employees.
- [Dorothy](https://dorothyproject.com/book/the-taiga-syndrome/): The Taiga Syndrome.
- [And Other Stories catalog, page 18](https://www.andotherstories.org/wp-content/uploads/2024/11/AOS_Catalogue_2025.pdf): Fire Exit; visually verified exact print ISBN, paperback and 304 pages. The product-page format extraction was ambiguous, so the explicit catalog block is the reference.
- [Macmillan print](https://us.macmillan.com/books/9781250855527/thetusksofextinction/) and [ebook](https://us.macmillan.com/books/9781250855534/thetusksofextinction/): The Tusks of Extinction.
- [Macmillan](https://us.macmillan.com/books/9781250322500/thenightguest/): The Night Guest.
- [Macmillan](https://us.macmillan.com/books/9781250325372/ahistoryoftheworldintwelveshipwrecks/): A History of the World in Twelve Shipwrecks.
- [Algonquin hardcover](https://www.hachettebookgroup.com/titles/gabriel-bump/the-new-naturals/9781616208806/), [paperback](https://www.hachettebookgroup.com/titles/gabriel-bump/the-new-naturals/9781643755335/) and [ebook](https://www.hachettebookgroup.com/titles/gabriel-bump/the-new-naturals/9781643755342/): The New Naturals: A Novel.
- [Simon & Schuster](https://www.simonandschuster.com/books/The-Safekeep/Yael-van-der-Wouden/9781668034354): The Safekeep.
- [Macmillan audio](https://us.macmillan.com/books/9781250351265/thespellshop/): The Spellshop.
- [Macmillan audio](https://us.macmillan.com/books/9781250902757/thelostlibrary/): The Lost Library: A Kid-Friendly Mystery.
- [Basic Books](https://www.hachettebookgroup.com/titles/c-l-skach/how-to-be-a-citizen/9781541605541/?lens=basic-books): How to Be a Citizen: Learning to Be Civil Without the State.
- [Simon & Schuster](https://www.simonandschuster.com/books/Why-Fish-Dont-Exist/Lulu-Miller/9781501160370): Why Fish Don't Exist: A Story of Loss, Love, and the Hidden Order of Life.

Some HTML evidence is web-indexed publisher content, not a fresh direct fetch; three direct
Macmillan requests returned 403 and were not bypassed. The two PDFs were downloaded and rendered
for visual review. Publisher metadata is a reference, not physical-copy certification. Independence
between publisher feeds and Google/Open Library is not established.

## Execution and retention

Run once after committing this plan and lock. The private wrapper checks frame/exclusion/runtime
hashes, credentials without printing them, and a clean tracked checkout. It creates an exclusive
start marker under the Git common directory's new `edition-page-trials` namespace before live
acquisition. It does not touch the consumed ISBNdb study's markers. Preserve the new marker and any
partial output on failure; no retries, reset, resume, reselection, or response-driven frame changes.

Use the unchanged `metadata:pages` live command, maximum 32 Google HTTP requests and 80 Open Library
HTTP requests (including author lookups/redirects). Each provider is paced at least 1,100 ms between
request starts; 15-second request timeout, 512 KiB response cap. Authentication/quota errors or two
consecutive infrastructure failures stop that provider. Google detail is queried only after one
unambiguous exact-identity search match. No fallback to search page counts or printed-page fields.

Only the identity object enters acquisition. Raw responses and case-level provider evidence remain
memory-only; persist aggregate counters, timestamps, hashes and transport statistics. No ISBNdb,
PRH API, Exa, application LLM, Supabase, billing or production actions. Existing Google credentials
and authorized referrer configuration are used locally and are never committed.

## Registered interpretation

Report every status, failure, conflict, unavailable case, request count and elapsed time. Count
candidate agreements, differences and unscored candidates separately. The 14 numeric references
form the page-gap denominator; audio references are not zero-page truth. No page candidate without
a numeric reference is counted correct. Conditional agreement is not population precision.

Provider observation tallies are observations admitted by the joint packet, not raw independent
provider coverage: ambiguity or unavailability can suppress both providers' observations. This
run does not score paired Google search counts, so it cannot estimate search-to-detail lift. Nor
can shared-provider agreement demonstrate independent lineage. All candidates remain review-only.

If any candidate differs from its reference, do not enable automatic filling. If safe candidate
yield is low, investigate the gates or source availability with synthetic tests before authorizing
a new independent sample. Even perfect observed agreement here only supports further testing,
not production qualification. No runtime changes are included in this docs-only follow-up; the
fresh browser suite completed for #508 is not rerun for documentation alone.
