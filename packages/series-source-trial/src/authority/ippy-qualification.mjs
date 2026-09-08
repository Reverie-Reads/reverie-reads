import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { normalize, slug } from '../normalize.mjs'
import { sha256Json } from './qualification.mjs'

export const IPPY_ORIGIN = 'https://ippyawards.com'
export const IPPY_QUALIFICATION_PAGES = [
  {
    id: 'ippy-2025-general-1-34',
    year: 2025,
    format: 'sectioned',
    minimumRecords: 100,
    url: `${IPPY_ORIGIN}/blog/2025-medalists`,
  },
  {
    id: 'ippy-2025-general-35-65',
    year: 2025,
    format: 'sectioned',
    minimumRecords: 90,
    url: `${IPPY_ORIGIN}/blog/2025-medalists-categories-35-65`,
  },
  {
    id: 'ippy-2025-general-66-92',
    year: 2025,
    format: 'sectioned',
    minimumRecords: 70,
    url: `${IPPY_ORIGIN}/blog/2025-medalists-categories-66-92`,
  },
  {
    id: 'ippy-2025-regional-ebook',
    year: 2025,
    format: 'sectioned',
    minimumRecords: 90,
    url: `${IPPY_ORIGIN}/blog/2025-medalists-regional-ebook-categories`,
  },
  {
    id: 'ippy-2024-general-regional-ebook',
    year: 2024,
    format: 'archive-card',
    minimumRecords: 350,
    url: `${IPPY_ORIGIN}/blog/2024-medalists`,
  },
  {
    id: 'ippy-2023-general-regional-ebook',
    year: 2023,
    format: 'archive-card',
    minimumRecords: 350,
    url: `${IPPY_ORIGIN}/blog/2023-medalists`,
  },
]

export const IPPY_2025_PAGES = IPPY_QUALIFICATION_PAGES.filter(({ year }) => year === 2025)

const clean = (value) =>
  String(value ?? '')
    .replace(/\s+/g, ' ')
    .trim()

const visibleText = (node) => {
  if (
    !node ||
    ['script', 'style', 'template', 'noscript', 'iframe', 'svg'].includes(node.tagName)
  ) {
    return ''
  }
  if (node.nodeName === '#text') return node.value ?? ''
  return (node.childNodes ?? []).map(visibleText).join(' ')
}

const elementsInOrder = (node, tags, result = []) => {
  if (tags.has(node?.tagName)) result.push(node)
  for (const child of node?.childNodes ?? []) elementsInOrder(child, tags, result)
  return result
}

const classNames = (node) =>
  new Set(
    (node?.attrs ?? [])
      .find(({ name }) => name === 'class')
      ?.value.split(/\s+/)
      .filter(Boolean) ?? [],
  )

const elementsWithClass = (node, className, result = []) => {
  if (classNames(node).has(className)) result.push(node)
  for (const child of node?.childNodes ?? []) elementsWithClass(child, className, result)
  return result
}

const firstWithClass = (node, className) => elementsWithClass(node, className, []).at(0) ?? null

const sectionHeading = /^(general|regional|ebook) categories?/i
const medalHeading = /^(gold|silver|bronze)(?:\s*\(tie\))?\s*:?\s*$/i

export function extractIppyMedalistRecords(html) {
  const document = parse(html)
  const elements = elementsInOrder(document, new Set(['h2', 'h3', 'h4', 'p']))
  let section = null
  let category = null
  let current = null
  const records = []
  const flush = () => {
    if (!current) return
    const line = clean(current.parts.join(' '))
    if (line) records.push({ ...current, line })
    current = null
  }

  for (const element of elements) {
    const text = clean(visibleText(element))
    if (!text) continue
    if (element.tagName === 'h2') {
      flush()
      section = sectionHeading.test(text) ? text : null
      category = null
      continue
    }
    if (element.tagName === 'h3') {
      flush()
      category = section ? text : null
      continue
    }
    if (element.tagName === 'h4') {
      flush()
      current =
        section && category && medalHeading.test(text)
          ? { section, category, medal: text, parts: [] }
          : null
      continue
    }
    if (element.tagName === 'p' && current) current.parts.push(text)
  }
  flush()
  return records
}

const archiveSection = (category) => {
  if (/^E\d+\./i.test(category)) return 'EBOOK CATEGORIES'
  if (/\bBEST REGIONAL\b/i.test(category)) return 'REGIONAL CATEGORIES'
  if (/^\d+\./.test(category)) return 'GENERAL CATEGORIES'
  return null
}

const archiveAuthorMarker =
  /^(?:by|written and illustrated by|written and narrated by|written by|edited and translated by|edited by|created by|author\s*:)/i

const archiveGroups = (parts, { category, medal }) => {
  if (!parts.length) {
    throw new Error(`IPPY archive medal block is empty: ${category} / ${medal}`)
  }
  const authorIndexes = parts.flatMap((part, index) =>
    archiveAuthorMarker.test(part) ? [index] : [],
  )
  const explicitPairs =
    authorIndexes.length === parts.length / 2 &&
    authorIndexes.every((authorIndex, index) => authorIndex === index * 2 + 1)
  if (parts.length % 3 === 0 && !explicitPairs) {
    return Array.from({ length: parts.length / 3 }, (_, index) =>
      parts.slice(index * 3, index * 3 + 3),
    )
  }
  if (authorIndexes.length && authorIndexes[0] === 1) {
    const groups = []
    const used = new Set()
    let ambiguous = false
    for (let index = 0; index < authorIndexes.length; index += 1) {
      const authorIndex = authorIndexes[index]
      const titleIndex = authorIndex - 1
      const nextAuthorIndex = authorIndexes[index + 1] ?? parts.length + 1
      const publisherParts = parts.slice(authorIndex + 1, nextAuthorIndex - 1)
      if (publisherParts.length > 1) {
        ambiguous = true
        break
      }
      groups.push([parts[titleIndex], parts[authorIndex], publisherParts[0] ?? null])
      used.add(titleIndex)
      used.add(authorIndex)
      if (publisherParts.length) used.add(authorIndex + 1)
    }
    if (!ambiguous && used.size === parts.length) return groups
  }

  if (parts.length % 2 === 0) {
    return Array.from({ length: parts.length / 2 }, (_, index) => [
      parts[index * 2],
      parts[index * 2 + 1],
      null,
    ])
  }
  throw new Error(`IPPY archive medal block is ambiguous: ${category} / ${medal}`)
}

const archiveRecord = ({ title, author, publisher, section, category, medal }) => {
  const normalizedAuthor = archiveAuthorMarker.test(author) ? author : `by ${author}`
  const normalizedPublisher = clean(publisher).replace(/^\((.*)\)$/, '$1')
  const parts = [title, author, publisher].filter(Boolean)
  const secondaryOnly = /^(?:by\s+)?(?:illustrated|narrated|translated)\s+by\b/i.test(author)
  const embeddedAuthor = secondaryOnly ? clean(title).match(/^(.*)\s+by\s+([^,;]+)$/i) : null
  const identity = embeddedAuthor
    ? buildIppyIdentity({
        title: embeddedAuthor[1],
        authorText: embeddedAuthor[2],
        publisherLabel: normalizedPublisher || null,
      })
    : secondaryOnly
      ? { eligible: false, reason: 'archive credit has no unambiguous primary author' }
      : buildIppyIdentity({
          title,
          authorText: clean(author).replace(archiveAuthorMarker, ''),
          publisherLabel: normalizedPublisher || null,
        })
  if (
    embeddedAuthor &&
    identity.eligible &&
    !identity.reviewFlags.includes('verify_contributor_split')
  ) {
    identity.reviewFlags.push('verify_contributor_split')
  }
  return {
    section,
    category,
    medal,
    parts,
    line: clean(
      `${title} ${normalizedAuthor}${normalizedPublisher ? ` (${normalizedPublisher})` : ''}`,
    ),
    identity,
  }
}

export function extractIppyArchiveMedalistRecords(html) {
  const document = parse(html)
  const records = []
  for (const card of elementsWithClass(document, 'wpr-promo-box-content')) {
    const titleNode = firstWithClass(card, 'wpr-promo-box-title')
    const descriptionNode = firstWithClass(card, 'wpr-promo-box-description')
    const category = clean(visibleText(titleNode))
    const section = archiveSection(category)
    if (!section || !descriptionNode) continue
    const parts = elementsInOrder(descriptionNode, new Set(['p']))
      .map((node) => clean(visibleText(node)))
      .filter(Boolean)
    let medal = null
    let medalParts = []
    const flush = () => {
      if (!medal) return
      if (/^80\.\s*BOOK\/AUTHOR\/PUBLISHER WEBSITE/i.test(category)) {
        for (const part of medalParts) {
          records.push({
            section,
            category,
            medal,
            parts: [part],
            line: part,
            exclusionReason: 'non-book website award category',
          })
        }
      } else {
        for (const [title, author, publisher] of archiveGroups(medalParts, {
          category,
          medal,
        })) {
          records.push(archiveRecord({ title, author, publisher, section, category, medal }))
        }
      }
      medal = null
      medalParts = []
    }
    for (const part of parts) {
      if (medalHeading.test(part)) {
        flush()
        medal = part.replace(/\s*:\s*$/, '').toLocaleUpperCase('en-US')
      } else if (medal) {
        medalParts.push(part)
      }
    }
    flush()
  }
  return records
}

const byMarker =
  /\s+(written and illustrated by|written and narrated by|written by|edited and translated by|edited by|created by|author\s*:|by)\s+/i
const secondaryContributor =
  /(?:\s*(?:;|,)\s*(?:edited|illustrated|illustrations?|art|narrated|photographs?|photography|foreword|music produced|translated|with contributors?)\s+by|\s+by\s+illustrated\s+by)\b.*$/i

const buildIppyIdentity = ({ title, authorText, publisherLabel, extraReviewFlags = [] }) => {
  const normalizedTitle = clean(title).replace(/^['“”]|['“”]$/g, '')
  const normalizedAuthor = clean(authorText).replace(secondaryContributor, '')
  if (!normalizedTitle || !normalizedAuthor || /^\([^)]*\)$/.test(normalizedAuthor)) {
    return { eligible: false, reason: 'winner line is missing a usable title or primary author' }
  }
  const reviewFlags = [...extraReviewFlags]
  if (
    /\b(?:and|with)\b|&|;|,|\b(?:edited|illustrated|narrated|translated)\s+by\b/i.test(
      normalizedAuthor,
    )
  ) {
    reviewFlags.push('verify_contributor_split')
  }
  if (publisherLabel && normalize(normalizedAuthor) === normalize(publisherLabel)) {
    reviewFlags.push('verify_author_publisher_identity')
  }
  if (!publisherLabel) reviewFlags.push('publisher_label_missing')
  return {
    eligible: true,
    title: normalizedTitle,
    authors: [normalizedAuthor],
    publisherLabel,
    reviewFlags,
  }
}

export function parseIppyIdentity(line) {
  const normalizedLine = clean(line)
  const publisherMatch = normalizedLine.match(/\s*\(([^()]*)\)\s*$/)
  const unclosedPublisherMatch = publisherMatch ? null : normalizedLine.match(/\s+\(([^()]*)$/)
  const publisherLabel = clean(publisherMatch?.[1] ?? unclosedPublisherMatch?.[1]) || null
  const publisherIndex = publisherMatch?.index ?? unclosedPublisherMatch?.index
  const withoutPublisher = Number.isInteger(publisherIndex)
    ? clean(normalizedLine.slice(0, publisherIndex))
    : normalizedLine
  const marker = byMarker.exec(withoutPublisher)
  if (!marker) {
    return { eligible: false, reason: 'winner line has no unambiguous primary-author marker' }
  }
  const title = clean(withoutPublisher.slice(0, marker.index))
  const authorText = clean(withoutPublisher.slice(marker.index + marker[0].length)).replace(
    secondaryContributor,
    '',
  )
  return buildIppyIdentity({
    title,
    authorText,
    publisherLabel,
    extraReviewFlags: unclosedPublisherMatch ? ['source_publisher_parenthesis_repaired'] : [],
  })
}

export function ippyQualificationStrata(category) {
  const text = clean(category).toLocaleLowerCase('en-US')
  const strata = new Set()
  if (/romance|erotica/.test(text)) strata.add('tryst')
  if (/fantasy/.test(text)) strata.add('grimoire')
  if (/sci-fi|science fiction/.test(text)) strata.add('aphelion')
  if (/horror/.test(text)) strata.add('marrow')
  if (/mystery|thriller|crime|suspense/.test(text)) strata.add('umbra')
  if (/fiction/.test(text) && !/non-fiction|nonfiction/.test(text)) strata.add('folio')
  if (/cozy/.test(text)) strata.add('hearth')
  if (/juvenile|young adult|children/.test(text)) strata.add('bloom')
  if (
    /non-fiction|nonfiction|reference|history|biography|memoir|essay|poetry|business|health|psychology|science|nature|travel|cook|religion|self-help|education|current events|sports|photography|art|architecture/.test(
      text,
    )
  ) {
    strata.add('almanac')
  }
  return [...strata].sort()
}

const shortHash = (value) => createHash('sha256').update(value).digest('hex').slice(0, 12)

export function buildIppyCandidate({ record, identity, frame }) {
  const key = `${normalize(identity.title)}|${normalize(identity.authors.join('&'))}`
  return {
    id: `qualification-ippy-${shortHash(key)}-${slug(identity.title)}`,
    title: identity.title,
    authors: identity.authors,
    evaluationPartition: 'qualification',
    publicationYear: null,
    publicationPath: null,
    selectionFrameIds: [frame.id],
    selectionSources: [{ frameId: frame.id, kind: 'platform_award', url: frame.url }],
    qualificationStrata: ippyQualificationStrata(record.category),
    riskFeatures: [],
    truth: {
      status: 'candidate',
      standalone: null,
      memberships: [],
      sources: [],
      reviewNote:
        'The award frame establishes selection identity only. Add separate author or publisher classification evidence and verify publication year.',
    },
    reviewMetadata: {
      provider: 'independent_publisher_book_awards',
      awardYears: [frame.year],
      section: record.section,
      categories: [record.category],
      medals: [record.medal],
      publisherLabel: identity.publisherLabel,
      identityReviewFlags: identity.reviewFlags,
      reviewFlags: ['verify_publication_path', 'verify_publication_year'],
      contentRetention: 'winner_identity_and_category_only',
    },
  }
}

const addSelection = (candidate, record, frame) => {
  if (!candidate.selectionFrameIds.includes(frame.id)) {
    candidate.selectionFrameIds.push(frame.id)
    candidate.selectionSources.push({
      frameId: frame.id,
      kind: 'platform_award',
      url: frame.url,
    })
  }
  if (!candidate.reviewMetadata.categories.includes(record.category)) {
    candidate.reviewMetadata.categories.push(record.category)
  }
  if (!candidate.reviewMetadata.medals.includes(record.medal)) {
    candidate.reviewMetadata.medals.push(record.medal)
  }
  if (!candidate.reviewMetadata.awardYears.includes(frame.year)) {
    candidate.reviewMetadata.awardYears.push(frame.year)
  }
  candidate.qualificationStrata = [
    ...new Set([...candidate.qualificationStrata, ...ippyQualificationStrata(record.category)]),
  ].sort()
}

export function buildIppyCapture({ pages, capturedAt, developmentWorkKeys = new Set() }) {
  const casesByKey = new Map()
  const selectionFrames = []
  const pageManifests = []
  for (const page of pages) {
    const frame = { id: page.id, url: page.url, year: page.year }
    const exclusions = new Map()
    const frameCandidateKeys = new Set()
    const seenLines = new Set()
    for (const record of page.records) {
      const lineKey = normalize(record.line)
      if (seenLines.has(lineKey)) continue
      seenLines.add(lineKey)
      if (record.exclusionReason) {
        exclusions.set(record.exclusionReason, (exclusions.get(record.exclusionReason) ?? 0) + 1)
        continue
      }
      const identity = record.identity ?? parseIppyIdentity(record.line)
      if (!identity.eligible) {
        exclusions.set(identity.reason, (exclusions.get(identity.reason) ?? 0) + 1)
        continue
      }
      const workKey = `${normalize(identity.title)}|${identity.authors
        .map(normalize)
        .sort()
        .join('&')}`
      if (developmentWorkKeys.has(workKey)) {
        const reason = 'work already exists in the development partition'
        exclusions.set(reason, (exclusions.get(reason) ?? 0) + 1)
        continue
      }
      frameCandidateKeys.add(workKey)
      const existing = casesByKey.get(workKey)
      if (existing) addSelection(existing, record, frame)
      else casesByKey.set(workKey, buildIppyCandidate({ record, identity, frame }))
    }
    const exclusionList = [...exclusions.entries()]
      .map(([reason, count]) => ({ reason, count }))
      .sort((left, right) => left.reason.localeCompare(right.reason))
    const populationCases =
      frameCandidateKeys.size + exclusionList.reduce((sum, item) => sum + item.count, 0)
    selectionFrames.push({
      id: page.id,
      kind: 'platform_award',
      url: page.url,
      capturedAt,
      complete: true,
      populationCases,
      eligibleReviewedCases: frameCandidateKeys.size,
      exclusions: exclusionList,
    })
    pageManifests.push({
      id: page.id,
      year: page.year,
      format: page.format,
      url: page.url,
      responseSha256: page.responseSha256,
      distinctWinnerLines: seenLines.size,
      candidateCases: frameCandidateKeys.size,
      exclusions: exclusionList,
    })
  }
  const cases = [...casesByKey.values()].sort((left, right) => left.id.localeCompare(right.id))
  for (const candidate of cases) {
    candidate.selectionFrameIds.sort()
    candidate.selectionSources.sort((left, right) => left.frameId.localeCompare(right.frameId))
    candidate.reviewMetadata.categories.sort()
    candidate.reviewMetadata.medals.sort()
    candidate.reviewMetadata.awardYears.sort()
  }
  return {
    schemaVersion: 1,
    selectionFrames,
    cases,
    captureManifest: {
      schemaVersion: 1,
      provider: 'independent_publisher_book_awards',
      awardYears: [...new Set(pages.map(({ year }) => year))].sort(),
      pages: pageManifests,
      uniqueCandidateCases: cases.length,
      identitySha256: sha256Json(
        cases.map(({ id, title, authors, selectionFrameIds }) => ({
          id,
          title,
          authors,
          selectionFrameIds,
        })),
      ),
      frameDefinition:
        'Every distinct book medalist under General, Regional, or Ebook Categories on the fixed official 2023-2025 result pages; exact duplicate lines within one page are counted once and the non-book website category is explicitly excluded.',
      truthBoundary:
        'Award categories, title subtitles, publisher labels, and book-number wording are selection metadata only and cannot establish series or standalone truth.',
      contentRetention: 'winner_identity_and_category_only_no_html_or_images',
    },
  }
}
