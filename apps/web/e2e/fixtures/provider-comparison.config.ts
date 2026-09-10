import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

// Isolated synthetic display harness. The app's Nitro renderer intentionally handles HTML routes,
// so use a dev-only fixture server instead of adding a fake-data route to the shipped application.
export default defineConfig(({ command }) => {
  if (command !== 'serve') throw new Error('provider_comparison_fixture_is_dev_only')
  return { plugins: [react(), tailwind()], server: { host: '127.0.0.1', strictPort: true } }
})
