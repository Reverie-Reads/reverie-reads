# Production deployment

Reverie runs hosted as of 2026-07-06. This file is the record of the production topology and
the runbook for shipping to it. Owner decisions: **Reverie** is the name (2026-07);
**reveriereads.app** is the domain (2026-07-06).

## Topology

| Piece         | Where                                               | Notes                                                         |
| ------------- | --------------------------------------------------- | ------------------------------------------------------------- |
| Backend       | Supabase project `tzimctugmzuadrsitnpr` (us-west-2) | Postgres + Auth + Storage + Edge Functions; pgvector enabled  |
| Web app       | Vercel — https://reveriereads.vercel.app            | custom domain: reveriereads.app                               |
| External APIs | Hardcover + Google Books; PRH when configured       | Provider keys are Supabase function secrets, never in web env |

The existing `search`, `enrich`, `covers`, `series`, and `releases` Edge Functions read provider
credentials from project-wide Supabase secrets. Configure these once in Supabase; never copy them
into the web environment or commit them:

```text
GOOGLE_BOOKS_KEY=<Books API key>
BOOKS_KEY_REFERER=https://reveriereads.app/
HARDCOVER_TOKEN=<backend-only personal token>
PRH_API_KEY=<optional Penguin Random House public API key>
```

Adding or rotating a Supabase function secret does not require a function redeploy. Verify the
change through the real reader search flow before enabling a corpus-wide run. A token exposed in a
terminal, report, or task transcript must be revoked and replaced rather than reused.

## Web env (Vercel project settings)

```
VITE_SUPABASE_URL=https://tzimctugmzuadrsitnpr.supabase.co
VITE_SUPABASE_ANON_KEY=sb_publishable_kp8TvVCeARWRqqk4z0a0CA_35y5KZgQ   # publishable — client-safe by design
# optional: VITE_SENTRY_DSN, VITE_SOCIAL_AUTH_ENABLED, VITE_BUY_ATTRIBUTION_MODE + affiliate ids,
# VITE_CARTO_BASEMAP_KEY (browser-safe Bookshops basemap key; restrict it to deployed domains)
```

The durable administrator corpus sweep also needs two **server-only** Vercel variables. Never add
either to a `VITE_` name or commit the service key:

```
SUPABASE_SERVICE_ROLE_KEY=<hosted project's service-role key>
CORPUS_SWEEP_WORKFLOW_ENABLED=false
```

Keep the workflow flag false through the web merge/deploy. After the owner has installed the paired
database migration and `covers`/`series` Edge Functions from clean, updated `main`, change it to
`true` and redeploy/promote the web app. While false, status reads are inert and start/cancel return
503, so an automatic Vercel deploy cannot create a half-configured run.

## Shipping changes

Every prod deploy goes through the **deploy guard** (`scripts/deploy-guard.sh`, wired to the pnpm
scripts below). It refuses to run unless you are on `main`, the tree is clean, and local `main` is in
sync with `origin/main`; it then prints exactly what it will touch and waits for a `y/N`.

- **Schema**: `pnpm deploy:migrations` (wraps `supabase db push`; the guard shows the
  `supabase migration list` local↔remote table first). After the operator answers the guard's human
  `y/N`, it passes explicit downstream approval to the CLI so a second prompt cannot treat EOF as
  consent. Local dev uses `pnpm db:migrate` (adds the PostgREST schema reload).
- **Edge functions**: `pnpm deploy:functions` (all) or `pnpm deploy:functions embed` (one) — wraps
  `supabase functions deploy`.
- **Web**: Vercel deploy (git-connected or `vercel --prod`).

> **All prod deploys — migrations AND functions — run from `main` only, after the PR merges, via the
> guard; never from a feature branch mid-flight.** A push must be confirmed complete (each migration
> version recorded in the history, not just the SQL applied) before doing anything else. The guard's
> `--force` / `DEPLOY_ALLOW_DIRTY=1` override exists for a deliberate, confirmed hotfix from a branch
> — it prints a loud warning and still requires the `y/N`, so it can never fire accidentally.
> (Codifies the 2026-07-14 incidents: branch migrations reached prod unrecorded so a later `db push`
> re-ran and errored; and a `covers` function was deployed from a feature branch when a heredoc in a
> PR body evaluated an un-quoted `supabase functions deploy covers` — see the heredoc rule in
> `AGENTS.md`.)

### Durable corpus-sweep rollout order

Current production status (2026-09-04): the workflow rollout and recovery follow-up are live through
`20260922010000`, the shared-series reading-order follow-up is live through `20260923010000`, and
the owner has parked four repeatedly deferred works rather than treating them as an endless release
gate. Keep the sequence below for future workflow deployments.

This change alters an administrator write path, so Codex prepares it but does not execute these
production steps or answer the deploy guard's confirmation:

1. In Vercel, add `SUPABASE_SERVICE_ROLE_KEY` as a server-only secret and set
   `CORPUS_SWEEP_WORKFLOW_ENABLED=false`.
2. Merge the reviewed PR, update local `main`, and verify the worktree is clean and synchronized.
3. Run `pnpm deploy:migrations` and answer its human `y/N` prompt. Confirm migration
   `20260921010000_durable_corpus_sweeps.sql` is recorded in production history.
4. Run `pnpm deploy:functions covers`, then `pnpm deploy:functions series`, each through the guard
   with the owner at the keyboard.
5. Set `CORPUS_SWEEP_WORKFLOW_ENABLED=true`, deploy/promote the web app, and confirm its deployed
   commit contains the migration's branch commit.
6. As a corpus administrator, start one sweep, leave Settings, return, and verify the same run and
   counters reconnect. Request stop only if needed; it completes the current work before cancelling.
7. Confirm the run reaches `completed`, deferred works remain eligible for another run, and the
   historical personal/household corpus and reviewed Series surfaces are unchanged.

## Post-deploy configuration checklist (dashboard tasks)

- [ ] Supabase → Auth → URL Configuration: site URL + redirect URLs include
      `https://reveriereads.vercel.app` and `https://reveriereads.app` — magic links bounce without it.
- [ ] Google Cloud console → Books API key referrers: `https://reveriereads.vercel.app/*`,
      `https://reveriereads.app/*`, plus localhost patterns (`http://localhost:4317/*`,
      `http://localhost:5173/*`) so local dev keeps the key's quota.
- [ ] Function secrets: `GOOGLE_BOOKS_KEY`, `BOOKS_KEY_REFERER`, and `HARDCOVER_TOKEN` for the
      configured metadata providers; optional `PRH_API_KEY` (publisher confirmation for its own
      catalog), `ISBNDB_ENABLED`/`ISBNDB_KEY` (paid, off by default), and `SENTRY_DSN` (edge
      observability).

## Smoke test

A throwaway user exercises the full lifecycle against production, then deletes itself through
the real `delete-account` fn: sign-in → profile trigger → book inserts → embed sweep (hosted
Supabase.ai — the piece local dev can't fully mirror) → `similar_books` / vibe / rank →
`match_feedback` write → cleanup. Email confirmation is ON in prod, so the smoke account needs
its confirm link clicked once.

## Local ↔ prod

Local dev is the full mirror (`supabase start`, seeded dev user, `apps/web/.env.local` pointing
at 127.0.0.1:55321). Known divergence: the local edge runtime is ~10× slower per gte-small
inference — the embed fn's time-budgeted batching absorbs this (few embeds/call locally, full
batches hosted), so behavior differs only in backfill speed.
