#!/usr/bin/env node
// Inspect the artifact that ships, including Nitro's HTML renderer. The browser-test build omits
// Nitro/Workflow and cannot detect a root-level index.js shadowing the production document.
import assert from 'node:assert/strict'
import { existsSync, readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { pathToFileURL, fileURLToPath } from 'node:url'

const web = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const vercel = Boolean(process.env.VERCEL)
const output = join(web, vercel ? '.vercel/output' : '.output')
const publicDir = join(output, vercel ? 'static' : 'public')
const serverDir = join(output, vercel ? 'functions/__server.func' : 'server')

assert.ok(existsSync(publicDir), 'Production public artifact is missing')
for (const name of ['index.js', 'index.mjs', 'index.cjs']) {
  assert.ok(
    !existsSync(join(publicDir, name)),
    `Production / can serve ${name} instead of HTML; keep client entries under assets/`,
  )
}

function* files(dir) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name)
    if (entry.isDirectory()) yield* files(path)
    else if (entry.isFile()) yield path
  }
}
const templates = [...files(serverDir)].filter((path) => path.endsWith('/renderer-template.mjs'))
assert.equal(templates.length, 1, 'Production must have exactly one SPA document renderer')

// This guard cannot contact a provider, database or workflow service. Unexpected network work
// during module initialization or these deliberately invalid/HTML reads fails the build.
const originalFetch = globalThis.fetch
const unexpectedFetch = []
globalThis.fetch = (...args) => {
  unexpectedFetch.push(String(args[0]))
  throw new Error('Production document verification must not make network requests')
}
try {
  const { default: render } = await import(pathToFileURL(templates[0]).href)
  const document = await render({ req: new Request('https://build.invalid/') })
  assert.match(document.headers.get('content-type') ?? '', /^text\/html\b/)
  assert.equal(typeof document.body, 'string', 'Production renderer must return HTML text')
  const html = document.body
  assert.match(html, /^\s*<!doctype html>/i)
  const modules = [...html.matchAll(/<script\b(?=[^>]*\btype="module")[^>]*\bsrc="([^"]+)"/g)].map(
    (match) => match[1],
  )
  assert.ok(modules.length, 'Production document has no client module entry')
  for (const src of modules) {
    assert.match(src, /^\/assets\/[a-zA-Z0-9_-]+\.js$/, 'Client modules must be local assets')
    assert.ok(!src.includes('test-appearance'), 'Browser-test entry leaked into production')
    const body = readFileSync(join(publicDir, src.slice(1)), 'utf8')
    assert.ok(body.trim().length > 0, `Missing client module: ${src}`)
    assert.doesNotMatch(body, /^\s*<!doctype html>/i, `Client module is HTML: ${src}`)
  }
  if (vercel) {
    const config = JSON.parse(readFileSync(join(output, 'config.json'), 'utf8'))
    assert.ok(config.routes.some((route) => route.handle === 'filesystem'))
    assert.ok(config.routes.some((route) => route.src === '/(.*)' && route.dest === '/__server'))
    const { default: server } = await import(pathToFileURL(join(serverDir, 'index.mjs')).href)
    for (const path of ['/', '/auth', '/library']) {
      const response = await server.fetch(new Request(`https://build.invalid${path}`))
      assert.equal(response.status, 200, `Production document status: ${path}`)
      assert.match(response.headers.get('content-type') ?? '', /^text\/html\b/, path)
      assert.match(await response.text(), /^\s*<!doctype html>/i, path)
    }
    // Invalid query validation must stay on the API route, rather than fall through to SPA HTML.
    const response = await server.fetch(
      new Request('https://build.invalid/api/bookstores?lat=invalid'),
    )
    assert.equal(response.status, 400, 'Production API route did not reject an invalid query')
    assert.doesNotMatch(response.headers.get('content-type') ?? '', /^text\/html\b/)
  }
  assert.equal(unexpectedFetch.length, 0, 'Production document verification attempted network work')
  console.log(
    `Production document verified (${vercel ? 'Vercel' : 'Node'}): HTML renderer, client assets${vercel ? ', app/API routing' : ''}`,
  )
} finally {
  globalThis.fetch = originalFetch
}
