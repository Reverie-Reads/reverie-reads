import js from '@eslint/js'
import globals from 'globals'
import tseslint from 'typescript-eslint'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import noHardcodedControlRadius from './eslint-rules/no-hardcoded-control-radius.js'

export default tseslint.config(
  {
    ignores: [
      '**/dist/**',
      '**/.output/**',
      '**/.vercel/**',
      '**/.swc/**',
      '**/node_modules/**',
      '**/playwright-report/**',
      '**/test-results/**',
      '**/coverage/**',
      'prototype/**',
      'data/**',
      'backend/**',
      '.ds-sync/**',
      'ds-bundle/**',
      '.design-sync/**',
      'design/**',
      'docs/**',
      'supabase/**',
      // Private, frozen trial artifacts are not application source and must remain untouched.
      'packages/series-source-trial/private-inputs/**',
      'packages/series-source-trial/private-results/**',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    // The e2e suite reads Supabase results ONLY through ./support/ok — and this rule is what keeps
    // that true, because nothing else can. `tsc` never looks at this directory (apps/web/tsconfig.json
    // includes only ["src", "vite.config.ts"]), so `noUnusedLocals` — which makes a swallowed
    // `const { error }` a compile error in src/ — does not apply here at all. That asymmetry, not
    // discipline, is why every swallowed Supabase error in the repo lived under e2e/.
    //
    // Scoped to non-null assertions on a RESULT field rather than banning `!` outright: `rows[0]!` and
    // `reads[0]!` after an explicit length check are idiomatic under noUncheckedIndexedAccess and have
    // nothing to do with error handling. Banning those too would have meant 14 unrelated edits and a
    // rule people would reach for an eslint-disable to get around.
    files: ['apps/web/e2e/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'TSNonNullExpression > MemberExpression[property.name=/^(data|user|session)$/]',
          message:
            'Read Supabase results through ok() / okData() / okUser() from ./support/ok. A non-null assertion on .data/.user/.session turns a failed call into a bare TypeError pointing at the read instead of the call.',
        },
      ],
    },
  },
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: {
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
      // Local rule: once a control carries the skin kit's silhouette, a hardcoded radius may never
      // override it. Ships at `error` — it has no false positives by construction (see the rule).
      skin: { rules: { 'no-hardcoded-control-radius': noHardcodedControlRadius } },
    },
    rules: {
      'skin/no-hardcoded-control-radius': 'error',
      'react-hooks/rules-of-hooks': 'error',
      'react-hooks/exhaustive-deps': 'warn',
      'react-refresh/only-export-components': ['warn', { allowConstantExport: true }],
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_' },
      ],
    },
  },
  {
    // Node scripts (seed, tooling) run outside the browser.
    files: ['**/*.{js,mjs,cjs}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.node },
    },
  },
  {
    // The service worker runs in a worker scope (self/caches, no window).
    files: ['**/public/sw.js'],
    languageOptions: {
      globals: { ...globals.serviceworker },
    },
  },
  {
    // TanStack Router (code-based) route modules legitimately export route objects
    // alongside their screen component; Fast Refresh isn't a concern for them.
    files: ['**/routes/**/*.tsx', '**/*Route.tsx', '**/router.tsx', '**/AuthProvider.tsx'],
    rules: {
      'react-refresh/only-export-components': 'off',
    },
  },
)
