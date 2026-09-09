# Acquired-baseline metadata benchmark: preregistration

Status at registration: implementation/offline tests prepared; no live requests on this frame.
Development only. This does not qualify the series resolver, train an LLM, or authorize production.

## Question and frozen selection

Can verified Google/Open Library edition acquisition support a cheap, selective ISBNdb supplement
without turning incomplete baselines or identity conflicts into paid opportunities?

The input is a convenience challenge sample chosen before calling the three APIs: 20 new ISBNs,
17 distinct normalized title/author keys (16 underlying works, treating the separately labelled
Kindred young-adult edition as the same underlying novel). Formats: 10 paperback, 5 hardcover,
2 ebook, 2 audiobook, and 1 reference binding left unknown. It includes memoir, nature writing,
graphic memoir, science fiction, fantasy, romance, horror, and young-reader/young-adult editions.
All are English editions; this is not a multilingual, random, long-tail, or representative catalog
sample. Every `current` object is empty to measure missing-field opportunities, not correction of
reader choices.

The 20 ISBNs have no overlap with the earlier 12-edition API comparison. A read-only, in-memory
audit against the existing 1,180-case private qualification candidate pool found zero exact-work
or author overlaps. No private qualification identities or truth were displayed or copied. No
qualification run is being requested or consumed.

The ignored local input is `private-inputs/metadata-development-20-2026-09-08.json`. Its canonical
JSON SHA-256 (the runner's frameSha256) is:

```text
68f1ed4c3ac7ce5f826d406a72f45728913b3d8aca168754043aeec02b595be8
```

The first implementation commit containing this registration fixes all runtime files. The live
run must record that exact commit and verify the frame hash before starting. No edits to identity,
reference, or runtime are allowed after collecting responses. The completed result is not rerun.

## Reference review before acquisition

Exact-ISBN publisher product pages/catalogs supplied factual identity, page, and format references,
not API output, reviews, ratings, or descriptive prose. References are independent of the tested
responses, not a claim that publisher feeds and downstream catalogs are statistically independent.
17 page references and 19 format references are scored. Null means unscored, never correct.

- Hachette: [The Fifth Season paperback](https://www.hachettebookgroup.com/titles/n-k-jemisin/the-fifth-season/9780316229296/), [ebook](https://www.hachettebookgroup.com/titles/n-k-jemisin/the-fifth-season/9780316229302/?lens=orbit), and [Circe paperback](https://www.hachettebookgroup.com/titles/madeline-miller/circe/9780316556323/).
- Bloomsbury: [Piranesi paperback](https://www.bloomsbury.com/us/piranesi-9781635577808/) and [hardback](https://www.bloomsbury.com/us/piranesi-9781635575637/). The paperback facts also agree with the [2021 publisher catalog](https://www.bloomsbury.com/media/c2ihalwo/bloomsburyadult_fall-2021sm.pdf); a subsequent page-open failure did not replace the already reviewed reference.
- Milkweed: [Braiding Sweetgrass](https://milkweed.org/book/braiding-sweetgrass), with the paperback ISBN/format independently explicit in its [reader guide](https://milkweed.org/sites/default/files/books/readers_guide/Braiding_Sweetgrass_Readers_Guide.pdf).
- Macmillan: [All Systems Red](https://us.macmillan.com/books/9780765397539/allsystemsred/) and [Legends & Lattes audio](https://us.macmillan.com/books/9781250889652/legendslattes/). All Systems Red's page count is explicit, but the inspected product text does not certify binding: format stays unscored. Audio pages are not scored.
- Beacon: [Kindred paperback](https://www.beacon.org/Kindred-P489.aspx) and [young-adult edition](https://www.beacon.org/Kindred-P2085.aspx), whose page count comes from the [Summer 2024 catalog](https://beacon.org/Assets/PDFs/BeaconPressSummer2024Catalog.pdf). The YA qualifier remains in the expected title; it is not stripped to improve matching.
- PRH: [Born a Crime paperback](https://www.penguinrandomhouse.com/books/537515/born-a-crime-by-trevor-noah/), [audio](https://penguinrandomhouselibrary.com/book/?isbn=9798217350100), [It's Trevor Noah](https://www.penguinrandomhouse.com/books/575367/its-trevor-noah-born-a-crime-by-trevor-noah/), [The Very Secret Society of Irregular Witches](https://www.penguinrandomhouse.com/books/696866/the-very-secret-society-of-irregular-witches-by-sangu-mandanna/9780593439357/), [The Seven Year Slip](https://www.penguinrandomhouse.com/books/673063/the-seven-year-slip-by-ashley-poston/), [The Left Hand of Darkness](https://www.penguinrandomhouse.com/books/538943/the-left-hand-of-darkness-by-ursula-k-le-guin/9780143111597/), [The Complete Persepolis](https://www.penguinrandomhouse.com/books/160892/the-complete-persepolis-by-marjane-satrapi/), [Mostly Harmless ebook](https://www.penguinrandomhouse.com/books/661/mostly-harmless-by-douglas-adams/ebook/), [Mexican Gothic hardcover](https://www.penguinrandomhouse.com/books/577068/mexican-gothic-by-silvia-moreno-garcia/9780525620785/), and [Neuromancer](https://www.penguinrandomhouse.com/books/538861/neuromancer-by-william-gibson/).

Born a Crime paperback pages remain unscored: its current product page says 336, while an
[older PRH catalog](https://penguinrandomhousehighereducation.com/wp-content/uploads/2019/11/LL-AA-082319a.pdf)
says 304 for the same ISBN. Do not call an API value wrong merely by choosing one side. The audio
reference also has null pages. Main credited authors are expected; extra undifferentiated
contributors from a provider cause review rather than being silently dropped.

## Budget, scoring, and stop rules

- Maximum 20 Google HTTP requests, 80 Open Library HTTP requests including author/redirect hops,
  and 20 selective ISBNdb HTTP requests. Existing credentials/subscription only; no purchase,
  plan upgrade, PRH API request, Exa request, or model call.
- Serial 1.1-second provider pacing; 15-second request deadline. Baseline payload cap 512 KiB;
  ISBNdb cap 256 KiB. No retries. Authentication/quota failure or two consecutive infrastructure
  failures stops that provider. Incomplete baseline cases do not call ISBNdb.
- Score available baseline fields and newly proposed missing fields against the frozen references;
  report available/agrees/differs/unscored separately. Preserve all ambiguity/unavailability and
  conflict counts. Exact ISBN/title/author checks remain unchanged from implementation, and source
  rank or ebook preview availability cannot certify binding.
- Measure request counts as the operational cost proxy and baseline HTTP elapsed time excluding
  pacing. Record total wall time separately. No invented per-request subscription price or account
  balance; zero model/Exa calls means no added model/Exa credit use from this benchmark.
- These are review candidates, not approved patches. Small conditional samples cannot establish
  production precision. Any disagreement or lack of proposals is a result, not a reason to adjust
  this frame and rerun. Next experiments require a new explicit plan.

Provider payloads, values, URLs, identities, case-level outcomes, and API errors are memory-only.
The published result contains aggregate metrics, the input hash, runtime commit, request budget,
and verification evidence. The ignored input contains independent publisher facts, not provider
snapshots. Nothing writes Supabase, personal metadata, the shared corpus, or public gold. Account
terms, persistence/redistribution rights, broader accuracy, and user-review integration remain gates.
