# Production document entry

A fresh navigation to `/` returned HTTP 200 JavaScript rather than HTML. The response was identical
to `/index.js`; `/index.html` and `/auth` still returned the SPA document. A successful build, version
marker and browser suite did not detect this because the local browser-test build deliberately
omits Nitro/Workflow.

The `browser-test` naming override had a production branch of `entryFileNames: undefined`. Vite
spreads custom output options after its asset naming defaults. The explicit undefined removed that
default and Rollup emitted `index.js` at the public root. The production document also referenced
that file. The fix preserves a hashed `assets/[name]-[hash].js` production entry while retaining the
explicit browser-test appearance entry.

`assert-production-documents.mjs` runs on the generated output after every ordinary build. It refuses
root JavaScript index files, renders the compiled Nitro HTML template, and checks that its local
module entries exist under `assets/` and contain JavaScript rather than HTML. CI builds with
`VERCEL=1` and explicit `NITRO_PRESET=vercel` (GitHub Actions otherwise wins platform
autodetection), so the same check also invokes the compiled Vercel handler for `/`, `/auth`, `/library`
and a deliberately invalid bookstore query. The query must remain an API error, not SPA fallback.
Network access is refused throughout those probes; this does not exercise provider acquisition,
Supabase, authenticated writes or Workflow execution.

The regression was run against the original Vercel build before changing the naming rule and
failed on its actual root `index.js`. The first fixed-build check exposed the verifier's incorrect
assumption that Nitro's renderer returned a native Response; it returns H3's response object.
The verifier now reads its HTML body and uses native responses only at the compiled handler.
Both failed receipts are retained separately from later verification.

The generated-artifact guard covers the observed collision and compiled fallback behavior. An
actual staged Vercel deployment still needs an HTML content-type/doctype check at `/`, working
client assets, app-route fallback and preserved API routing before production promotion. HTTP 200
alone is insufficient. Public changes land first; the private overlay follows through its normal
reviewed sync. This change does not alter intake, shared metadata or personal data.

The first hosted gate selected the Node preset despite `VERCEL=1`, because the runner's GitHub
provider took precedence. The explicit Nitro preset corrects the test target; the missing Vercel
artifact refusal is retained. Browser jobs failed before tests when the GHCR-only image override
was throttled. Restore the pinned CLI's normal registry/fallback selection without changing workers,
assertion timeouts or retry policy. These failures do not establish browser acceptance.

The second hosted code gate passed, including the Vercel artifact checks. The browser jobs exhausted
the default registry fallback too: ECR refused its data limit, anonymous GHCR throttled, and Docker
Hub lacked the required Kong image. The browser job now authenticates the GHCR fallback with its
ephemeral read-only package token, which the pinned CLI reads from Docker's registry configuration.
It logs out on exit and preserves the default fallback order. This is a correction to registry
access, not a retry of unchanged infrastructure or a relaxation of the browser checks.

Authentication alone did not remove the shared registry limit: run 39839477124 passed the code
gate, database assertions and desktop/mobile suites, but accessibility never reached the browser.
Its failed acquisition remains evidence. CI now acquires public images once per workflow, in
sequence, by immutable Linux amd64 manifests. The committed image IDs were resolved from Supabase's
published GHCR manifests for CLI 2.109.0 on October 22. The plan includes the pgTAP runner too.
The helper allows only Supabase's ECR/GHCR mirrors, checks content and architecture before tagging,
and validates both the plan and compressed archive hashes when loading a cache or artifact.
An integrity failure stops rather than silently fetching a replacement.

The reviewed primary tags satisfy CLI 2.109.0's `PullPolicyMissing` and image-cache checks. Both
startup paths explicitly unset setup-cli-inherited registry overrides so those tags remain usable.
See its
[service construction](https://github.com/supabase/cli/blob/v2.109.0/apps/cli-go/internal/utils/config.go)
and [registry resolution](https://github.com/supabase/cli/blob/v2.109.0/apps/cli-go/internal/utils/docker.go).
Each browser job receives the same image bundle through a same-run artifact, rechecks its content,
and starts a fresh database. No containers, database volumes, local development state or credentials
are archived. The exact cache key includes the reviewed plan, helper and project configuration;
there are no broad restore keys or overrides of GitHub's cache permissions. Main warms the shared
default-branch cache. A warm bundle needs no registry login or acquisition.

The earlier decision against image caching measured speed; repeated download refusals demonstrate
an availability need. Cold and warm behavior still require hosted verification. The same change
adds an explicit `verify-full-browser` PR label: apply it before pushing the candidate to request
one complete hosted run at one worker with `--retries=0`, including a fresh database. This leaves
the existing three matrix checks and their retry policy intact. It supplies the complete gate when
the Mac cannot safely launch browsers, without bypassing its capacity refusal or touching its
personal development data. Temporarily stopped optional local services were restored to their
original identities and running states; no local database reset was performed.

The dependent browser jobs use `!cancelled()` rather than `always()`: they still publish explicit
failures when image preparation fails, but a superseded run remains cancellable. The independent
browser step after SQL assertions uses the same condition. This preserves failure visibility
without letting an older browser run outlive the concurrency cancellation of its candidate.
