import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // mjs handler tests execute Deno entrypoints under an explicitly stubbed host.
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
  },
})
