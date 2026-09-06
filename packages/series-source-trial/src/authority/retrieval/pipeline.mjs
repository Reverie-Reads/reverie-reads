import {
  authorityPolicyForRetrievedSource,
  canonicalizeAuthorityAcquisition,
  validateAuthorityAcquisition,
} from '../evidence.mjs'
import { normalize } from '../../normalize.mjs'
import { retrieveAuthorityNavigation, redactRetrievalResult } from './gateway.mjs'
import { interpretRetrievedAuthorityEvidence } from './interpret.mjs'
import { profileForConsultedUrl } from './profile.mjs'

const kindPriority = new Map([
  ['author', 0],
  ['author_post', 1],
  ['publisher', 2],
  ['publisher_catalog', 3],
])

const pathDepth = (value) => {
  const url = new URL(value)
  return url.pathname.split('/').filter(Boolean).length
}

const navigationHubPaths = new Set([
  'all-books',
  'bibliography',
  'book-list',
  'books',
  'catalog',
  'publications',
  'reading-order',
  'series',
  'titles',
  'works',
])

const navigationParentPriority = (value) => {
  const segments = new URL(value).pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => normalize(segment).replace(/ /g, '-'))
  if (segments.length === 1 && navigationHubPaths.has(segments[0])) return 0
  if (segments.length === 0) return 1
  return 2
}

const phraseOccurs = (text, value) => {
  const haystack = ` ${normalize(text)} `
  const needle = normalize(value)
  return Boolean(needle) && haystack.includes(` ${needle} `)
}

const authorOccurs = (text, authors) =>
  (authors ?? []).some((author) => {
    if (phraseOccurs(text, author)) return true
    const lastName = normalize(author).split(' ').filter(Boolean).at(-1)
    return lastName?.length > 2 && phraseOccurs(text, lastName)
  })

const evidenceLines = (text) =>
  String(text ?? '')
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

const bibliographicRelationshipOccurs = (text) =>
  /\b(?:series|trilogy|duology|collection|saga|cycle)\b/i.test(text)

const directMembershipLine = (target, membership, retrieval) =>
  evidenceLines(retrieval?.evidenceText).find(
    (line) =>
      !/^(?:TITLE|H[1-6]):/i.test(line) &&
      phraseOccurs(line, target?.target?.title) &&
      phraseOccurs(line, membership?.series) &&
      bibliographicRelationshipOccurs(line),
  )

const directStandaloneLine = (target, retrieval) =>
  evidenceLines(retrieval?.evidenceText).find(
    (line) =>
      !/^(?:TITLE|H[1-6]):/i.test(line) &&
      phraseOccurs(line, target?.target?.title) &&
      /\bstand[ -]?alone\b/i.test(line),
  )

const ordinalWords = new Map([
  [1, ['one', 'first']],
  [2, ['two', 'second']],
  [3, ['three', 'third']],
  [4, ['four', 'fourth']],
  [5, ['five', 'fifth']],
  [6, ['six', 'sixth']],
  [7, ['seven', 'seventh']],
  [8, ['eight', 'eighth']],
  [9, ['nine', 'ninth']],
  [10, ['ten', 'tenth']],
])

const explicitPositionOccurs = (text, position) => {
  const forms = [String(position), ...(ordinalWords.get(position) ?? [])].map(normalize)
  return (
    (Number.isInteger(position) && new RegExp(`#\\s*${position}\\b`).test(text)) ||
    forms.some((form) =>
      [
        `book ${form}`,
        `book number ${form}`,
        `volume ${form}`,
        `volume number ${form}`,
        `${form} book`,
        `${form} novel`,
        `${form} volume`,
      ].some((phrase) => phraseOccurs(text, phrase)),
    )
  )
}

export const evidencePacketContainsTargetTitle = (target, retrieval) =>
  phraseOccurs(retrieval?.evidenceText, target?.target?.title)

export const evidencePacketContainsTargetIdentity = (target, retrieval) =>
  evidencePacketContainsTargetTitle(target, retrieval) &&
  authorOccurs(retrieval?.evidenceText, target?.target?.authors)

export function canonicalizeRetrievedAuthoritySemantics(target, output, retrieval) {
  if (!output || typeof output !== 'object' || !Array.isArray(output.memberships)) return output
  const memberships = output.memberships.map((membership) => {
    if (!membership || typeof membership !== 'object') return membership
    const relationshipLine = directMembershipLine(target, membership, retrieval)
    const position =
      membership.position === null ||
      !Number.isFinite(membership.position) ||
      (relationshipLine && explicitPositionOccurs(relationshipLine, membership.position))
        ? membership.position
        : null
    const role =
      ['primary', 'secondary'].includes(membership.role) &&
      (!relationshipLine || !phraseOccurs(relationshipLine, membership.role))
        ? 'unknown'
        : membership.role
    return { ...membership, position, role }
  })
  const hasExplicitPosition = memberships.some((membership) =>
    Number.isFinite(membership?.position),
  )
  return {
    ...output,
    memberships,
    authoritySources: Array.isArray(output.authoritySources)
      ? output.authoritySources.map((source) =>
          source && typeof source === 'object' && !hasExplicitPosition
            ? {
                ...source,
                supports: Array.isArray(source.supports)
                  ? source.supports.filter((support) => support !== 'position')
                  : source.supports,
              }
            : source,
        )
      : output.authoritySources,
  }
}

export function validateRetrievedAuthoritySemantics(target, output, retrieval, validation) {
  const violations = [...(validation.policyViolations ?? [])]
  if (!output || typeof output !== 'object') return validation
  const text = retrieval.evidenceText
  const resolved = output.classification !== 'unresolved' || output.identity?.matched
  if (resolved && !evidencePacketContainsTargetTitle(target, retrieval)) {
    violations.push('retrieved packet does not contain the exact target title')
  }
  if (resolved && !authorOccurs(text, target.target.authors)) {
    violations.push('retrieved packet does not contain a target author identity')
  }
  const memberships = Array.isArray(output.memberships) ? output.memberships : []
  for (const [index, membership] of memberships.entries()) {
    if (!membership || typeof membership !== 'object') continue
    const relationshipLine = directMembershipLine(target, membership, retrieval)
    if (!relationshipLine) {
      violations.push(`membership ${index} lacks a same-line exact-work bibliographic relationship`)
    }
    if (
      membership.position !== null &&
      (!relationshipLine || !explicitPositionOccurs(relationshipLine, membership.position))
    ) {
      violations.push(`membership ${index} position is not explicit in the retrieved packet`)
    }
  }
  if (output.classification === 'standalone' && !directStandaloneLine(target, retrieval)) {
    violations.push('standalone claim lacks a same-line exact-work statement')
  }
  return {
    ...validation,
    policySafe: validation.valid && violations.length === 0,
    policyViolations: [...new Set(violations)],
  }
}

export function selectRetrievalParent(consultedUrls, profiles, now = new Date()) {
  const eligible = []
  let blocked = false
  for (const consultedUrl of consultedUrls ?? []) {
    const inspected = profileForConsultedUrl(consultedUrl, profiles, now)
    if (!inspected.eligible) {
      if (inspected.reason === 'origin_blocked') blocked = true
      continue
    }
    eligible.push({ consultedUrl, profile: inspected.profile })
  }
  eligible.sort(
    (left, right) =>
      (kindPriority.get(left.profile.sourceKind) ?? 99) -
        (kindPriority.get(right.profile.sourceKind) ?? 99) ||
      navigationParentPriority(left.consultedUrl) - navigationParentPriority(right.consultedUrl) ||
      pathDepth(left.consultedUrl) - pathDepth(right.consultedUrl) ||
      left.consultedUrl.localeCompare(right.consultedUrl),
  )
  if (!eligible.length) {
    return { status: 'skipped', reason: blocked ? 'origin_blocked' : 'origin_pending' }
  }
  return { status: 'selected', ...eligible[0] }
}

export const shouldAttemptAuthorityRetrieval = (firstPass) =>
  firstPass?.status === 'completed' &&
  (firstPass.output?.classification === 'unresolved' || !firstPass.validation?.policySafe)

const firstPassSourceManifest = (firstPass) => ({
  kind: 'hosted_search',
  urls: [...(firstPass?.consultedUrls ?? [])],
})

export async function augmentAuthorityAcquisition(
  target,
  firstPass,
  {
    profiles = [],
    policy = {},
    now = new Date(),
    retrieve = retrieveAuthorityNavigation,
    interpret = interpretRetrievedAuthorityEvidence,
    retrieveOptions = {},
    interpretOptions = {},
  } = {},
) {
  if (!shouldAttemptAuthorityRetrieval(firstPass)) {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: { status: 'skipped', reason: 'first_pass_resolved', reviewOnly: true },
    }
  }

  const selected = selectRetrievalParent(firstPass.consultedUrls, profiles, now)
  if (selected.status !== 'selected') {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: { ...selected, reviewOnly: true },
    }
  }

  let retrieval
  try {
    retrieval = await retrieve(
      {
        caseId: target.caseId,
        title: target.target.title,
        author: target.target.authors.join(', '),
        publicationYear: target.target.publicationYear,
        consultedUrl: selected.consultedUrl,
        consultedUrls: firstPass.consultedUrls,
      },
      { ...retrieveOptions, profiles, now },
    )
  } catch {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: { status: 'unresolved', reason: 'internal_error', reviewOnly: true },
    }
  }
  const persistedRetrieval = redactRetrievalResult(retrieval)
  if (retrieval.status !== 'retrieved') {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: persistedRetrieval,
    }
  }

  if (!evidencePacketContainsTargetIdentity(target, retrieval)) {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: persistedRetrieval,
      retrievalInterpretation: {
        status: 'skipped',
        reason: 'target_identity_absent',
        cached: false,
      },
    }
  }

  try {
    const interpreted = await interpret(target, retrieval, interpretOptions)
    const source = {
      url: retrieval.manifest.childFinalUrl,
      sourceKind: retrieval.manifest.sourceKind,
    }
    const retrievalPolicy = authorityPolicyForRetrievedSource(policy, source)
    const output = canonicalizeRetrievedAuthoritySemantics(
      target,
      canonicalizeAuthorityAcquisition(interpreted.output, [source.url], retrievalPolicy),
      retrieval,
    )
    const validation = validateRetrievedAuthoritySemantics(
      target,
      output,
      retrieval,
      validateAuthorityAcquisition(target, output, [source.url], retrievalPolicy),
    )
    const useRetrieval = validation.valid && validation.policySafe
    return {
      ...firstPass,
      ...(useRetrieval ? { output, validation } : {}),
      selectedPass: useRetrieval ? 'retrieval' : 'first',
      selectedSourceManifest: useRetrieval
        ? { kind: 'retrieval', urls: [source.url] }
        : firstPassSourceManifest(firstPass),
      retrieval: persistedRetrieval,
      retrievalInterpretation: {
        ...interpreted,
        sourceManifestUrls: [source.url],
        output,
        validation,
        cached: interpreted.cached ?? false,
      },
    }
  } catch (error) {
    return {
      ...firstPass,
      selectedPass: 'first',
      selectedSourceManifest: firstPassSourceManifest(firstPass),
      retrieval: persistedRetrieval,
      retrievalInterpretation: {
        status: 'error',
        error: String(error),
        cached: false,
      },
    }
  }
}
