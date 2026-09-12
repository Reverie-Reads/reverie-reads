import { configureReturningReader } from '../support/readerGuidance'
import { expect, test, type Page } from '../support/fixtures'
import { createClient } from '@supabase/supabase-js'
import { authFailure } from '../support/authError'
import { keepOfflineCacheEmpty } from '../support/offlineCache'
import { ok, okUser } from '../support/ok'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

/**
 * PASS 2 — the specific trigger case, measured rather than swept.
 *
 * The screenshot that started this showed, on a phone-width /shelves: a tab pill (TBR /
 * Collections) with a sliver of colour past its right edge, and a header row whose text was cut at
 * the START ("nce ›" with nothing before it). It was a zoomed crop, so neither is evidence.
 *
 * The broad sweep (visual-overflow.audit.ts) measures whole pages at scroll 0. Both elements here
 * sit BELOW the fold on a phone, and `left-escape`/`past-clipper` are geometric — they do not care
 * about scroll — but a screenshot does, and a screenshot is what turns "the numbers say it's fine"
 * into something a person can check. So this scrolls each element into view, measures IT, and
 * captures it.
 *
 * The skin choice is the screenshot's: dark with a red accent. marrow/dark is the closest match and
 * tryst/dark is the runner-up (its accent is rose), so both are measured rather than guessing which
 * one the crop came from.
 */

const SUPABASE_URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
const EMAIL = 'shelves-trigger-audit-e2e@reverie.local'
const PASSWORD = 'shelves-trigger-audit-password'

const OUT_DIR = join(
  dirname(fileURLToPath(import.meta.url)),
  '..',
  '..',
  'audit-output',
  'shelves-trigger',
)
const WIDTHS = [375, 390, 412] as const
const SKINS: [string, string][] = [
  ['marrow', 'dark'],
  ['tryst', 'dark'],
]

type Client = {
  sb: ReturnType<typeof createClient>
  admin: ReturnType<typeof createClient>
  session: { access_token: string; refresh_token: string }
  uid: string
}
let shared: Client | null = null
async function client(): Promise<Client> {
  if (shared) return shared
  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  })
  const { data } = await admin.auth.admin.listUsers({ perPage: 1000 })
  let uid = data?.users?.find((u) => u.email === EMAIL)?.id
  if (!uid)
    uid = (
      await okUser(
        admin.auth.admin.createUser({ email: EMAIL, password: PASSWORD, email_confirm: true }),
        'shelves-trigger createUser',
      )
    ).id
  await ok(
    admin
      .from('profiles')
      .upsert({ id: uid, display_name: 'Shelves Trigger', skin: 'marrow', mode: 'dark' }),
    'shelves-trigger profiles upsert',
  )
  const sb = createClient(SUPABASE_URL, ANON)
  const { data: s, error } = await sb.auth.signInWithPassword({ email: EMAIL, password: PASSWORD })
  if (error || !s.session) throw new Error(authFailure('shelves-trigger', EMAIL, error))
  shared = { sb, admin, session: s.session, uid: s.session.user.id }
  return shared
}

/**
 * Both shelf KINDS, so the tab pill actually has two tabs to render, and names long enough to make
 * a header row work for its living. A short name cannot reproduce a clipped header, so a short
 * fixture would produce a clean result that means nothing.
 */
async function seed(c: Client) {
  const { data: existing } = await c.sb.from('books').select('id').eq('owner_id', c.uid)
  const ids = ((existing as { id: string }[]) ?? []).map((b) => b.id)
  if (ids.length) {
    await ok(c.sb.from('list_items').delete().in('book_id', ids), 'trigger items delete')
    await ok(c.sb.from('books').delete().in('id', ids), 'trigger books delete')
  }
  await ok(c.sb.from('lists').delete().eq('owner_id', c.uid), 'trigger lists delete')

  const rows = Array.from({ length: 8 }, (_, i) => ({
    owner_id: c.uid,
    title: `Trigger Probe ${String(i + 1).padStart(2, '0')}`,
    author_first: 'Wilhelmina',
    author_last: 'Featherstonehaugh-Marchbanks',
    genre: 'romance',
    status: 'standalone',
    series: null,
    position: null,
    ownership: 'owned',
    borrowed: false,
    wishlist: false,
    read_status: 'Read',
  }))
  const { error } = await c.sb.from('books').insert(rows)
  if (error) throw new Error(`trigger seed failed: ${JSON.stringify(error)}`)

  for (const [name, kind, sort] of [
    ['A Shelf Whose Name Is Long Enough To Test A Header Row', 'collection', 1],
    ['Contemporary Small-Town Second-Chance Romance', 'collection', 2],
    ['To Be Read, Eventually And At Some Length', 'tbr', 3],
  ] as const)
    await ok(
      c.sb.from('lists').insert({ owner_id: c.uid, name, kind, sort_order: sort }),
      'trigger list insert',
    )
}

async function signIn(page: Page, session: { access_token: string; refresh_token: string }) {
  await keepOfflineCacheEmpty(page)
  await configureReturningReader(session.access_token)
  await page.goto(
    `/#access_token=${session.access_token}&refresh_token=${session.refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20_000 })
  await expect(page.getByRole('navigation', { name: 'Primary', exact: true })).toBeVisible({
    timeout: 20_000,
  })
}

/** Geometry for ONE element against the box that clips it — the same model the sweep uses. */
function measureSource(testId: string) {
  const el = document.querySelector<HTMLElement>(`[data-audit="${testId}"]`)
  if (!el) return null
  const scrolls = (o: string) => o === 'auto' || o === 'scroll'
  const clips = (o: string) => o === 'hidden' || o === 'clip'
  const r = el.getBoundingClientRect()
  let a: HTMLElement | null = el.parentElement
  let clipper = {
    left: 0,
    right: document.documentElement.clientWidth,
    tag: 'viewport',
    scrollable: false,
  }
  while (a && a !== document.documentElement) {
    const acs = getComputedStyle(a)
    if (scrolls(acs.overflowX) || clips(acs.overflowX)) {
      const ar = a.getBoundingClientRect()
      clipper = {
        left: ar.left,
        right: ar.right,
        tag:
          a.tagName.toLowerCase() +
          (typeof a.className === 'string'
            ? '.' + a.className.trim().split(/\s+/).slice(0, 3).join('.')
            : ''),
        scrollable: scrolls(acs.overflowX),
      }
      break
    }
    a = a.parentElement
  }
  const cs = getComputedStyle(el)
  return {
    text: (el.innerText ?? '').trim().replace(/\s+/g, ' ').slice(0, 80),
    rectLeft: Math.round(r.left),
    rectRight: Math.round(r.right),
    scrollWidth: el.scrollWidth,
    clientWidth: el.clientWidth,
    overflowX: cs.overflowX,
    textOverflow: cs.textOverflow,
    clipperLeft: Math.round(clipper.left),
    clipperRight: Math.round(clipper.right),
    clipperTag: clipper.tag,
    clipperScrollable: clipper.scrollable,
    pastRight: Math.round(r.right - clipper.right),
    beforeLeft: Math.round(clipper.left - r.left),
    selfOverflow: el.scrollWidth - el.clientWidth,
  }
}

test('pass 2 — /shelves tab pill and shelf header row at phone widths', async ({ page }) => {
  const c = await client()
  await seed(c)
  for (const p of ['search', 'enrich', 'embed', 'releases', 'series', 'covers'])
    await page.route(`**/functions/v1/${p}**`, (r) => r.fulfill({ json: {} }))
  await signIn(page, c.session)
  mkdirSync(OUT_DIR, { recursive: true })

  const lines: string[] = ['# Pass 2 — /shelves tab pill + shelf header row', '']

  for (const [skin, mode] of SKINS) {
    await ok(
      c.admin.from('profiles').update({ skin, mode }).eq('id', c.uid),
      'trigger profiles skin update',
    )
    for (const width of WIDTHS) {
      await page.setViewportSize({ width, height: 844 })
      await page.goto('/shelves')
      await page.waitForTimeout(1200)
      const applied = await page.evaluate(() => ({
        skin: document.documentElement.dataset.skin,
        mode: document.documentElement.dataset.mode,
      }))
      if (applied.skin !== skin || applied.mode !== mode)
        throw new Error(`pass2: asked ${skin}/${mode}, got ${applied.skin}/${applied.mode}`)

      // Tag the two elements the screenshot implicated, by ROLE rather than by class, so the tag
      // survives a restyle. The tab pill is the tablist wrapper; the header row is the first
      // section heading row with its trailing chevron.
      const tagged = await page.evaluate(() => {
        const out: Record<string, boolean> = {}
        document.querySelectorAll('[data-audit]').forEach((e) => e.removeAttribute('data-audit'))
        const tablist =
          document.querySelector('[role="tablist"]') ??
          Array.from(document.querySelectorAll('div')).find(
            (d) =>
              d.children.length >= 2 &&
              Array.from(d.children).every((ch) => ch.tagName === 'BUTTON') &&
              /tbr|collection/i.test(d.textContent ?? ''),
          ) ??
          null
        if (tablist) tablist.setAttribute('data-audit', 'tabpill')
        out.tabpill = !!tablist

        // A header row: a heading whose row ends in the "›" affordance.
        const header = Array.from(document.querySelectorAll<HTMLElement>('button, a, h2, h3')).find(
          (e) => /›/.test(e.textContent ?? ''),
        )
        if (header) header.setAttribute('data-audit', 'header')
        out.header = !!header
        return out
      })

      for (const which of ['tabpill', 'header'] as const) {
        if (!tagged[which]) {
          lines.push(`- **${skin}/${mode} @${width} — ${which}: NOT FOUND on the page**`)
          continue
        }
        await page
          .locator(`[data-audit="${which}"]`)
          .scrollIntoViewIfNeeded()
          .catch(() => {})
        await page.waitForTimeout(250)
        const m = await page.evaluate(measureSource, which)
        if (!m) {
          lines.push(`- **${skin}/${mode} @${width} — ${which}: vanished after scroll**`)
          continue
        }
        const bad =
          m.pastRight > 1 ||
          m.beforeLeft > 1 ||
          (m.selfOverflow > 1 && m.overflowX !== 'auto' && m.overflowX !== 'scroll')
        lines.push(
          `- ${bad ? '**FLAGGED**' : 'clean'} — ${skin}/${mode} @${width} · ${which} — “${m.text}”`,
          `  - box ${m.rectLeft}…${m.rectRight}; clipper <${m.clipperTag}> ${m.clipperLeft}…${m.clipperRight}` +
            `${m.clipperScrollable ? ' (scrollable)' : ''}`,
          `  - past right: ${m.pastRight}px · before left: ${m.beforeLeft}px · self-overflow: ${m.selfOverflow}px (overflow-x: ${m.overflowX}, text-overflow: ${m.textOverflow})`,
        )
        await page
          .locator(`[data-audit="${which}"]`)
          .screenshot({ path: join(OUT_DIR, `${which}--${skin}-${mode}-${width}.png`) })
          .catch(() => {})
      }
      await page.screenshot({ path: join(OUT_DIR, `page--${skin}-${mode}-${width}.png`) })
    }
  }

  await ok(
    c.admin.from('profiles').update({ skin: 'tryst', mode: 'dark' }).eq('id', c.uid),
    'trigger profiles restore',
  )
  writeFileSync(join(OUT_DIR, 'report.md'), lines.join('\n'))
  console.log(lines.join('\n'))
})
