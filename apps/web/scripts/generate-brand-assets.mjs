import { readFile, writeFile } from 'node:fs/promises'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { chromium } from '@playwright/test'

const scriptDir = dirname(fileURLToPath(import.meta.url))
const publicDir = resolve(scriptDir, '../public')
const fontDir = join(publicDir, 'fonts/files')

const markPaths = `
  <path d="M14 22V6C11 3 6 3 2 4v16c4-1 9-1 12 2Zm0 0V6c3-3 8-3 12-2v16c-4-1-9-1-12 2Z" />
  <path d="M6 8c2-.1 3 .2 4 1M6 12c2-.1 3 .2 4 1M18 9c1-.8 2-1.1 4-1M18 13c1-.8 2-1.1 4-1" opacity=".58" stroke-width="1.35" />
`

function iconSvg(size, safeScale = 1) {
  const scale = 1.65 * safeScale
  const contentWidth = 28 * scale
  const contentHeight = 26 * scale
  const x = (64 - contentWidth) / 2
  const y = (64 - contentHeight) / 2
  return `
    <!doctype html>
    <html>
      <head><meta charset="utf-8" /><style>html, body { width: ${size}px; height: ${size}px; margin: 0; overflow: hidden; }</style></head>
      <body>
      <svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}" viewBox="0 0 64 64">
      <defs>
        <radialGradient id="light" cx="68%" cy="24%" r="76%">
          <stop offset="0" stop-color="#2a293d" />
          <stop offset=".64" stop-color="#151724" />
          <stop offset="1" stop-color="#10121c" />
        </radialGradient>
      </defs>
      <rect width="64" height="64" fill="url(#light)" />
      <circle cx="45" cy="15" r="18" fill="#d7bc88" opacity=".055" />
      <g transform="translate(${x} ${y}) scale(${scale})" fill="none" stroke="#d7bc88" stroke-width="1.85" stroke-linecap="round" stroke-linejoin="round">
        ${markPaths}
      </g>
      </svg>
      </body>
    </html>
  `
}

function dataFont(bytes) {
  return `data:font/woff2;base64,${bytes.toString('base64')}`
}

function brandMark(size = 40) {
  return `
    <svg aria-hidden="true" width="${size}" height="${size}" viewBox="0 0 28 26" fill="none" stroke="#d7bc88" stroke-width="1.55" stroke-linecap="round" stroke-linejoin="round">
      ${markPaths}
    </svg>
  `
}

function shareCard(newsreader, newsreaderItalic, hanken) {
  return `
    <!doctype html>
    <html>
      <head>
        <meta charset="utf-8" />
        <style>
          @font-face { font-family: Newsreader; src: url('${dataFont(newsreader)}') format('woff2'); font-style: normal; font-weight: 500; }
          @font-face { font-family: Newsreader; src: url('${dataFont(newsreaderItalic)}') format('woff2'); font-style: italic; font-weight: 500; }
          @font-face { font-family: Hanken; src: url('${dataFont(hanken)}') format('woff2'); font-style: normal; font-weight: 400 800; }
          * { box-sizing: border-box; }
          html, body { width: 1200px; height: 630px; margin: 0; overflow: hidden; }
          body {
            color: #f4ecdd;
            background:
              radial-gradient(ellipse at 80% 50%, rgba(192, 139, 72, .2), transparent 45%),
              radial-gradient(ellipse at 13% 5%, rgba(106, 103, 154, .24), transparent 58%),
              #10121c;
            font-family: Hanken, sans-serif;
          }
          .dust { position: absolute; width: 2px; height: 2px; border-radius: 50%; background: rgba(245, 227, 191, .42); }
          .brand { position: absolute; left: 48px; top: 34px; display: flex; align-items: center; gap: 12px; }
          .word { font: 500 27px/1 Newsreader, serif; letter-spacing: -.3px; }
          .copy { position: absolute; left: 48px; top: 126px; width: 520px; }
          .eyebrow { color: #d7bc88; font-size: 13px; font-weight: 700; letter-spacing: .2em; }
          h1 { margin: 20px 0 0; font: 500 62px/1.06 Newsreader, serif; letter-spacing: -.025em; text-wrap: balance; }
          h1 em { color: #d7bc88; font-family: Newsreader, serif; font-style: italic; }
          .lead { width: 465px; margin: 24px 0 0; color: #c2bbc7; font-size: 17px; line-height: 1.55; }
          .proof { display: flex; gap: 9px; margin-top: 28px; }
          .proof span { padding: 8px 11px; border: 1px solid rgba(215, 188, 136, .25); border-radius: 999px; color: #e8dfd0; font-size: 12px; }
          .window {
            position: absolute; right: 42px; top: 72px; width: 548px; height: 506px; padding: 45px 32px 28px;
            color: #302c37;
            background:
              radial-gradient(circle at 72% 12%, rgba(215, 188, 136, .22), transparent 28%),
              linear-gradient(145deg, #f8f1e7, #e8dfd0);
            border: 1px solid rgba(215, 188, 136, .65);
            border-radius: 260px 260px 34px 34px / 118px 118px 34px 34px;
            box-shadow: 0 28px 80px rgba(0, 0, 0, .4), inset 0 1px rgba(255,255,255,.7);
          }
          .roomline { display: flex; justify-content: space-between; padding-bottom: 18px; border-bottom: 1px solid rgba(48,44,55,.18); font-size: 13px; color: #675e68; }
          .roomline strong { color: #514351; font-weight: 650; }
          .library-title { margin-top: 24px; }
          .library-title small { display: block; color: #675e68; font-size: 10px; font-weight: 700; letter-spacing: .18em; text-transform: uppercase; }
          .library-title h2 { margin: 7px 0 0; font: 500 31px/1.05 Newsreader, serif; }
          .dock { display: grid; grid-template-columns: repeat(4, 1fr); gap: 5px; margin-top: 18px; padding: 5px; border: 1px solid rgba(48,44,55,.16); background: rgba(255,255,255,.34); }
          .dock span { padding: 9px 2px; text-align: center; font-size: 9px; font-weight: 700; letter-spacing: .05em; }
          .dock span:first-child { background: #514351; color: #f8f1e7; }
          .books { display: grid; grid-template-columns: 1fr 1fr; gap: 18px; margin-top: 20px; }
          .book { display: grid; grid-template-columns: 76px 1fr; gap: 12px; align-items: start; }
          .cover { height: 114px; padding: 10px 7px; display: flex; flex-direction: column; justify-content: space-between; border: 1px solid rgba(48,44,55,.2); box-shadow: 0 8px 18px rgba(48,44,55,.13); }
          .cover.one { background: linear-gradient(155deg, #70475c, #332533); color: #f7e8d5; }
          .cover.two { background: linear-gradient(155deg, #42596f, #1c2939); color: #ecf0f2; }
          .cover b { font: 500 13px/1.08 Newsreader, serif; }
          .cover i { font-size: 8px; font-style: normal; opacity: .75; }
          .book h3 { margin: 4px 0 0; font: 500 17px/1.15 Newsreader, serif; }
          .book p { margin: 6px 0 0; color: #675e68; font-size: 11px; line-height: 1.35; }
          .progress { height: 4px; margin-top: 12px; background: rgba(48,44,55,.12); }
          .progress span { display: block; width: 24%; height: 100%; background: #8b566c; }
          .invitation { position: absolute; left: 32px; right: 32px; bottom: 26px; display: flex; align-items: center; justify-content: space-between; padding-top: 16px; border-top: 1px solid rgba(48,44,55,.18); color: #675e68; font-size: 12px; }
          .invitation strong { color: #514351; }
        </style>
      </head>
      <body>
        <span class="dust" style="left:214px;top:136px"></span>
        <span class="dust" style="left:468px;top:92px"></span>
        <span class="dust" style="left:318px;top:534px"></span>
        <div class="brand">${brandMark(34)}<span class="word">Reverie</span></div>
        <main class="copy">
          <div class="eyebrow">A PERSONAL LIBRARY THAT FEELS LIKE HOME</div>
          <h1>Find your next read in your <em>own library.</em></h1>
          <p class="lead">Keep your books, your notes, and the way a story stays with you—then settle into the room that feels like yours.</p>
          <div class="proof"><span>Private by default</span><span>Nine reading rooms</span><span>Export anytime</span></div>
        </main>
        <section class="window" aria-label="A sample Reverie library">
          <div class="roomline"><span>Folio · Day</span><strong>Change the room ↓</strong></div>
          <div class="library-title"><small>Your guest library</small><h2>A little room to try</h2></div>
          <div class="dock"><span>LIBRARY</span><span>READING NOW</span><span>NEXT READ</span><span>JOURNAL</span></div>
          <div class="books">
            <article class="book"><div><div class="cover one"><b>Jane Eyre</b><i>CHARLOTTE BRONTË</i></div><div class="progress"><span></span></div></div><div><h3>Jane Eyre</h3><p>Charlotte Brontë</p><p>Reading · 24%</p></div></article>
            <article class="book"><div class="cover two"><b>The Left Hand of Darkness</b><i>URSULA K. LE GUIN</i></div><div><h3>The Left Hand of Darkness</h3><p>Ursula K. Le Guin</p><p>Borrowed · Audiobook</p></div></article>
          </div>
          <div class="invitation"><span>Open a book. Make it yours.</span><strong>Take the one-minute tour →</strong></div>
        </section>
      </body>
    </html>
  `
}

async function renderPage(browser, html, width, height, path) {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 })
  await page.setContent(html, { waitUntil: 'load' })
  await page.evaluate('document.fonts.ready')
  await page.screenshot({ path })
  await page.close()
}

const browser = await chromium.launch({ headless: true })
try {
  await renderPage(browser, iconSvg(192), 192, 192, join(publicDir, 'icon-192.png'))
  await renderPage(browser, iconSvg(512), 512, 512, join(publicDir, 'icon-512.png'))
  await renderPage(browser, iconSvg(512, 0.78), 512, 512, join(publicDir, 'icon-maskable-512.png'))
  await renderPage(browser, iconSvg(180), 180, 180, join(publicDir, 'apple-touch-icon.png'))

  const [newsreader, newsreaderItalic, hanken] = await Promise.all([
    readFile(join(fontDir, 'newsreader-v26-cY9AfjOCX1hbuyalUrK4397yjIJFJpc.woff2')),
    readFile(
      join(fontDir, 'newsreader-v26-cY9XfjOCX1hbuyalUrK439vogqCz_goCYw7oReyJFYYzbARA_n8.woff2'),
    ),
    readFile(join(fontDir, 'hankengrotesk-v12-ieVn2YZDLWuGJpnzaiwFXS9tYtpd59CxCis4.woff2')),
  ])
  await renderPage(
    browser,
    shareCard(newsreader, newsreaderItalic, hanken),
    1200,
    630,
    join(publicDir, 'reverie-next-read-share.png'),
  )
  await writeFile(
    join(publicDir, 'brand-assets.generated.json'),
    `${JSON.stringify(
      {
        generatedBy: 'apps/web/scripts/generate-brand-assets.mjs',
        palette: { midnight: '#10121c', brass: '#d7bc88', parchment: '#f1eadc' },
        sourceMark: 'favicon.svg',
        files: [
          'icon-192.png',
          'icon-512.png',
          'icon-maskable-512.png',
          'apple-touch-icon.png',
          'reverie-next-read-share.png',
        ],
      },
      null,
      2,
    )}\n`,
  )
} finally {
  await browser.close()
}
