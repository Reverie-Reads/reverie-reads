# Book data: app first

Status: owner-approved scope reset, September 9, 2026. This records priorities and the next
bounded step; it does not ship an LLM integration or approve new source use.

## Outcome and deferred work

Help readers find the right book and receive accurate shared details, cheaply. Improve the
existing approach before adding infrastructure. A book-data provider/API may become a separate
product after the reader app gains users; it is not a prerequisite for attracting those users.

Keep provider-comparison PR #521 draft. Defer its live endpoint, optional edition/page editor,
new shared vector/graph database and additional provider procurement. None is a dependency of
the next series-data step. ISBNdb stays retired. Existing vector similarity can support finding
related books; it cannot establish identity, series membership or factual correctness.

## What already exists

Inspected public main `afcb2a7543a4fce2fb0a9f315c8248bb506dd612`; these are source-code findings,
not a new production deployment or populated-data verification.

- `apps/web/src/lib/seriesClassification.ts` requests a candidate's Hardcover relationship and
  passes it to the deterministic classifier. This is not the trial LLM resolver.
- `apps/web/src/data/enrichCorpus.ts` already loads pending shared-series suggestions with
  identity confidence, membership confidence, reasons and evidence. Its review mutation calls
  the existing accept/dismiss RPC.
- `apps/web/src/routes/ReviewRoute.tsx` renders that queue, current/proposed values, source links
  and explicit review actions. We do not need a second administrator queue just to show evidence.
- `packages/series-source-trial/src/resolve.mjs` writes validated per-case JSON and an aggregate
  Markdown report. It has no Supabase writer. Its output is research material, not a catalog
  import format or production acceptance credential.

The missing connection is a safe, useful handoff of research evidence to a human reviewing a
specific catalog work. Neither a new database nor a provider-comparison UI supplies that connection.

## Next bounded step

Walk one existing, non-holdout development case through the human review process before building
an endpoint or report importer. Use an already acquired report; no new paid acquisition is needed.

1. Identify the exact title and full author, the suggested fact, its cited source, and any
   withheld fields or conflicts. Recheck current deterministic validation; a saved model decision
   alone is not evidence of eligibility. Keep research material in the existing private workspace.
2. Independently inspect the eligible original source and confirm it names this exact work in
   the claimed relationship. Missing evidence means unresolved, never standalone. Do not persist
   restricted provider content through a review note or use Exa output as evidence.
3. Exercise the existing review/correction flow locally with synthetic fixtures, not production
   writes. Record exactly what information the reviewer lacks. An administrator's independent
   source check is distinct from accepting model output or relabeling it as manual evidence.
4. Implement only a demonstrated gap in that reachable flow. If the existing controls suffice,
   keep the handoff manual rather than introducing an importer, endpoint or second review system.

Success for this step is one understandable review handoff, source attribution and protected
reader choices—not a new accuracy percentage or a claim that the LLM is production-qualified.
Measure reviewer effort and the concrete missing control before expanding the feature.

## Boundaries that do not change

The resolver and authority scout remain trial-only. Their output cannot be sent to the existing
automatic discovery writer simply because a review queue exists. An in-app LLM pilot requires
an explicit reviewed scope for input privacy, source use, retention, budget, identity binding,
stale evidence and authorization before implementation or deployment.

The locked production qualification plan remains intact, including its private, single-use
holdout. It is not being reduced or replaced by this development walkthrough, and no qualification
case is opened, rerun or consumed here. Qualification gates production promotion of the trial
capability; it does not prevent the already-shipped app or independent human source review.

No production, billing, credentials, source enrollment, public data licensing or database changes
are part of this scope reset. A future provider API needs a separate product and redistribution
decision; growing our catalog does not itself grant the right to redistribute upstream data.
