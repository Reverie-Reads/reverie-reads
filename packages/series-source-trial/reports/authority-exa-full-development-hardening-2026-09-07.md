# Exa fallback full-development hardening result

Date: 2026-09-07 America/Los_Angeles

## Decision

Retain GPT-5.6 Luna at low reasoning as the default authority scout and Exa as an opt-in fallback
only after an unresolved or policy-quarantined first pass. The complete reviewed-development run
demonstrates useful marginal recall at bounded cost, but it does not qualify production use.

## Complete development run

The live run covered all 209 authority-reviewed development works: 147 series-positive works and
62 standalone controls at the time of the request. The model received only title, author, and
optional publication year. Exa ran only after an unsafe first pass, and its URLs existed only in
memory long enough to restrict a separate Luna hosted-search call.

| Valid | Policy-safe | Resolved | Resolved accuracy | Series precision | Series recall | False series | False standalone |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 99.5% | 96.2% | 82.8% | 96.5% | 95.6% | 88.4% | 2/62 | 0/147 |

The raw score was deliberately not accepted. Six apparently wrong membership labels were reviewed
against their cited pages before changing either policy or truth.

## Source review and cleaning

- Micaiah Johnson's current author page is explicitly titled [The Ashtown
  Series](https://www.micaiahjohnson.com/ashtown) and presents *The Space Between Worlds* with
  *Those Beyond the Wall*. The old standalone gold label came from an older publisher selection
  page and was corrected to a positionless Ashtown membership.
- Sequoia Publishing calls *Time Tub Travellers and the Silk Thief* book one of the singular [Time
  Tub Traveller series](https://sequoiapublishing.co.uk/products/time-tub-travellers-and-the-silk-thief-by-claire-linney).
  The reviewed author source retains *Time Tub Travellers* as canonical, while the publisher form
  is now an explicit alias.
- Hachette's *Ymir* page assigns the work to The Violet Wars, but the existing reviewed author
  statement identifies *Ymir* and *Annex* as unrelated standalones. That catalog relationship is
  now a named deterministic conflict and cannot establish membership.
- A Czech publisher's translated label for *The Ever Queen* was a real localized grouping but not
  a verified mapping to the English *Ever Seas* identity. Unmapped translated taxonomies now wait
  for review.
- A Willow Winters storefront page for the installment *Merciless* used the shape `Merciless: All
  He'll Ever Be #1`. The scout inverted the installment and collection names because the actual
  target was the *All He'll Ever Be* collection. That title/relationship shape now waits for exact
  identity review.
- Book Cave is a hosted discovery profile, not an author-controlled origin. It was also
  mis-paraphrased as “Martinez Mysteries” when the page actually said “The Ava Martinez Series.”
  Hosted Book Cave profiles are now identity-only.

The new rules demote only the risky source's classification support. An independently supported
claim survives.

## Audited deterministic replay

The same retained proposals were replayed locally after the source review. No model, hosted-search,
Exa, retrieval, Supabase, or corpus call was made during the replay.

| Arm | Resolved | Resolved accuracy | Effective accuracy | Series precision | Series recall | False series / standalone |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Cleaned Luna-only baseline | 158/209 | 100% | 75.6% | 100% | 86.5% | 0 / 0 |
| Cleaned Luna + Exa fallback | 169/209 | 100% | 80.9% | 100% | 89.2% | 0 / 0 |

Exa added eleven correct resolutions, including four additional positive-series works, without a
remaining false claim. It attempted 48 of 209 cases, issued 144 Search requests, inspected 1,131
result URLs in memory, and selected twelve second passes before the final deterministic cleaning;
eleven remained safe resolutions.

## Cost

The live 209-work run used 239 model calls, 542 hosted web searches, 3,413,039 input tokens, and
115,900 output tokens. At the 2026-09-07 rates used by the existing trial reports—$0.20 per million
Luna input tokens, $1.20 per million output tokens, and $10 per 1,000 hosted searches—the OpenAI
portion is approximately $6.2417.

The 144 Exa requests cost $1.0080 at $7 per 1,000 Search requests, making the integrated run about
$7.2497. Including the earlier $1.2460 Exa experiment, observed Exa usage is $2.2540. From an
original $20 credit, approximately $17.746 remains if the account had no unrelated activity.

## Remaining gate

The 209-case development set now clears the configured point-estimate precision and dangerous-error
requirements, but it cannot establish the required confidence bounds. The locked qualification
partition still needs 1,000 untouched, authority-reviewed works: 400 series-positive and 600 true
standalone controls, with at least 299 emitted membership claims. Rights, privacy, retention, and
production integration also remain separate gates.

No action in this run wrote authority gold automatically, Supabase, the resolver, or the Reverie
corpus. The two gold edits above were explicit human source-review corrections.
