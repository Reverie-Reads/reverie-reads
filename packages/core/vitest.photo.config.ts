import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/photoIntakeTools.test.mjs'],
    fileParallelism: false,
  },
})
