# Authority discovery recall holdout

Date: 2026-09-07 America/Los_Angeles

## Decision

Keep the v11 adaptive locator unchanged and retain it as a no-write shadow scout. In a frozen
22-work holdout that had never been sent through any acquisition-prompt version, hosted search
consulted a known direct author or publisher origin for 18 works (81.8%) and the exact reviewed
authority page for 16 (72.7%). Every policy-eligible resolved classification was correct, with no
false series or false standalone decision, but discovery recall remains too low for production
qualification.

The run exposed one separate source-ownership defect: the model called Crime Writers’ Association
member pages author sources for _Sealfinger_. The relationship happened to match gold, but the
association owns those pages. `thecwa.co.uk` is now deterministically discovery-only. A cached
policy replay demoted the unsupported membership without another model call or search. This is a
cleaning-layer correction; the prompt was not tuned on the holdout.

## Frozen design

The selection was committed before the live run in `data/authority-discovery-holdout.json` and
bound to the current authority-gold file hash and v11 prompt version. It excludes all 144 reviewed
cases found in any prior local acquisition cache at freeze time. The remaining eligible cases were
ordered by a declared SHA-256 seed, with distinct authors preserved across four cells:

| Cell | Cases |
| --- | ---: |
| True standalone, publisher source | 5 |
| True series, author source | 6 |
| True series, publisher source | 5 |
| True standalone, author source | 6 |

The acquisition command received only title, author, and optional publication year. It did not
receive a gold classification, known authority URL or hostname, source channel, prior result,
provider packet, or selection-frame truth source. The scorer loaded those fields only after the
run. It requires the exact frozen target and result order, so an incomplete or substituted run
cannot produce a valid benchmark report.

## Fresh discovery result

| Cases | Any known origin | Targeted channel origin | Exact known page | Known origin cited | Policy-safe resolved |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 22 | 18 (81.8%) | 18 (81.8%) | 16 (72.7%) | 17 (77.3%) | 16 (72.7%) |

| Cell | Any known origin | Exact known page | Policy-safe resolved |
| --- | ---: | ---: | ---: |
| True standalone, publisher source | 5/5 | 5/5 | 4/5 |
| True series, author source | 5/6 | 5/6 | 6/6 before source-ownership correction |
| True series, publisher source | 4/5 | 3/5 | 3/5 |
| True standalone, author source | 4/6 | 3/6 | 3/6 |

The ordinary acquisition score before inspecting outcomes was 100% resolved accuracy, 100% series
precision, 81.8% series recall, 0% false standalone, and 0% false series. One of those accepted
series results was the correctly named but wrongly attributed _Sealfinger_ membership described
below, so it must not be represented as authority-safe evidence.

Discovery and classification are intentionally separate. _Sealfinger_ resolved without a known
origin, while _Barbacoa, Bomba, and Betrayal_ and _The Doors of Eden_ found known origins but did not
reach enough direct classification evidence. A resolver score alone would hide both kinds of
failure.

## Misses and safe abstentions

Four works did not consult any reviewed direct-author or publisher origin:

- _Sealfinger_ missed `goodyandgrant.com` and `pigeonparkpress.com`. It instead used author-member
  directory pages on `thecwa.co.uk` and proposed the correct Sam Applewhite membership from the
  wrong source class.
- _How to Buy a Planet_ missed `squirrelandacorn.co.uk` and remained unresolved.
- _Goldilocks_ missed `lrlam.co.uk` and remained unresolved.
- _Odd Numbers_ missed `jjmarshauthor.com` and remained unresolved.

Two more works found a known origin but not the exact reviewed page needed for a decision:

- _Barbacoa, Bomba, and Betrayal_ found Penguin Random House book and author pages, but not the
  publisher's Caribbean Kitchen Mystery series page, so it remained unresolved.
- _The Doors of Eden_ found the author's origin and publisher identity pages, but not the author's
  affirmative standalone bibliography, so it remained unresolved.

_The Light of the Midnight Stars_ found its exact Hachette catalog source but also proposed
standalone status from the selection-frame taxonomy. Existing deterministic policy quarantined the
classification. The correct result is unresolved, because selection provenance cannot establish
its own label.

No approved retrieval profile was eligible for an unresolved case. The optional retrieval path
therefore made zero HTTP requests and zero second model calls. For the four origin misses, a
retrieval profile could not help because profiles never inject a known host. For the two deep-page
misses, retrieval could help only after a separate rights and technical review approves that
origin.

## Post-finding policy replay

After `thecwa.co.uk` became discovery-only, the unchanged raw evidence was replayed through the
cleaner from cache. The replay made no model call, search, retrieval request, or corpus write.

| Valid output | Policy-safe | Resolved | Resolved accuracy | Series precision | Series recall | False standalone | False series |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 95.5% | 90.9% | 68.2% | 100% | 100% | 72.7% | 0% | 0% |

The lower resolution is the desired safety effect: _Sealfinger_ is no longer accepted merely
because an association hosts an author profile. The remaining policy-unsafe case is _The Light of
the Midnight Stars_; all other unresolved cases are valid abstentions. The original fresh result
remains the unbiased discovery measurement, while the replay documents how the new deterministic
policy changes usability.

## Cost and efficiency

The fresh run used 22 model calls, 52 hosted searches, 336,632 input tokens, and 10,863 output
tokens. At the 2026-09-07 standard GPT-5.6 Luna rates used by the earlier pilot—$0.20 per million
input tokens, $1.20 per million output tokens, and $10 per 1,000 web searches—the estimated cost is
$0.6004 total, or $0.0273 per work. Search accounts for about 86.6% of the estimate.

The scout averaged 2.36 searches per work and one model call per work. Mean first-pass latency was
9.0 seconds; p95 was 12.7 seconds. There were no API errors, structural repair calls, retrieval
requests, or second-pass calls. Pricing reference: https://developers.openai.com/api/docs/pricing

## Boundary and next gate

This experiment made no Supabase request, production request, corpus write, gold edit, or deploy.
Private run files retain the full source manifest and model proposal; the committed report contains
only metrics, domains, and paraphrased outcomes.

Do not tune the locator to these 22 titles or report a rerun as fresh holdout evidence. Keep this set
as a regression benchmark. The next general improvement should make source ownership deterministic
before any first-pass proposal is treated as usable review evidence: distinguish author/publisher
origins from associations, retailers, libraries, media, and hosted profile platforms without
asking the model to certify the owner. After that policy is frozen, measure it on a new untouched
slice. Production integration still waits for the locked 1,000-case qualification partition and
the existing rights, privacy, latency, cost, membership-precision, and standalone-safety gates.
