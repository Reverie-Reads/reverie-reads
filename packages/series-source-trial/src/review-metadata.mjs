import { main } from './benchmark-metadata.mjs'

main(process.argv.slice(2), console.log, 'page-review').catch(() => {
  console.error(
    'Metadata page review stopped. Check arguments, local input, and credential-file access; details are redacted.',
  )
  process.exitCode = 1
})
