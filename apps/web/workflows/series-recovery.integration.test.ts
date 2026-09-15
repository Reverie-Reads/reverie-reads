import { createServer, type Server } from 'node:http'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { start } from 'workflow/api'
import { durableSeriesRecovery } from './series-recovery'

const RUN_ID = 'b0000000-0000-4000-8000-000000000099'
const requests: string[] = []
let server: Server
let previousSupabaseUrl: string | undefined
let previousServiceRoleKey: string | undefined

function closeServer(): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((error) => (error ? reject(error) : resolve()))
  })
}

describe('durable series recovery Workflow composition', () => {
  beforeAll(async () => {
    server = createServer((request, response) => {
      const path = new URL(request.url ?? '/', 'http://workflow.test').pathname
      requests.push(path)
      response.setHeader('content-type', 'application/json')
      if (path === '/rest/v1/rpc/service_claim_series_recovery_batch') {
        response.end('[]')
        return
      }
      if (path === '/rest/v1/rpc/service_finish_corpus_sweep') {
        response.end(JSON.stringify(RUN_ID))
        return
      }
      response.statusCode = 404
      response.end(JSON.stringify({ message: `Unexpected test request: ${path}` }))
    })
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve))
    const address = server.address()
    if (!address || typeof address === 'string')
      throw new Error('Workflow test server did not bind')
    previousSupabaseUrl = process.env.SUPABASE_URL
    previousServiceRoleKey = process.env.SUPABASE_SERVICE_ROLE_KEY
    process.env.SUPABASE_URL = `http://127.0.0.1:${address.port}`
    process.env.SUPABASE_SERVICE_ROLE_KEY = 'workflow-integration-test-service-role'
  })

  afterAll(async () => {
    if (previousSupabaseUrl === undefined) delete process.env.SUPABASE_URL
    else process.env.SUPABASE_URL = previousSupabaseUrl
    if (previousServiceRoleKey === undefined) delete process.env.SUPABASE_SERVICE_ROLE_KEY
    else process.env.SUPABASE_SERVICE_ROLE_KEY = previousServiceRoleKey
    await closeServer()
  })

  it('crosses the empty-run durable claim and finish boundaries', async () => {
    const workflowEntrypoint = durableSeriesRecovery as typeof durableSeriesRecovery & {
      workflowId: string
    }
    workflowEntrypoint.workflowId =
      'workflow//./apps/web/workflows/series-recovery//durableSeriesRecovery'
    const run = await start(workflowEntrypoint, [RUN_ID])

    await expect(run.returnValue).resolves.toEqual({ runId: RUN_ID })
    expect(requests).toEqual([
      '/rest/v1/rpc/service_claim_series_recovery_batch',
      '/rest/v1/rpc/service_finish_corpus_sweep',
    ])
  })
})
