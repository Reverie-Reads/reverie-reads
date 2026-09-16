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

## Model placement and cost

Do not run Exa for every work. It cannot establish truth, and the September recovery-review batch
showed substantial added search volume with little selected incremental evidence. Luna reviews every
proposed final series group and affirmative standalone claim. Work-level follow-up is reserved for
ambiguous membership, position, identity, or source conflicts. Grouping deterministic provider
evidence before model review avoids a naive per-work pass while retaining full-corpus coverage.
