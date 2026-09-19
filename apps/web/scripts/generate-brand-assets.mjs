import { createHash } from 'node:crypto'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import { dirname, resolve, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(here, '../public')
const sourceDir = resolve(here, '../../../design/midniht/brand-kit')

// Publish the approved exports byte-for-byte. Never redraw or retrace the master;
// the reader's face, short wavy hair, and cleaned joins are deliberate geometry.
const assets = {
  'favicon.svg': 'midniht-mark.svg',
  'favicon.ico': 'favicon.ico',
  'icon-192.png': 'midniht-mark-192.png',
  'icon-512.png': 'midniht-mark-512.png',
  'icon-maskable-512.png': 'midniht-maskable-512.png',
  'apple-touch-icon.png': 'midniht-mark-180.png',
  'midniht/midniht-mark.svg': 'midniht-mark.svg',
  'midniht/midniht-mark-192.png': 'midniht-mark-192.png',
  'midniht/midniht-mark-512.png': 'midniht-mark-512.png',
  'midniht/midniht-share-1200x630.png': 'midniht-share-1200x630.png',
  // Retain the previously published share URL for already-shared links.
  'reverie-next-read-share.png': 'midniht-share-1200x630.png',
}

const hashes = {}
for (const [destination, source] of Object.entries(assets)) {
  const bytes = await readFile(join(sourceDir, source))
  await mkdir(dirname(join(publicDir, destination)), { recursive: true })
  await writeFile(join(publicDir, destination), bytes)
  hashes[destination] = createHash('sha256').update(bytes).digest('hex')
}
await writeFile(
  join(publicDir, 'brand-assets.generated.json'),
  JSON.stringify(
    { source: 'design/midniht/brand-kit', files: Object.keys(assets), sha256: hashes },
    null,
    2,
  ) + '\n',
)
