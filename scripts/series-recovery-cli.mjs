// Separate entry point: tests import helpers without executing a run.
import { main } from './series-recovery.mjs'
main().catch((error) => {
  console.error(
    /^[a-z][a-z0-9_]+$/.test(error?.message) ? error.message : 'operation_failed_details_redacted',
  )
  process.exitCode = 1
})
