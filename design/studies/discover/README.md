# Discover interaction study

A standalone review of guided discovery in Reverie's real room materials, typography, buttons,
and detail sheet. Read [the specification](DISCOVER_READING_DECISION.md) for the proposed product
behavior, evidence gaps, build sequence, and production acceptance criteria.

From the repository root:

```sh
pnpm --filter @reverie/web exec vite --config ../../design/studies/discover/vite.config.mjs
```

Open <http://127.0.0.1:4346/>. The review toolbar switches all nine rooms, Day/Night, and sample
reader/failure scenarios. Try each starting path, open a book, change its sample wishlist/copy
flags, set a result aside and undo, save a shortlist, and return through **Saved here**.

The four-book catalog and reading relationships are authored fixtures. Shortlists and copy changes
live only in memory and reset on refresh. The page does not connect to an account or ranking API.
Known-title search demonstrates title/author matching; production retains ISBN support. Search
shows an exact match even when that work was set aside in the guided shortlist.

## Verification — 2026-09-06

| Check                                                                   | Observed result                                                                                                                                                 |
| ----------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Dedicated TypeScript check, ESLint with design files included, Prettier | Passed.                                                                                                                                                         |
| Standalone Vite build                                                   | Passed; includes the linked specification as an asset.                                                                                                          |
| Desktop shortlist, nine rooms × Day/Night                               | No Axe WCAG A/AA violations; zero horizontal overflow.                                                                                                          |
| 320px shortlist, nine rooms × Day/Night                                 | Zero horizontal overflow or horizontally clipped button text.                                                                                                   |
| Marginalia mobile entry and detail                                      | No Axe WCAG A/AA violations at 390px entry and 320px detail.                                                                                                    |
| Entry reflow                                                            | Zero horizontal overflow at 320, 720, 768, and 1440px. The 720px check covers the CSS width of a 1440px window at 200% zoom; it is not an OS/browser zoom test. |
| Details and keyboard return                                             | Escape and explicit close restore the opener with zero scroll delta; browser Back closes details and Forward reopens them.                                      |
| Independent relationships                                               | Owned, Borrowed, and On your wishlist displayed simultaneously after explicit actions.                                                                          |
| Dismiss/undo and saving                                                 | Dismissed work omitted from saved shortlist; returning preserved the two remaining books in order. Undo restored the original card.                             |
| Guided paths                                                            | Reflective + Hopeful returned Psalm and Sweetgrass; Nonfiction returned Sweetgrass; title search returned Tombs. Two-mood limit announced.                      |
| Recovery scenarios                                                      | Empty reader can begin with mood; no-match adjustment returns to choices; catalog retry restores results; verified series fixture opens Tombs.                  |
| Reduced motion                                                          | Material canvas remained pixel-identical across a 600ms observation with reduced motion enabled.                                                                |
| Main shortlist cover sources                                            | All three loaded at 1000px source width for a 190px rendered cover. Full jackets remain visible.                                                                |

Browser verification used the Playwright CLI in Chromium. Representative screenshots remain in
the local ignored `output/playwright/` directory: `discover-desktop-entry.png`,
`discover-desktop-results.png`, `discover-tryst-night.png`, `discover-aphelion-night.png`,
`discover-mobile-entry.png`, `discover-mobile-results.png`, and `discover-mobile-detail.png`.
Publisher images are linked, not copied into the repository.

Commands executed from the root:

```sh
pnpm exec tsc -p design/studies/discover/tsconfig.json
pnpm exec eslint --no-ignore design/studies/discover/catalog.ts design/studies/discover/DiscoverStudy.tsx design/studies/discover/main.tsx design/studies/discover/vite.config.mjs
pnpm exec prettier --check design/studies/discover design/DESIGN_BACKLOG.md
pnpm --filter @reverie/web exec vite build --config ../../design/studies/discover/vite.config.mjs
```

Scope is entirely `design/`. No `apps/`, `packages/`, `supabase/`, test infrastructure, or production
behavior changed. The full fresh-database application e2e requirement is therefore not triggered
by this study; no application DB/e2e result is claimed. Live ranking, owner-scoped persistence,
offline recovery, and account switching require their own implementation and validation after
review. Automated contrast/layout checks do not replace an observed reader walkthrough.
