import { main } from './benchmark-metadata.mjs'

main(process.argv.slice(2), console.log, 'subscription-value').catch(() => {
  console.error(
    'Subscription-value trial stopped. Check arguments, reviewed frame, and local credentials; details are redacted.',
  )
  process.exitCode = 1
})
