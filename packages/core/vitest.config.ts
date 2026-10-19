import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    // mjs handler tests execute Deno entrypoints under an explicitly stubbed host.
    include: ['src/**/*.{test,spec}.{ts,mjs}'],
    // Swift/ImageIO/Vision process checks run after the parallel workspace suites in root `test`.
    // Keep native image work from competing with request-pacing and browser measurements.
    exclude: ['src/photoIntakeTools.test.mjs'],
  },
})
