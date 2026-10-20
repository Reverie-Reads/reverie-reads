import assert from 'node:assert/strict'
import { createServer } from 'node:http'
import test from 'node:test'
import { inspectLocalApi } from './local-stack-readiness.mjs'

async function serve(run, behavior = () => null) {
  const server = createServer((request, response) => {
    if (behavior(request, response)) return
    const missing = request.url.includes('intake_missing_probe_control')
    const privateBooks = request.url.includes('/books?')
    response.writeHead(missing ? 404 : privateBooks ? 401 : 200, {
      'content-type': 'application/json',
    })
    response.end(
      JSON.stringify(
        missing
          ? { code: 'PGRST205' }
          : privateBooks
            ? { code: '42501' }
            : request.url === '/rest/v1/'
              ? { swagger: '2.0' }
              : { name: 'GoTrue' },
      ),
    )
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  try {
    await run(`http://127.0.0.1:${server.address().port}`)
  } finally {
    server.closeAllConnections()
    await new Promise((resolve) => server.close(resolve))
  }
}

test('ready service responses and the negative missing-table control are both required', async () => {
  await serve(async (url) => assert.equal((await inspectLocalApi(url, 'local-demo')).allPass, true))
  await serve(
    async (url) => assert.equal((await inspectLocalApi(url, 'local-demo')).allPass, false),
    (req, res) => {
      if (!req.url.includes('intake_missing_probe_control')) return false
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('[]')
      return true
    },
  )
})
test('a proxy HTML success and a stalled API fail without retaining response bodies', async () => {
  await serve(
    async (url) => {
      const result = await inspectLocalApi(url, 'never-log-this-key')
      assert.equal(result.allPass, false)
      assert.equal(JSON.stringify(result).includes('never-log'), false)
    },
    (_, res) => {
      res.writeHead(200)
      res.end('<html>not API readiness</html>')
      return true
    },
  )
  await serve(
    async (url) => {
      const result = await inspectLocalApi(url, 'local-demo', 20)
      assert.equal(result.allPass, false)
      assert.ok(result.checks.every((check) => check.error === 'TimeoutError'))
    },
    () => true,
  )
})
test('remote, credential-bearing and malformed endpoints are refused', async () => {
  for (const url of [
    'https://example.org',
    'http://secret@localhost',
    'http://localhost/?token=x',
    'bad',
  ]) {
    await assert.rejects(inspectLocalApi(url, 'local-demo'), /endpoint/)
  }
})

test('a private-library access regression cannot be called readiness', async () => {
  await serve(
    async (url) => assert.equal((await inspectLocalApi(url, 'local-demo')).allPass, false),
    (req, res) => {
      if (!req.url.includes('/books?')) return false
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end('[]')
      return true
    },
  )
})
