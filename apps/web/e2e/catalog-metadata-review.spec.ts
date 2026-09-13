import { configureReturningReader } from './support/readerGuidance'
import { randomUUID } from 'node:crypto'
import { createClient } from '@supabase/supabase-js'
import AxeBuilder from '@axe-core/playwright'
import { SKIN_LIST } from '@reverie/core'
import { expect, test, type Page } from './support/fixtures'
import { keepOfflineCacheEmpty } from './support/offlineCache'
import { ok, okUser } from './support/ok'

const URL = 'http://127.0.0.1:55321'
const ANON =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0'
const SERVICE =
  'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU'
async function setup(page: Page, isAdmin = true) {
  const admin = createClient(URL, SERVICE, {
    auth: { persistSession: false, autoRefreshToken: false },
  })
  const email = `metadata-${randomUUID()}@reverie.local`
  const password = 'MetadataReview-Local-9362'
  const user = await okUser(
    admin.auth.admin.createUser({ email, password, email_confirm: true }),
    'metadata review user',
  )
  if (isAdmin)
    await ok(admin.from('corpus_admins').insert({ user_id: user.id }), 'administrator grant')
  const workId = randomUUID(),
    peerId = randomUUID(),
    bookId = randomUUID()
  const title = `Metadata review ${workId.slice(0, 8)}`
  const base = {
    title,
    author_text: 'Test Writer',
    contributors: [{ name: 'Test Writer', role: 'author' }],
  }
  await ok(
    admin
      .from('works')
      .insert({ ...base, id: workId, work_key: `${title.toLowerCase()}|test writer` }),
    'catalog fixture',
  )
  await ok(
    admin.from('books').insert({
      id: bookId,
      owner_id: user.id,
      corpus_work_id: workId,
      title,
      authors_display: 'Test Writer',
      ownership: 'unowned',
    }),
    'personal fixture',
  )
  await ok(
    admin.from('works').insert({
      ...base,
      id: peerId,
      work_key: `legacy-${peerId}`,
      description: 'An existing description for a possible duplicate.',
      publisher: 'Example Press',
    }),
    'related fixture',
  )
  const sb = createClient(URL, ANON, { auth: { persistSession: false, autoRefreshToken: false } })
  const auth = await sb.auth.signInWithPassword({ email, password })
  if (auth.error || !auth.data.session) throw auth.error ?? new Error('No local session')
  await keepOfflineCacheEmpty(page)
  const { access_token, refresh_token } = auth.data.session
  await configureReturningReader(access_token)
  await page.goto(
    `/#access_token=${access_token}&refresh_token=${refresh_token}&expires_in=3600&token_type=bearer&type=magiclink`,
  )
  await page.getByRole('button', { name: /enter your library/i }).click({ timeout: 20000 })
  await expect(page.getByRole('main')).toBeVisible({ timeout: 20000 })
  return {
    admin,
    user,
    workId,
    peerId,
    bookId,
    title,
    cleanup: async () => {
      await ok(
        admin.from('corpus_metadata_review_events').delete().in('work_id', [workId, peerId]),
        'events cleanup',
      )
      await ok(
        admin.from('work_metadata_edits').delete().in('work_id', [workId, peerId]),
        'edits cleanup',
      )
      await ok(admin.from('books').delete().eq('id', bookId), 'personal cleanup')
      await ok(admin.from('works').delete().in('id', [workId, peerId]), 'works cleanup')
      const result = await admin.auth.admin.deleteUser(user.id)
      if (result.error) throw result.error
    },
  }
}

test('metadata review saves a sourced description, keeps identity concerns, and preserves personal data', async ({
  page,
}) => {
  const c = await setup(page)
  try {
    const before = await ok(
      c.admin.from('books').select('*').eq('id', c.bookId).single(),
      'personal baseline',
    )
    await page.goto('/settings')
    await page.getByRole('link', { name: 'Review catalog metadata' }).click()
    await page.getByLabel('Find a catalog book').fill(c.title)
    await page.getByRole('button', { name: 'Search catalog' }).click()
    await page.getByLabel('Metadata concern').selectOption('description')
    await page
      .getByRole('list', { name: 'Catalog metadata review queue' })
      .getByRole('link')
      .click()
    await expect(page.getByRole('heading', { name: 'Compare related records' })).toBeVisible()
    await expect(page.getByText('An existing description for a possible duplicate.')).toBeVisible()
    await page
      .getByLabel('Catalog description')
      .fill('A reader follows a forgotten atlas to a hidden library.')
    await expect(page.getByRole('button', { name: 'Save description', exact: true })).toBeDisabled()
    await page.getByLabel('Evidence source link').fill('https://publisher.example/book')
    await page
      .getByLabel('Assessment note')
      .fill('Checked the publisher title and author; summary written in my own words.')
    await page.getByRole('checkbox', { name: /I checked the title/ }).check()
    await expect(page.getByRole('button', { name: 'Record assessment' })).toBeDisabled()
    await page.getByRole('button', { name: 'Save description', exact: true }).click()
    await expect(page.getByRole('status')).toContainText('Description corrected')
    await expect(page.getByRole('list', { name: 'Metadata concerns' })).toContainText(
      'Same title and author',
    )
    await page.reload()
    await expect(page.getByLabel('Catalog description')).toHaveValue(
      'A reader follows a forgotten atlas to a hidden library.',
    )
    await expect(page.getByRole('link', { name: 'Open recorded source' }).first()).toHaveAttribute(
      'href',
      'https://publisher.example/book',
    )
    await expect(page.getByText('Description corrected', { exact: true })).toBeVisible()
    expect(
      await ok(c.admin.from('books').select('*').eq('id', c.bookId).single(), 'personal after'),
    ).toEqual(before)
    await page.getByRole('button', { name: 'Set aside for later' }).click()
    await expect(page.getByRole('status')).toContainText('Set aside for later')
    await page.reload()
    await expect(page.getByRole('button', { name: 'Reopen review' })).toBeVisible()
    await page.getByRole('link', { name: 'Back to metadata queue' }).click()
    await page.getByLabel('Metadata concern').selectOption('all')
    await page.getByRole('combobox', { name: 'Review queue', exact: true }).selectOption('deferred')
    await expect(
      page.getByRole('list', { name: 'Catalog metadata review queue' }).getByRole('link'),
    ).toHaveCount(1)
  } finally {
    await c.cleanup()
  }
})

test('a stale metadata draft is refused and can be reloaded without overwriting newer evidence', async ({
  page,
}) => {
  const c = await setup(page)
  try {
    await page.goto(`/catalog/metadata?work=${c.workId}`)
    await expect(page.getByLabel('Catalog description')).toBeVisible()
    await page.getByLabel('Catalog description').fill('My unsaved description.')
    await page.getByLabel('Evidence source link').fill('https://publisher.example/book')
    await page.getByLabel('Assessment note').fill('Reviewed edition evidence.')
    await page.getByRole('checkbox', { name: /I checked the title/ }).check()
    await ok(
      c.admin
        .from('works')
        .update({ description: 'A newer checked description.' })
        .eq('id', c.workId),
      'concurrent edit',
    )
    await page.getByRole('button', { name: 'Save description', exact: true }).click()
    await expect(page.getByRole('article').getByRole('alert')).toContainText(
      'This catalog record or review changed.',
    )
    await expect(page.getByLabel('Catalog description')).toHaveValue('My unsaved description.')
    await page.getByRole('button', { name: 'Reload current record' }).click()
    await expect(page.getByLabel('Catalog description')).toHaveValue('A newer checked description.')
    expect(
      (
        await ok(
          c.admin.from('corpus_metadata_review_events').select('id').eq('work_id', c.workId),
          'failed action history',
        )
      ).length,
    ).toBe(0)
  } finally {
    await c.cleanup()
  }
})

test('ordinary readers cannot open metadata review', async ({ page }) => {
  const c = await setup(page, false)
  try {
    await page.goto('/catalog/metadata')
    await expect(
      page.getByText('This workspace is available to catalog administrators.'),
    ).toBeVisible()
    await expect(page.getByRole('button', { name: 'Search catalog' })).toHaveCount(0)
  } finally {
    await c.cleanup()
  }
})

async function editionDraft(
  page: Page,
  title: string,
  field: 'pages' | 'publication',
  value: string,
) {
  await page.getByLabel('Reference edition ISBN').selectOption('9780306406157')
  await page.getByLabel('Title shown by the edition source', { exact: true }).fill(title)
  await page.getByLabel('Full contributor names shown by the edition source').fill('Test Writer')
  await page.getByLabel('Field to correct').selectOption(field)
  await page
    .getByLabel(field === 'pages' ? 'Proposed page count' : 'Proposed publication date')
    .fill(value)
  await page.getByLabel('Edition evidence link').fill('https://publisher.example/exact-edition')
  await page
    .getByLabel('Edition correction explanation')
    .fill('Checked this reference edition; keep all other fields unchanged.')
  await page.getByRole('button', { name: 'Preview edition correction' }).click()
}

test('edition correction previews a whole date, persists after refresh and protects personal copies', async ({
  page,
}) => {
  const c = await setup(page)
  try {
    await ok(
      c.admin
        .from('works')
        .update({ isbns: ['9780306406157'], pages: 321, pub_y: 2025, pub_m: 2, pub_d: 29 })
        .eq('id', c.workId),
      'edition baseline',
    )
    const before = await ok(
      c.admin.from('books').select('*').eq('id', c.bookId).single(),
      'personal baseline',
    )
    await page.goto(`/catalog/metadata?work=${c.workId}`)
    await editionDraft(page, c.title, 'publication', '2025-02-29')
    await expect(
      page.getByRole('region', { name: 'Edition correction' }).getByRole('alert'),
    ).toContainText('Use a valid')
    await page.getByLabel('Proposed publication date').fill('2024-02')
    await page.getByRole('button', { name: 'Preview edition correction' }).click()
    await expect(page.getByText('Publication: 2025-02-29 → 2024-02', { exact: true })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply edition correction' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Set aside for later' })).toBeDisabled()
    await page.getByRole('checkbox', { name: /I checked this edition/ }).check()
    await page.getByRole('button', { name: 'Apply edition correction' }).click()
    await expect(page.getByRole('status')).toContainText('Edition details corrected')
    await page.reload()
    await expect(
      page.getByText('Current pages: 321 · Publication: 2024-02', { exact: true }),
    ).toBeVisible()
    await expect(page.getByText(/Publication at review: 2024-02/)).toBeVisible()
    const afterDate = await ok(
      c.admin
        .from('works')
        .select('pages,pub_y,pub_m,pub_d,metadata_provenance')
        .eq('id', c.workId)
        .single(),
      'saved date',
    )
    expect(afterDate).toMatchObject({ pages: 321, pub_y: 2024, pub_m: 2, pub_d: null })
    expect(afterDate.metadata_provenance.pubM.referenceIsbn).toBe('9780306406157')
    expect(afterDate.metadata_provenance.pubD).toBeUndefined()
    await editionDraft(page, c.title, 'pages', '456')
    await page.getByRole('checkbox', { name: /I checked this edition/ }).check()
    let requests = 0
    await page.route('**/rest/v1/rpc/admin_correct_corpus_edition_details', async (route) => {
      requests++
      await route.continue()
    })
    await page.getByRole('button', { name: 'Apply edition correction' }).dblclick()
    await expect(page.getByRole('status')).toContainText('Edition details corrected')
    await page.reload()
    await expect(
      page.getByText('Current pages: 456 · Publication: 2024-02', { exact: true }),
    ).toBeVisible()
    expect(requests).toBe(1)
    expect(
      await ok(
        c.admin.from('books').select('*').eq('id', c.bookId).single(),
        'personal after both corrections',
      ),
    ).toEqual(before)
    const events = await ok(
      c.admin.from('corpus_metadata_review_events').select('action').eq('work_id', c.workId),
      'saved history',
    )
    expect(events).toEqual([{ action: 'edition_details' }, { action: 'edition_details' }])
    await page.screenshot({
      path: test.info().outputPath('edition-correction.png'),
      fullPage: true,
    })
  } finally {
    await c.cleanup()
  }
})

test('stale edition correction keeps the draft and requires reload rather than retry', async ({
  page,
}) => {
  const c = await setup(page)
  try {
    await ok(
      c.admin
        .from('works')
        .update({ isbns: ['9780306406157'], pages: 321, pub_y: 2025, pub_m: 2, pub_d: 2 })
        .eq('id', c.workId),
      'edition baseline',
    )
    await page.goto(`/catalog/metadata?work=${c.workId}`)
    await editionDraft(page, c.title, 'pages', '456')
    await page.getByRole('checkbox', { name: /I checked this edition/ }).check()
    await ok(
      c.admin.from('works').update({ pub_d: 3 }).eq('id', c.workId),
      'concurrent date-only edit',
    )
    await page.getByRole('button', { name: 'Apply edition correction' }).click()
    await expect(
      page.getByRole('region', { name: 'Edition correction' }).getByRole('alert'),
    ).toContainText('This catalog record or review changed.')
    await expect(page.getByLabel('Proposed page count')).toHaveValue('456')
    await expect(page.getByRole('button', { name: 'Apply edition correction' })).toBeDisabled()
    expect(
      await ok(
        c.admin.from('corpus_metadata_review_events').select('id').eq('work_id', c.workId),
        'failed history',
      ),
    ).toEqual([])
    await page.getByRole('button', { name: 'Reload current record' }).click()
    await expect(
      page.getByText('Current pages: 321 · Publication: 2025-02-03', { exact: true }),
    ).toBeVisible()
    await expect(page.getByLabel('Proposed page count')).toHaveValue('')
  } finally {
    await c.cleanup()
  }
})

test('an uncertain edition correction response never triggers an automatic or second submission', async ({
  page,
}) => {
  const c = await setup(page)
  try {
    await ok(
      c.admin
        .from('works')
        .update({ isbns: ['9780306406157'], pages: 321 })
        .eq('id', c.workId),
      'edition baseline',
    )
    await page.goto(`/catalog/metadata?work=${c.workId}`)
    await editionDraft(page, c.title, 'pages', '456')
    await page.getByRole('checkbox', { name: /I checked this edition/ }).check()
    let requests = 0
    await page.route('**/rest/v1/rpc/admin_correct_corpus_edition_details', async (route) => {
      requests++
      await route.abort('failed')
    })
    await page.getByRole('button', { name: 'Apply edition correction' }).click()
    await expect(page.getByText('Do not repeat an uncertain save.', { exact: false })).toBeVisible()
    await expect(page.getByRole('button', { name: 'Apply edition correction' })).toBeDisabled()
    await expect(page.getByRole('button', { name: 'Discard edition draft' })).toBeDisabled()
    expect(requests).toBe(1)
    expect(
      await ok(
        c.admin.from('corpus_metadata_review_events').select('id').eq('work_id', c.workId),
        'aborted history',
      ),
    ).toEqual([])
  } finally {
    await c.cleanup()
  }
})

test('metadata comparison and text entry fit a phone in every reading room', async ({ page }) => {
  test.setTimeout(180000)
  await page.setViewportSize({ width: 390, height: 844 })
  const c = await setup(page)
  try {
    await ok(
      c.admin
        .from('works')
        .update({ isbns: ['9780306406157'], pages: 321, pub_y: 2024 })
        .eq('id', c.workId),
      'phone edition baseline',
    )
    await page.goto(`/catalog/metadata?work=${c.workId}`)
    await expect(page.getByLabel('Catalog description')).toBeVisible()
    await editionDraft(page, c.title, 'pages', '456')
    await expect(page.getByText('Pages: 321 → 456', { exact: true })).toBeVisible()
    for (const skin of SKIN_LIST)
      for (const mode of ['light', 'dark']) {
        await page.evaluate(
          ({ skin, mode }) => {
            document.documentElement.dataset.skin = skin
            document.documentElement.dataset.mode = mode
          },
          { skin: skin.id, mode },
        )
        expect(
          (
            await new AxeBuilder({ page })
              .include('main')
              .withTags(['wcag2a', 'wcag2aa', 'wcag21aa'])
              .analyze()
          ).violations,
          `${skin.id}/${mode}`,
        ).toEqual([])
        expect(
          await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
          `${skin.id}/${mode} overflow`,
        ).toBe(true)
        expect(
          await page
            .getByLabel('Catalog description')
            .evaluate((el) => parseFloat(getComputedStyle(el).fontSize)),
        ).toBeGreaterThanOrEqual(16)
      }
    await page
      .getByRole('region', { name: 'Edition correction' })
      .screenshot({ path: test.info().outputPath('edition-correction-mobile.png') })
  } finally {
    await c.cleanup()
  }
})
