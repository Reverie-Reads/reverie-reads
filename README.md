# Reverie

Reverie is a personal book library. It tracks the books you own and read behind a
skinnable, genre-neutral interface — nine distinct "skins" (romance, fantasy, sci-fi,
horror, mystery, literary, cozy, nonfiction, YA) that reskin the whole app to the shelf
you're in. Its guiding idea: **your own taste should drive discovery**, so the app ranks
what to read next against _your_ library rather than aggregated star ratings — it never
computes or shows an averaged rating.

It handles spice levels, tropes, series gaps, rereads, per-format ownership, cover
sourcing, offline caching, and a book-club layer, and calibrates a personal "taste tier"
for recommendations from your own loved books.

## Stack

- **Web:** React + TypeScript (strict) + Vite + Tailwind (design tokens) + TanStack
  Router/Query, light Zustand state, IndexedDB (Dexie) offline cache.
- **Backend:** Supabase — Postgres (with `pgvector` for taste/semantic search), Auth,
  Realtime, Storage, Edge Functions (Deno).
- **Repo:** pnpm-workspaces monorepo — `apps/web` (UI), `packages/core` (shared logic),
  `supabase/` (migrations + functions).
- **Hosting:** Vercel (web) + Supabase (backend).

## Local setup

**Prerequisites:** Node ≥ 20.11, `pnpm` 11, the [Supabase CLI](https://supabase.com/docs/guides/cli),
and Docker (for the local Supabase stack).

```bash
pnpm install
supabase start          # local Postgres + Auth + Storage + edge runtime
pnpm db:migrate         # apply migrations + reload the PostgREST schema
pnpm db:seed            # optional: load the dev library
pnpm dev                # run the web app
```

### Environment variables (names only — never commit values)

The committed `apps/web/.env` already carries the local-stack defaults — a fresh clone needs no
env setup for local dev. For real keys (Sentry) or a non-local backend, copy
`.env.example` / `apps/web/.env.example` to the matching `.env.local` and fill in your
own values. Names only:

- **Required:** `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`.
- **Optional:** `VITE_SENTRY_DSN`, `VITE_SOCIAL_AUTH_ENABLED`,
  `VITE_BUY_ATTRIBUTION_MODE`, `VITE_BOOKSHOP_AFFILIATE_ID`,
  `VITE_CARTO_BASEMAP_KEY` (required only to render the Bookshops map; the list works without it).
- **Set by the build, not by you:** `VITE_BUILD_ID` and `VITE_RELEASE` are both baked to the
  deploy's commit SHA by a `define` in `apps/web/vite.config.ts`. Setting either in a `.env`
  has no effect — the define substitutes them at build time.
- **Server / edge secrets** (deployment environment only — never in the repo): the Supabase
  service-role key, `HARDCOVER_TOKEN`, and any provider API keys. See `docs/reference/DEPLOY.md`.

The publishable Supabase key and CARTO's domain-restricted basemap key are client-visible by design.
The service-role key and server provider keys are secrets and live only in deployment settings.

### Commands

```bash
pnpm dev      # web app (Vite dev server)
pnpm build    # production build (core tsc + web tsc/vite)
pnpm test     # unit tests (Vitest, all packages)
pnpm e2e      # Playwright end-to-end (includes the axe sweep — four skins x both modes)
pnpm lint     # ESLint
```

## Deploy discipline

Production deploys run **from `main`, after a PR merges**, through the guarded scripts —
never from a feature branch mid-flight:

```bash
pnpm deploy:migrations    # supabase db push, behind the deploy guard
pnpm deploy:functions     # supabase functions deploy, behind the deploy guard
```

The guard refuses to run unless you're on a clean, in-sync `main` and confirm the touch
list. Full runbook: [`docs/reference/DEPLOY.md`](docs/reference/DEPLOY.md).

## License — three objects, three answers

This app's code is licensed under [AGPL-3.0](LICENSE). The book metadata corpus is
dedicated to the public domain under [CC0](LICENSE-CORPUS) — free to use for anything.
Your shelves, ratings, and reading history are yours: never published, never part of the
dataset, never licensed to anyone.

Contributions require signing the [CLA](CLA.md) — see
[`CONTRIBUTING.md`](CONTRIBUTING.md). Book cover images and third-party bibliographic
records are not the repository owner's to license — see [`NOTICES.md`](NOTICES.md).
Premium features live in a private module outside this repository and are not covered by
this repository's licenses.

## Build-phase docs (working notes)

> These are internal working notes from the build-out, kept for continuity. They are not
> onboarding docs for a new reader of the repo.

- `AGENTS.md` — context loaded by coding agent; the working conventions.
- `docs/archive/CODING_AGENT_KICKOFF.md` — the sequenced build plan.
- `ROADMAP.md` — path from prototype to shipped product.
- `docs/reference/ARCHITECTURE.md`, `docs/reference/DATA_MODEL.md`, `docs/reference/FEATURES.md`,
  `docs/reference/REQUIREMENTS.md` — specs and object shapes.
- `prototype/Reverie_Library.html` — the original single-file prototype (behavior
  reference; not the code that ships).
