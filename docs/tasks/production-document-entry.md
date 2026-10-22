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
`VERCEL=1`, so the same check also invokes the compiled Vercel handler for `/`, `/auth`, `/library`
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
