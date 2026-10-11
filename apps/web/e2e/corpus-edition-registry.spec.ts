import { randomInt, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { expect, test, type Page } from './support/fixtures'
import { configureReturningReader } from './support/readerGuidance'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'
const URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
function isbn() {
  const s = `978${String(randomInt(1_000_000_000)).padStart(9, '0')}`
  return s + ((10 - ([...s].reduce((n, d, i) => n + Number(d) * (i % 2 ? 3 : 1), 0) % 10)) % 10)
}
async function fixture(page: Page) {
  // The fixture tests persistence and UI, not live provider metadata or paid acquisition.
  for (const endpoint of ['search', 'enrich', 'embed', 'releases', 'covers', 'series']) {
    await page.route(`**/functions/v1/${endpoint}**`, (route) => route.fulfill({ json: {} }))
  }
  await page.route('**/books/v1/volumes**', (route) => route.fulfill({ json: { items: [] } }))
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `edition-${randomUUID()}@reverie.local`,
    password = 'Local-Registry-9131'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'registry reader',
  )
  const work = randomUUID(),
    book = randomUUID(),
    reference = isbn(),
    title = `Registry ${work.slice(0, 8)}`
  await ok(admin.from('corpus_admins').insert({ user_id: user.id }), 'registry administrator')
  await ok(
    admin.from('works').insert({
      id: work,
      title,
      author_text: 'Test Writer',
      work_key: title.toLowerCase(),
      isbns: [reference],
      description: 'Bibliographic test fixture.',
    }),
    'shared work',
  )
  await ok(
    admin.from('books').insert({
      id: book,
      owner_id: user.id,
      corpus_work_id: work,
      title,
      authors_display: 'Test Writer',
      isbn: reference,
      ownership: 'owned',
      intensity: null,
      darkness: 0,
      pages: 100,
    }),
    'personal book',
  )
  const client = createClient(URL, ANON, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const auth = await client.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('Missing session')
  const { access_token, refresh_token } = auth.data.session
  await configureReturningReader(access_token)
  await keepOfflineCacheEmpty(page)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click()
  await expect(page.getByRole('main')).toBeVisible()
  return {
    admin,
    client,
    user,
    work,
    book,
    reference,
    title,
    cleanup: async () => {
      // Local-only fixture cleanup. Audit tables deliberately have no API writer, including service.
      execFileSync(
        'docker',
        [
          'exec',
          '-i',
          'supabase_db_book-corpus',
          'psql',
          '-U',
          'postgres',
          '-d',
          'postgres',
          '-v',
          'ON_ERROR_STOP=1',
          '-v',
          `work=${work}`,
        ],
        {
          input: "delete from public.corpus_record_edits where work_id=:'work'::uuid;\n",
          stdio: ['pipe', 'pipe', 'pipe'],
        },
      )
      await ok(admin.from('work_metadata_edits').delete().eq('work_id', work), 'audit cleanup')
      await ok(admin.from('books').delete().eq('id', book), 'book cleanup')
      await ok(admin.from('works').delete().eq('id', work), 'work cleanup')
      const r = await admin.auth.admin.deleteUser(user.id)
      if (r.error) throw r.error
    },
  }
}
async function evidence(page: Page) {
  await page
    .getByRole('textbox', { name: 'Evidence link', exact: true })
    .fill('https://publisher.example/edition')
  await page
    .getByRole('textbox', { name: 'Explanation', exact: true })
    .fill('Confirmed on this edition copyright page.')
  await page.getByRole('button', { name: 'Review change', exact: true }).click()
  await page
    .getByRole('checkbox', {
      name: 'I checked the work, exact edition and proposed changes against the evidence.',
    })
    .check()
  await page.getByRole('button', { name: 'Save shared change', exact: true }).click()
}

test('published edition and shared guidance persist; a personal override and ISBN report stay separate', async ({
  page,
}, info) => {
  const c = await fixture(page)
  try {
    await page.goto(`/catalog/metadata?state=all&issue=all&q=&page=0&work=${c.work}`)
    await page.getByRole('button', { name: 'Edit shared genres, guidance & editions' }).click()
    await page.getByRole('button', { name: `Edit edition ${c.reference}` }).click()
    // Every actual edition field is entered in the real form and read back from the real RPC.
    await page.getByRole('textbox', { name: 'Pages', exact: true }).fill('240')
    await page.getByRole('textbox', { name: /Published \(YYYY/ }).fill('2024-06')
    await page.getByRole('textbox', { name: 'Publisher', exact: true }).fill('Example Press')
    await page.getByRole('combobox', { name: 'Format', exact: true }).selectOption('paperback')
    await evidence(page)
    await expect
      .poll(
        async () =>
          (await ok(c.client.rpc('get_corpus_record', { p_work: c.work }), 'read edition'))
            .editions[0]?.reviewed,
      )
      .toBe(true)
    await page.reload()
    await page.getByRole('button', { name: 'Edit shared genres, guidance & editions' }).click()
    await expect(page.getByText('Example Press', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Edit shared guidance' }).click()
    await page
      .getByRole('textbox', { name: 'Genres, separated by commas', exact: true })
      .fill('fantasy, fiction')
    await page.getByRole('combobox', { name: 'Spice / sexual content' }).selectOption('2')
    await page.getByRole('combobox', { name: 'Darkness / emotional intensity' }).selectOption('4')
    await evidence(page)
    await expect
      .poll(
        async () =>
          (await ok(c.client.rpc('get_corpus_record', { p_work: c.work }), 'read guidance')).spice,
      )
      .toBe(2)
    const personal = await ok(
      c.admin.from('books').select('intensity,darkness,pages,isbn').eq('id', c.book).single(),
      'private values',
    )
    expect(personal).toEqual({ intensity: null, darkness: 0, pages: 100, isbn: c.reference })
    await page.goto(`/book/${c.book}`)
    await page.getByRole('button', { name: 'Shared catalog & published editions' }).click()
    await expect(page.getByText('Includes shared guidance', { exact: true })).toBeVisible()
    await page.getByRole('button', { name: 'Review this edition' }).click()
    const editionDialog = page.getByRole('dialog', { name: 'Review your edition' })
    await expect(editionDialog).toContainText('2024-06')
    await editionDialog.getByRole('button', { name: 'Use this edition' }).click()
    await expect(editionDialog).not.toBeVisible()
    const selected = await ok(
      c.admin
        .from('books')
        .select('pages,pub_y,pub_m,pub_d,darkness,intensity')
        .eq('id', c.book)
        .single(),
      'selected tuple',
    )
    expect(selected).toEqual({
      pages: 240,
      pub_y: 2024,
      pub_m: 6,
      pub_d: null,
      darkness: 0,
      intensity: null,
    })
    await page.getByRole('button', { name: 'Report an ISBN problem', exact: true }).click()
    const report = page.getByRole('dialog', { name: 'Report an ISBN problem' })
    await report
      .getByRole('textbox', { name: 'What needs checking?' })
      .fill('Please verify the binding against the publisher record.')
    await report.getByRole('button', { name: 'Review report' }).click()
    expect(
      (await ok(c.client.rpc('get_corpus_record', { p_work: c.work }), 'before report')).reports,
    ).toHaveLength(0)
    await report.getByRole('button', { name: 'Send ISBN report' }).click()
    await expect(report).not.toBeVisible()
    await page.reload()
    await page.getByRole('button', { name: 'Shared catalog & published editions' }).click()
    await expect(page.getByText('An ISBN concern is awaiting catalog review.')).toBeVisible()
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth > innerWidth + 1,
    )
    expect(overflow).toBe(false)
    expect((await new AxeBuilder({ page }).include('main').analyze()).violations).toEqual([])
    await page.screenshot({
      path: `/tmp/reverie-corpus-editions-${info.project.name}.png`,
      fullPage: true,
    })
    await page.goto(
      `/catalog/metadata?state=attention&issue=reader_report&q=&page=0&work=${c.work}`,
    )
    await page.getByRole('button', { name: 'Edit shared genres, guidance & editions' }).click()
    await expect(
      page.getByText('Please verify the binding against the publisher record.'),
    ).toBeVisible()
  } finally {
    await c.cleanup()
  }
})

test('an administrator reviews saved book details before pushing them and sees the persisted corpus update', async ({
  page,
}, info) => {
  await page.setViewportSize({ width: 320, height: 740 })
  const c = await fixture(page)
  try {
    await ok(
      c.admin
        .from('books')
        .update({ pages: 321, genre: 'fantasy', genres: ['fantasy'], intensity: 2 })
        .eq('id', c.book),
      'saved personal facts',
    )
    const protectedFields =
      'title,isbn,pages,intensity,darkness,ownership,borrowed,wishlist,copy_inventory,rating'
    const personal = await ok(
      c.admin.from('books').select(protectedFields).eq('id', c.book).single(),
      'personal snapshot',
    )
    const before = await ok(
      c.client.rpc('get_corpus_record', { p_work: c.work }),
      'shared snapshot',
    )
    await page.goto(`/book/${c.book}`)
    const timestamp = page.getByText(/^Corpus last updated:/).locator('time')
    await expect(timestamp).toBeVisible()
    const initialTime = await timestamp.getAttribute('datetime')
    await page.getByRole('button', { name: 'Push to corpus', exact: true }).click()
    const dialog = page.getByRole('dialog', { name: 'Push to corpus' })
    await dialog
      .getByRole('textbox', { name: 'Evidence link' })
      .fill('https://publisher.example/edition')
    await dialog
      .getByRole('textbox', { name: 'Explanation' })
      .fill('The copyright page confirms this published edition.')
    await dialog.getByRole('button', { name: 'Review corpus update' }).click()
    await expect(dialog.getByText('Proposed: 321', { exact: true })).toBeVisible()
    expect(
      (await ok(c.client.rpc('get_corpus_record', { p_work: c.work }), 'before confirmation'))
        .fingerprint,
    ).toBe(before.fingerprint)
    await expect(dialog.getByRole('button', { name: 'Confirm push to corpus' })).toBeDisabled()
    expect((await new AxeBuilder({ page }).include('dialog[open]').analyze()).violations).toEqual(
      [],
    )
    expect(await dialog.evaluate((el) => el.scrollWidth > el.clientWidth + 1)).toBe(false)
    await page.screenshot({
      path: `/tmp/reverie-corpus-push-${info.project.name}.png`,
      fullPage: true,
    })
    await dialog
      .getByRole('checkbox', {
        name: 'I verified these details and want to update the shared corpus.',
      })
      .check()
    await dialog.getByRole('button', { name: 'Confirm push to corpus' }).click()
    await expect(dialog).not.toBeVisible()
    await expect(page.getByRole('status').filter({ hasText: 'Corpus update saved.' })).toBeVisible()
    const after = await ok(
      c.client.rpc('get_corpus_record', { p_work: c.work }),
      'saved corpus edition',
    )
    expect(after.editions[0].details.pages).toBe(321)
    expect(after.history[0].action).toBe('edition')
    const savedTime = await ok(
      c.admin.from('works').select('updated_at').eq('id', c.work).single(),
      'saved update time',
    )
    expect(savedTime.updated_at).not.toBe(initialTime)
    await expect(timestamp).toHaveAttribute('datetime', savedTime.updated_at)
    await page.reload()
    await expect(timestamp).toHaveAttribute('datetime', savedTime.updated_at)
    await page.getByRole('button', { name: 'Push to corpus', exact: true }).click()
    await dialog.getByRole('radio', { name: 'Genres & content guidance' }).check()
    await dialog
      .getByRole('textbox', { name: 'Evidence link' })
      .fill('https://publisher.example/content')
    await dialog
      .getByRole('textbox', { name: 'Explanation' })
      .fill('Reviewed the book content for these shared defaults.')
    await dialog.getByRole('button', { name: 'Review corpus update' }).click()
    await dialog
      .getByRole('checkbox', {
        name: 'I verified these details and want to update the shared corpus.',
      })
      .check()
    await dialog.getByRole('button', { name: 'Confirm push to corpus' }).click()
    await expect(dialog).not.toBeVisible()
    const guidance = await ok(
      c.client.rpc('get_corpus_record', { p_work: c.work }),
      'saved corpus guidance',
    )
    expect(guidance).toMatchObject({ genre: 'fantasy', spice: 2, darkness: 0 })
    expect(
      await ok(
        c.admin.from('books').select(protectedFields).eq('id', c.book).single(),
        'protected personal snapshot',
      ),
    ).toEqual(personal)
  } finally {
    await c.cleanup()
  }
})
