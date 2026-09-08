import { createHash } from 'node:crypto'
import { parse } from 'parse5'
import { normalize, slug } from '../normalize.mjs'
import { sha256Json } from './qualification.mjs'

export const IPPY_ORIGIN = 'https://ippyawards.com'
export const IPPY_2025_PAGES = [
  {
    id: 'ippy-2025-general-1-34',
    url: `${IPPY_ORIGIN}/blog/2025-medalists`,
  },
  {
    id: 'ippy-2025-general-35-65',
    url: `${IPPY_ORIGIN}/blog/2025-medalists-categories-35-65`,
  },
  {
    id: 'ippy-2025-general-66-92',
    url: `${IPPY_ORIGIN}/blog/2025-medalists-categories-66-92`,
  },
  {
    id: 'ippy-2025-regional-ebook',
    url: `${IPPY_ORIGIN}/blog/2025-medalists-regional-ebook-categories`,
  },
]

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

const sectionHeading = /^(general|regional|ebook) categories?/i
const medalHeading = /^(gold|silver|bronze)(?:\s*\(tie\))?$/i

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

const byMarker =
  /\s+(written and illustrated by|written by|edited and translated by|edited by|created by|author\s*:|by)\s+/i
const secondaryContributor =
  /\s*(?:;|,)\s*(?:edited|illustrated|illustrations?|art|photographs?|photography|foreword|music produced|translated|with contributors?)\s+by\b.*$/i

export function parseIppyIdentity(line) {
  const normalizedLine = clean(line)
  const publisherMatch = normalizedLine.match(/\s*\(([^()]*)\)\s*$/)
  const publisherLabel = clean(publisherMatch?.[1]) || null
  const withoutPublisher = publisherMatch
    ? clean(normalizedLine.slice(0, publisherMatch.index))
    : normalizedLine
  const marker = byMarker.exec(withoutPublisher)
  if (!marker) {
    return { eligible: false, reason: 'winner line has no unambiguous primary-author marker' }
  }
  const title = clean(withoutPublisher.slice(0, marker.index)).replace(/^['“”]|['“”]$/g, '')
  const authorText = clean(withoutPublisher.slice(marker.index + marker[0].length)).replace(
    secondaryContributor,
    '',
  )
  if (!title || !authorText || /^\([^)]*\)$/.test(authorText)) {
    return { eligible: false, reason: 'winner line is missing a usable title or primary author' }
  }
  const reviewFlags = []
  if (/\b(?:and|with)\b|&|;|,/.test(authorText)) reviewFlags.push('verify_contributor_split')
  if (!publisherLabel) reviewFlags.push('publisher_label_missing')
  return {
    eligible: true,
    title,
    authors: [authorText],
    publisherLabel,
    reviewFlags,
  }
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
      awardYear: 2025,
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
  candidate.qualificationStrata = [
    ...new Set([...candidate.qualificationStrata, ...ippyQualificationStrata(record.category)]),
  ].sort()
}

export function buildIppyCapture({ pages, capturedAt, developmentWorkKeys = new Set() }) {
  const casesByKey = new Map()
  const selectionFrames = []
  const pageManifests = []
  for (const page of pages) {
    const frame = { id: page.id, url: page.url }
    const exclusions = new Map()
    const frameCandidateKeys = new Set()
    const seenLines = new Set()
    for (const record of page.records) {
      const lineKey = normalize(record.line)
      if (seenLines.has(lineKey)) continue
      seenLines.add(lineKey)
      const identity = parseIppyIdentity(record.line)
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
  }
  return {
    schemaVersion: 1,
    selectionFrames,
    cases,
    captureManifest: {
      schemaVersion: 1,
      provider: 'independent_publisher_book_awards',
      awardYear: 2025,
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
        'Every distinct medalist line under General, Regional, or Ebook Categories on the four official 2025 result pages; exact duplicate lines within one page are counted once.',
      truthBoundary:
        'Award categories, title subtitles, publisher labels, and book-number wording are selection metadata only and cannot establish series or standalone truth.',
      contentRetention: 'winner_identity_and_category_only_no_html_or_images',
    },
  }
}
