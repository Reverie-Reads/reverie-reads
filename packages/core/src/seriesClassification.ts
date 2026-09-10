import { matchKey, type Confidence } from './enrichResolve'

export type SeriesEvidenceSource =
  | 'author'
  | 'publisher'
  | 'isbn_onix'
  | 'national_library'
  | 'hardcover'
  | 'openlibrary'
  | 'wikidata'
  | 'isfdb'
  | 'fantasticfiction'
  | 'manual'

export type SeriesOrderType = 'publication' | 'recommended' | 'narrative' | 'unspecified'

export interface SeriesCatalogEntry {
  title: string
  author: string
  position: number | null
}

/** A source's actual series-membership graph. A search result's `series` label is deliberately
 * not this shape: labels identify candidates, while entries prove relationships. */
export interface SeriesCatalogSnapshot {
  source: SeriesEvidenceSource
  series: string
  sourceRef: string | null
  entries: SeriesCatalogEntry[]
  /** Provider cardinality, never trusted as a Hardcover work count or declared length. */
  memberCount?: number | null
  /** Never silently conflate publication order with an author's recommended reading order. */
  orderType?: SeriesOrderType
  unavailable?: boolean
}

export interface SeriesClassificationInput {
  title: string
  author: string
  /** Candidate label returned while resolving the book. It is never sufficient on its own. */
  candidateSeries: string
  candidatePosition: number | null
  candidateSource: string
  candidateSourceRef: string | null
  /** Confidence that the provider result identifies this BOOK, not its series membership. */
  identityConfidence: Confidence
  snapshots: SeriesCatalogSnapshot[]
}

export interface SeriesEvidenceRecord {
  source: string
  kind: 'relational_membership' | 'candidate_label' | 'provider_unavailable'
  sourceRef: string | null
  series: string | null
  position: number | null
  memberCount: number | null
  orderType: SeriesOrderType
}

export interface SeriesClassification {
  outcome: 'found' | 'review' | 'no_series' | 'unresolved'
  matched: boolean
  series: string | null
  position: number | null
  count: number | null
  identityConfidence: Confidence
  membershipConfidence: Confidence
  source: string
  sourceRef: string | null
  reason: string
  evidence: SeriesEvidenceRecord[]
}

const titleKey = (value: string): string =>
  matchKey(String(value ?? '').replace(/\s*[:–—]\s.*$|\s+-\s+.*$/, ''))

const authorMatches = (wanted: string, actual: string): boolean => {
  const left = matchKey(wanted)
  const right = matchKey(actual)
  if (!left || !right) return false
  if (left === right || left.includes(right) || right.includes(left)) return true
  const leftLast = left.split(' ').at(-1)
  const rightLast = right.split(' ').at(-1)
  const leftFirst = left.split(' ')[0]
  const rightFirst = right.split(' ')[0]
  return (
    !!leftLast &&
    leftLast.length >= 3 &&
    leftLast === rightLast &&
    !!leftFirst &&
    !!rightFirst &&
    leftFirst[0] === rightFirst[0]
  )
}

const positiveIdentity = (confidence: Confidence): boolean =>
  confidence === 'high' || confidence === 'medium'

const sourceAuthority = (source: string): number => {
  if (source === 'author') return 0
  if (source === 'publisher') return 1
  if (source === 'isbn_onix' || source === 'national_library') return 2
  if (
    source === 'hardcover' ||
    source === 'wikidata' ||
    source === 'openlibrary' ||
    source === 'isfdb'
  )
    return 3
  if (source === 'fantasticfiction') return 5
  return 4
}

/**
 * Classify a series claim independently from book identity.
 *
 * Automatic acceptance requires a real provider relationship containing the target book. A
 * one-book relationship remains reviewable because source search indexes frequently manufacture
 * self-titled one-item "series"; it becomes high confidence when the provider shows another member,
 * a later ordinal, or a second independent relational source agrees.
 */
export function classifySeriesMembership(input: SeriesClassificationInput): SeriesClassification {
  const matched = positiveIdentity(input.identityConfidence)
  const candidate = input.candidateSeries.trim()
  const candidateEvidence: SeriesEvidenceRecord[] = candidate
    ? [
        {
          source: input.candidateSource || 'catalog',
          kind: 'candidate_label',
          sourceRef: input.candidateSourceRef,
          series: candidate,
          position: input.candidatePosition,
          memberCount: null,
          orderType: 'unspecified',
        },
      ]
    : []

  if (!matched) {
    return {
      outcome: 'unresolved',
      matched: false,
      series: null,
      position: null,
      count: null,
      identityConfidence: input.identityConfidence,
      membershipConfidence: 'none',
      source: input.candidateSource || 'catalog',
      sourceRef: input.candidateSourceRef,
      reason: 'The book identity was not strong enough to evaluate series membership.',
      evidence: candidateEvidence,
    }
  }

  if (!candidate) {
    return {
      outcome: 'no_series',
      matched: true,
      series: null,
      position: null,
      count: null,
      identityConfidence: input.identityConfidence,
      membershipConfidence: 'none',
      source: input.candidateSource || 'catalog',
      sourceRef: input.candidateSourceRef,
      reason:
        'A matched catalog record returned no series label; this is an observation, not a standalone ruling.',
      evidence: [],
    }
  }

  const snapshots = input.snapshots
  const unavailable = snapshots.filter((snapshot) => snapshot.unavailable)
  const targetTitle = matchKey(input.title)
  const targetBaseTitle = titleKey(input.title)
  const relationships = snapshots.flatMap((snapshot) => {
    if (snapshot.unavailable) return []
    const entry = snapshot.entries.find((item) => {
      const exactTitle = matchKey(item.title) === targetTitle
      if (snapshot.source === 'hardcover') {
        return (
          exactTitle && !!input.author.trim() && matchKey(input.author) === matchKey(item.author)
        )
      }
      const compatibleBase = titleKey(item.title) === targetBaseTitle
      if (!exactTitle && !compatibleBase) return false
      // An authorless target cannot disambiguate a common title. Keep it reviewable below.
      return !input.author.trim() || authorMatches(input.author, item.author)
    })
    if (!entry) return []
    // Fantastic Fiction's permitted field set stops at membership, series name, and order. Do not
    // derive or retain its total series size even when the page exposes enough rows to count it.
    const memberCount =
      snapshot.source === 'fantasticfiction' || snapshot.source === 'hardcover'
        ? null
        : Math.max(snapshot.memberCount ?? 0, snapshot.entries.length) || null
    return [
      {
        snapshot,
        entry,
        memberCount,
        evidence: {
          source: snapshot.source,
          kind: 'relational_membership' as const,
          sourceRef: snapshot.sourceRef,
          series: snapshot.series,
          position: entry.position,
          memberCount,
          orderType: snapshot.orderType ?? 'unspecified',
        },
      },
    ]
  })

  if (!relationships.length) {
    const outageEvidence: SeriesEvidenceRecord[] = unavailable.map((snapshot) => ({
      source: snapshot.source,
      kind: 'provider_unavailable',
      sourceRef: snapshot.sourceRef,
      series: snapshot.series,
      position: null,
      memberCount: null,
      orderType: snapshot.orderType ?? 'unspecified',
    }))
    return {
      outcome: 'unresolved',
      matched: true,
      series: null,
      position: null,
      count: null,
      identityConfidence: input.identityConfidence,
      membershipConfidence: 'low',
      source: input.candidateSource || 'catalog',
      sourceRef: input.candidateSourceRef,
      reason: unavailable.length
        ? 'The relational series source was unavailable; the search label was not accepted by itself.'
        : 'No relational source contained this book in the proposed series.',
      evidence: [...candidateEvidence, ...outageEvidence],
    }
  }

  relationships.sort(
    (left, right) => sourceAuthority(left.snapshot.source) - sourceAuthority(right.snapshot.source),
  )
  const primary = relationships[0]!
  const proposedKey = matchKey(primary.snapshot.series)
  const agreeing = relationships.filter(
    (relationship) => matchKey(relationship.snapshot.series) === proposedKey,
  )
  const conflicting = relationships.filter(
    (relationship) => matchKey(relationship.snapshot.series) !== proposedKey,
  )
  const corroboratingSources = new Set(
    agreeing
      .map((relationship) => relationship.snapshot.source)
      .filter((source) => source !== 'fantasticfiction'),
  )
  const hasSeriesContext = agreeing.some(({ snapshot, entry, memberCount }) => {
    if (snapshot.source === 'fantasticfiction') return false
    if (snapshot.source === 'hardcover') {
      // Multiple editions/sets at one ordinal are not multiple volumes. This establishes
      // relationship context only, never completeness or declared length.
      const positions = new Set(
        snapshot.entries
          .filter(
            (item) =>
              matchKey(item.author) === matchKey(input.author) &&
              !/\b(box(?:ed)?\s*(?:set|duologia)|\d+[- ]book\s+set|omnibus|collection|boxset)\b/i.test(
                item.title,
              ) &&
              Number.isInteger(item.position) &&
              (item.position ?? 0) > 0,
          )
          .map((item) => item.position),
      )
      const targetIsCollection =
        /\b(box(?:ed)?\s*(?:set|duologia)|\d+[- ]book\s+set|omnibus|collection|boxset)\b/i.test(
          entry.title,
        )
      return !targetIsCollection && (positions.size > 1 || (entry.position ?? 0) > 1)
    }
    return (memberCount ?? 0) > 1 || (entry.position ?? 0) > 1
  })
  const authorConfirmed = !!input.author.trim()
  const primarySource = primary.snapshot.source
  const hasFantasticFiction = agreeing.some(
    (relationship) => relationship.snapshot.source === 'fantasticfiction',
  )
  const primaryAuthority = primarySource === 'author' || primarySource === 'publisher'
  // Fantastic Fiction may reveal an omission or support a review, but it never upgrades another
  // source to automatic truth. Its public pages have no supported ingestion API and the product's
  // permitted use is deliberately limited to membership/name/order evidence.
  const high =
    authorConfirmed &&
    !conflicting.length &&
    primarySource !== 'fantasticfiction' &&
    (primaryAuthority || hasSeriesContext || corroboratingSources.size >= 2)

  return {
    outcome: high ? 'found' : 'review',
    matched: true,
    series: primary.snapshot.series,
    position: primary.entry.position,
    count: primary.memberCount,
    identityConfidence: input.identityConfidence,
    membershipConfidence: high ? 'high' : 'medium',
    source: primary.snapshot.source,
    sourceRef: primary.snapshot.sourceRef,
    reason: conflicting.length
      ? 'Relational sources disagree about this book’s series; the higher-authority proposal requires administrator review.'
      : high
        ? primaryAuthority
          ? 'An author or publisher relationship contains the matched book.'
          : 'A relational catalog source contains the matched book and provides series context.'
        : hasFantasticFiction
          ? 'Fantastic Fiction surfaced or corroborated a relationship, but it remains review evidence and cannot promote the claim.'
          : 'The relationship is plausible but lacks enough independent context for automatic acceptance.',
    evidence: [...candidateEvidence, ...relationships.map((relationship) => relationship.evidence)],
  }
}
