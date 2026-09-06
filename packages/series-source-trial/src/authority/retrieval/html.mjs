import { parse } from 'parse5'

const SKIP_TAGS = new Set([
  'script',
  'style',
  'template',
  'noscript',
  'iframe',
  'svg',
  'form',
  'button',
])
const BLOCK_TAGS = new Set([
  'title',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'p',
  'li',
  'dt',
  'dd',
  'th',
  'td',
  'figcaption',
])
const INLINE_METADATA_CONTAINERS = new Set(['div', 'section'])
const INLINE_METADATA_LABEL =
  /^(?:title|author|series|book(?: number)?|volume(?: number)?|position|release date|publication date)\s*:?$/i
const DOWNLOAD_SUFFIX = /\.(?:zip|rar|7z|tar|gz|pdf|epub|mobi|docx?|xlsx?|pptx?)(?:$|[?#])/i
const MUTATION_PATH = /\/(?:logout|signout|delete|remove|unsubscribe|cart|checkout)(?:\/|$)/i
const MUTATION_QUERY = /^(?:action|do|logout|signout|delete|remove|unsubscribe|token)$/i
const NEGATIVE_LINK =
  /\b(?:store|shop|cart|account|event|tour|press|contact|privacy|terms|instagram|facebook|tiktok|youtube)\b/i
const KEYWORD_WEIGHTS = new Map([
  ['series', 70],
  ['bibliography', 60],
  ['publications', 55],
  ['catalog', 50],
  ['books', 45],
])

const attributes = (node) =>
  Object.fromEntries((node.attrs ?? []).map((attr) => [attr.name, attr.value]))
const isHidden = (node) => {
  const attrs = attributes(node)
  return (
    'hidden' in attrs ||
    attrs['aria-hidden']?.toLowerCase() === 'true' ||
    /(?:display\s*:\s*none|visibility\s*:\s*hidden)/i.test(attrs.style ?? '')
  )
}

const visibleText = (node) => {
  if (!node || SKIP_TAGS.has(node.tagName) || isHidden(node)) return ''
  if (node.nodeName === '#text') return node.value ?? ''
  return (node.childNodes ?? []).map(visibleText).join(' ')
}

const stripControlCharacters = (value) =>
  [...value]
    .map((character) => {
      const codePoint = character.codePointAt(0)
      return codePoint <= 8 ||
        codePoint === 11 ||
        codePoint === 12 ||
        (codePoint >= 14 && codePoint <= 31) ||
        codePoint === 127
        ? ' '
        : character
    })
    .join('')

const cleanText = (value) => stripControlCharacters(value).replace(/\s+/g, ' ').trim()

const normalizedWords = (value) =>
  cleanText(value)
    .normalize('NFKD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()

const walk = (node, visitor) => {
  if (!node || SKIP_TAGS.has(node.tagName) || isHidden(node)) return
  visitor(node)
  for (const child of node.childNodes ?? []) walk(child, visitor)
}

const inlineMetadataLine = (node) => {
  if (!INLINE_METADATA_CONTAINERS.has(node?.tagName)) return ''
  const segments = []
  let current = []

  const flush = () => {
    if (!current.length) return
    const labelNode = current.find((child) => child?.tagName === 'strong')
    const label = cleanText(visibleText(labelNode))
    if (INLINE_METADATA_LABEL.test(label)) {
      const text = cleanText(current.map(visibleText).join(' '))
      if (text) segments.push(text)
    }
    current = []
  }

  for (const child of node.childNodes ?? []) {
    if (child.tagName === 'br') {
      flush()
      continue
    }
    if (BLOCK_TAGS.has(child.tagName) || INLINE_METADATA_CONTAINERS.has(child.tagName)) {
      flush()
      break
    }
    current.push(child)
  }
  flush()
  return segments.length >= 2 ? `META: ${segments.join(' | ')}` : ''
}

const scoreLink = ({ label, url }, targetTitle) => {
  const normalizedLabel = normalizedWords(label)
  const parsedUrl = typeof url === 'string' ? new URL(url) : url
  const normalizedPath = normalizedWords(parsedUrl.pathname)
  const normalizedTitle = normalizedWords(targetTitle)
  let score = normalizedLabel === normalizedTitle && normalizedTitle ? 90 : 0
  for (const [keyword, weight] of KEYWORD_WEIGHTS) {
    if (normalizedLabel.split(' ').includes(keyword)) score = Math.max(score, weight)
    if (normalizedPath.split(' ').includes(keyword)) score = Math.max(score, weight - 5)
  }
  if (normalizedTitle && normalizedLabel.includes(normalizedTitle)) score += 20
  if (NEGATIVE_LINK.test(`${label} ${parsedUrl.pathname}`)) score -= 80
  return score
}

export function selectNavigationCandidate(
  html,
  { parentUrl, canonicalOrigin, targetTitle, minimumScore = 40 },
) {
  let document
  try {
    document = parse(html)
  } catch {
    return { status: 'parse_failure', candidates: [] }
  }
  const parent = new URL(parentUrl)
  parent.hash = ''
  const byUrl = new Map()

  walk(document, (node) => {
    if (node.tagName !== 'a') return
    const attrs = attributes(node)
    if (!attrs.href) return
    let url
    try {
      url = new URL(attrs.href, parent)
    } catch {
      return
    }
    if (url.protocol !== 'https:' || url.origin !== canonicalOrigin || url.username || url.password)
      return
    let decodedPath
    try {
      decodedPath = decodeURIComponent(url.pathname)
    } catch {
      return
    }
    if (
      DOWNLOAD_SUFFIX.test(decodedPath) ||
      MUTATION_PATH.test(decodedPath) ||
      url.searchParams.size > 2 ||
      [...url.searchParams.keys()].some((key) => MUTATION_QUERY.test(key)) ||
      url.href === parent.href
    )
      return
    if (url.hash && url.pathname === parent.pathname && url.search === parent.search) return
    url.hash = ''
    const visibleLabel = cleanText(visibleText(node))
    const label = cleanText(attrs['aria-label'] || visibleLabel || attrs.title || '')
    if (!label) return
    const candidate = { url: url.href, label }
    candidate.score = scoreLink(candidate, targetTitle)
    const existing = byUrl.get(candidate.url)
    if (!existing || candidate.score > existing.score) byUrl.set(candidate.url, candidate)
  })

  const candidates = [...byUrl.values()].sort(
    (left, right) => right.score - left.score || left.url.localeCompare(right.url),
  )
  if (!candidates.length || candidates[0].score < minimumScore) {
    return { status: 'no_candidate', candidates }
  }
  if (candidates[1]?.score === candidates[0].score) {
    return { status: 'ambiguous_candidate', candidates }
  }
  return { status: 'selected', selected: candidates[0], candidates }
}

const findFirstTag = (node, tagName) => {
  if (node?.tagName === tagName) return node
  for (const child of node?.childNodes ?? []) {
    const found = findFirstTag(child, tagName)
    if (found) return found
  }
  return null
}

export function extractEvidenceText(html, maxCharacters = 8_000) {
  let document
  try {
    document = parse(html)
  } catch {
    return { status: 'parse_failure', text: '', truncated: false, omittedCharacters: 0 }
  }
  const title = findFirstTag(document, 'title')
  const root = findFirstTag(document, 'main') ?? findFirstTag(document, 'body') ?? document
  const lines = []
  const titleText = cleanText(visibleText(title))
  if (titleText) lines.push(`TITLE: ${titleText}`)
  walk(root, (node) => {
    const metadata = inlineMetadataLine(node)
    if (metadata && lines.at(-1) !== metadata) lines.push(metadata)
    if (!BLOCK_TAGS.has(node.tagName)) return
    const text = cleanText(visibleText(node))
    if (!text) return
    const line = `${node.tagName.toUpperCase()}: ${text}`
    if (lines.at(-1) !== line) lines.push(line)
  })
  const complete = lines.join('\n')
  if (complete.length <= maxCharacters) {
    return { status: 'extracted', text: complete, truncated: false, omittedCharacters: 0 }
  }
  const marker = `\n[TRUNCATED ${complete.length - maxCharacters} CHARACTERS]`
  return {
    status: 'extracted',
    text: `${complete.slice(0, Math.max(0, maxCharacters - marker.length))}${marker}`,
    truncated: true,
    omittedCharacters: complete.length - maxCharacters,
  }
}
