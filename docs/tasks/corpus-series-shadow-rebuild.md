# Corpus series shadow rebuild

## Decision

Rebuild the shared series graph from a frozen corpus-identity inventory. Historical series labels,
classifier states, suggestions, graph memberships, and evidence are comparison data only; they are
not inputs to source acquisition or model review. This avoids treating output from the retired
classifier as truth while preserving an auditable rollback reference.

The rebuild is a shadow workflow. It cannot modify Supabase, the shared graph, or personal books.
Production remains unchanged until a later reviewed delta is applied through existing administrator
boundaries.

## Sequence

1. **Freeze identity.** Export every shared work ID, exact title, ordered full author list, optional
   publication year, and identity fingerprint into ignored `private-results/`. Reject partial
   identities and any series-related field.
2. **Acquire source relationships.** Query the existing fixed-host provider adapters from the frozen
   identity. Google remains identity-only. A provider label without an exact-work relationship is
   not membership evidence. Preserve conflicts rather than selecting the first or largest group.
3. **Build a candidate graph.** Group only exact normalized relationship names within full-author
   scope. Keep membership and position confidence separate. Singletons, self-titled containers,
   fractional positions, reading orders, universes, conflicting names, and incomplete identities
   remain review-only.
4. **Review every proposed final group.** Luna-low checks direct author/publisher evidence for the
   group and its claimed members. Exa runs only after Luna is unresolved or policy-quarantined and
   remains an ephemeral locator, never evidence. Affirmative standalone claims require direct
   authority support; absence of a series label is unresolved.
5. **Compare after completion.** Only after the shadow graph is frozen may it be compared with the
   historical graph. Report exact matches, missing members, false/extra memberships, name/order
   conflicts, and unsupported singletons.
6. **Apply reviewed deltas.** Use revision-checked administrator actions. Archive or replace
   incorrect shared relationships without deleting audit history. Reader-selected and CSV-imported
   personal series choices remain untouched.

## First command

This command performs one read-only production query and writes one owner-only ignored file. Its
fixed default path prevents accidentally freezing several competing baselines.

```sh
pnpm --filter @reverie/series-source-trial authority:corpus-shadow:export -- \
  --project PROJECT_REF
```

The exporter intentionally excludes ISBNs as well as series data from the first frame. Existing
ISBN assignments may themselves be historical or ambiguous; provider acquisition may admit an ISBN
only after its normal exact title/full-author validation.

## Relationship acquisition

Acquire source relationships in batches of at most 250 frozen identities. The command uses the
existing fixed-host adapters, validates every adapter result against the exact selected batch, and
writes a new owner-only ignored report. It never reads historical series data and has no Supabase
writer.

```sh
pnpm --filter @reverie/series-source-trial authority:corpus-shadow:acquire -- \
  --input packages/series-source-trial/private-results/corpus-series-shadow/PROJECT_REF.json \
  --offset 0 \
  --limit 250
```

The default source set is Open Library, Wikidata, Inventaire, BookBrainz, and Hardcover. Google is
available only as an explicit identity-only diagnostic and cannot contribute a relationship.
Outputs are create-only so a later command cannot silently replace an earlier observation.

The candidate graph groups exact normalized relationship names inside the frozen full-author scope.
It carries source lineage, position observations, eligibility, conflicts, and risk flags forward.
Every group is marked for Luna review, including apparently corroborated groups. A work with no
exact relationship remains unresolved with `standalone: null`; absence never becomes a standalone
classification.

After every source batch completes, merge the reports before model review. The merger requires one
frozen frame, one ordered provider set, exact contiguous coverage from zero through the complete
inventory, unique work identities, and stable provider-rights metadata. It rebuilds the candidate
graph from all raw observations so a series divided by a batch boundary becomes one group.

```sh
pnpm --filter @reverie/series-source-trial authority:corpus-shadow:merge -- \
  --input packages/series-source-trial/private-results/corpus-series-shadow-acquisition/BATCH-1.json \
  --input packages/series-source-trial/private-results/corpus-series-shadow-acquisition/BATCH-2.json \
  --out packages/series-source-trial/private-results/corpus-series-shadow-merged/full.json
```

Partial, overlapping, mixed-provider, or identity-drifted inputs fail closed. The merged artifact is
still private, review-only, create-only, and has no production writer.

## Luna group review

Review the merged graph in bounded batches of at most 50 groups. One Luna-low call reviews the
candidate relationship and every claimed member together, allowing a direct author or publisher
series page to resolve several books without a naive work-by-work pass.

```sh
pnpm --filter @reverie/series-source-trial authority:corpus-shadow:review -- \
  --input packages/series-source-trial/private-results/corpus-series-shadow-merged/full.json \
  --offset 0 \
  --limit 25 \
  --env /ABSOLUTE/PATH/TO/series-source-trial/.env.local
```

The model must return one ordinary authority proposal for every member. Existing deterministic
identity, grounding, source-risk, relationship, container, and conflict validation is applied to
each proposal. A group is supported only when every member has policy-safe direct authority
evidence for that exact candidate relationship. Different series evidence rejects the candidate
only when every member is safely resolved against it; all other outcomes remain review. Successful
group calls are cached by the complete target and model configuration so an interrupted batch can
reuse them without another billable request. Reports and caches are owner-only ignored files and
the command has no Supabase client or writer.

This is deliberately the Luna stage only. `--exa-fallback` and `--refresh` are refused. A later
fallback stage may admit only unresolved or policy-quarantined Luna results; Exa remains an
ephemeral locator and never becomes evidence.

Completed Luna batches must be merged with complete, contiguous candidate-group coverage before
Exa routing. The merged private report admits only unresolved or policy-quarantined member reviews;
it does not send supported candidates, rejected source tuples, valid alternative classifications,
malformed output, or infrastructure errors to Exa.

## Model placement and cost

Do not run Exa for every work. It cannot establish truth, and the September recovery-review batch
showed substantial added search volume with little selected incremental evidence. Luna reviews every
proposed final series group and affirmative standalone claim. Work-level follow-up is reserved for
ambiguous membership, position, identity, or source conflicts. Grouping deterministic provider
evidence before model review avoids a naive per-work pass while retaining full-corpus coverage.
