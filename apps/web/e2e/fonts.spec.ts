import { expect, test, type Page } from './support/fixtures'

// Font loading, asserted against OUR mechanism — which, since feat/selfhost-webfonts, is entirely
// first-party: the boot script injects /fonts/<skin>.css (a static file this app ships), whose
// @font-face rules point at /fonts/files/*.woff2 (also shipped). No third party is in the path,
// which is why the suite-wide Google Fonts stub this file used to opt out of no longer exists.
//
// The two directions this file has always owned survive the move, re-aimed at the local path:
//   · SERVED — the app requests its skin stylesheet, the browser registers the family, real bytes
//     load (document.fonts.check goes true only once a REGISTERED face has its data), and the
//     intended stack lands on the element carrying the brand's voice. This is the direction the old
//     suite-wide stub could have silently masked: a broken /fonts/ path — a deploy that dropped
//     public/fonts, a renamed file, a bad rewrite — fails here, loudly, and nowhere else vacuously.
//   · DEAD — the stylesheet request fails (a broken deploy artifact is the local analogue of the
//     dead CDN). The app must degrade to the declared generic fallback: readable, never tofu.
//
// The all-nine-skins matrix stays in src/skin/fontConfig.test.ts (config drift, no browser);
// the subset/tofu contract stays in src/skin/fontSubsetContract.test.ts (shipped bytes, no browser).

const FONT_CSS_ROUTE = '**/fonts/*.css'

/** The landing brand is independent of the reader's selected room. */
const BRAND_DISPLAY = 'Newsreader'

const registeredFamilies = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...(document as Document & { fonts: FontFaceSet }).fonts].map((f) => f.family),
  )

/** The stylesheet links the app injects for its skin pairing (boot script + src/skin/fonts.ts). */
const skinFontHrefs = (page: Page): Promise<string[]> =>
  page.evaluate(() =>
    [...document.querySelectorAll('link[data-skin-font]')].map((l) => l.getAttribute('href') ?? ''),
  )

test('the app loads its self-hosted brand stylesheet, and the real face arrives', async ({
  page,
}) => {
  // No interception in this direction — the entire point is that the real, shipped files serve.
  await page.goto('/')
  const heading = page.getByTestId('landing-display-heading')
  await expect(heading).toBeVisible()

  // (a) OUR markup: the pre-paint boot script injected the active skin's pairing, pointing at the
  //     app's own /fonts path — never a third-party host.
  const hrefs = await skinFontHrefs(page)
  expect(
    hrefs.length,
    'no link[data-skin-font] — the boot script did not inject a pairing',
  ).toBeGreaterThan(0)
  expect(hrefs.every((h) => h.startsWith('/fonts/'))).toBe(true)
  await expect(page.locator('link[rel="stylesheet"][href="/fonts/brand.css"]')).toHaveCount(1)
  expect(hrefs.some((h) => h.includes('googleapis') || h.includes('gstatic'))).toBe(false)

  // (b) THE BROWSER acted on it: stylesheet parsed, family registered.
  await page.evaluate(() => (document as Document & { fonts: FontFaceSet }).fonts.ready)
  expect(await registeredFamilies(page)).toContain(BRAND_DISPLAY)

  // (c) REAL BYTES loaded — not just a parsed rule. For a REGISTERED face, `fonts.check()` is
  //     true only once its data is available, so this is the assertion that catches a stylesheet
  //     whose url() points at a woff2 that 404s. (The old CDN-era spec could not make this claim:
  //     it never let a real binary into the test. Locally the binary is ours, so its absence is a
  //     product defect and exactly what this spec exists to catch.)
  //
  // Probe the face the heading ACTUALLY renders, including weight and style. A bare
  // `16px 'Newsreader'` asks FontFaceSet for the default 400/normal face instead; when the page only
  // uses 600, that unused face correctly remains unloaded and the proxy reports false even though
  // the rendered face and its bytes are present.
  const renderedFace = await heading.evaluate((el) => {
    const style = getComputedStyle(el)
    return { fontStyle: style.fontStyle, fontWeight: style.fontWeight }
  })
  await expect
    .poll(
      () =>
        page.evaluate(
          ({ family, fontStyle, fontWeight }) =>
            document.fonts.check(`${fontStyle} ${fontWeight} 16px '${family}'`, 'Midniht'),
          { family: BRAND_DISPLAY, ...renderedFace },
        ),
      {
        message: `the rendered ${BRAND_DISPLAY} face never finished loading from /fonts/files/`,
      },
    )
    .toBe(true)

  // (d) …and the intended stack is applied to the element that carries the brand's voice.
  const stack = await heading.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(stack).toContain(BRAND_DISPLAY)
  const italic = await page.evaluate(() => ({
    registered: [...document.fonts].some(
      (face) => face.family === 'Newsreader' && face.style === 'italic',
    ),
    loaded: document.fonts.check("italic 500 60px 'Newsreader'", 'own library'),
  }))
  expect(italic).toEqual({ registered: true, loaded: true })
})

test('a dead font path degrades to the declared fallback — readable, never tofu', async ({
  page,
}) => {
  // The local analogue of the dead CDN: the deploy artifact lost its stylesheet.
  await page.route(FONT_CSS_ROUTE, (route) => route.abort())
  await page.goto('/')

  // The page still renders. Fonts are a decoration, not a dependency — that contract does not
  // weaken just because the files moved in-house.
  const heading = page.getByTestId('landing-display-heading')
  await expect(heading).toBeVisible()

  // The webfont genuinely did not arrive. Asserted on REGISTRATION, not `fonts.check()`: with the
  // stylesheet aborted no @font-face exists, the browser treats 'Newsreader' as an unknown system
  // family, and `check()` would return TRUE (nothing to load). The registered-face set has no such
  // ambiguity. (Measured in this spec's CDN era: the check() form passed for the wrong reason.)
  await page.evaluate(() =>
    (document as Document & { fonts: FontFaceSet }).fonts.ready.catch(() => undefined),
  )
  expect(
    await registeredFamilies(page),
    'the font stylesheet was supposed to be blocked — no @font-face should have registered',
  ).not.toContain(BRAND_DISPLAY)

  // The declared fallback is still in the cascade (fontConfig.test.ts enforces a generic tail for
  // every skin), so the browser has something real to render with.
  const stack = await heading.evaluate((el) => getComputedStyle(el).fontFamily)
  expect(stack.toLowerCase()).toMatch(/serif|system-ui|georgia/)

  // Readable, not collapsed and not a row of tofu boxes: real laid-out text with real dimensions.
  const box = await heading.boundingBox()
  expect(box, 'the heading has no layout box at all').toBeTruthy()
  expect(box!.width).toBeGreaterThan(50)
  expect(box!.height).toBeGreaterThan(8)
  expect((await heading.textContent())?.trim().length ?? 0).toBeGreaterThan(0)
})
