import { admitSourceRecord, sourceTitleMatches } from './enrichAdmission'
import { normalizeIsbn } from './match'
import {
  INTAKE_EVIDENCE_VERSION,
  type IntakeClaim,
  type IntakeCredit,
  type IntakeEvidenceRequest,
  type IntakeField,
  type IntakeObservation,
  type IntakeResolution,
  type IntakeReviewReason,
} from './intakeEvidence'
import { intakeFields, parseIntakeEvidence } from './intakeEvidenceValidation'

const unique = <T>(values: T[]): T[] => [...new Set(values)]
// Comparison-only guards supplement legacy admission without changing stored identity/verdict
// keys. Strip Latin accents only: vowel signs in other scripts remain identity-bearing.
const fold = (s: string) =>
  s
    .normalize('NFKD')
    .toLowerCase()
    .replace(/(\p{Script=Latin})\p{M}+/gu, '$1')
const words = (s: string) => fold(s).match(/[\p{L}\p{N}\p{M}]+/gu) ?? []
function nameKey(s: string): string {
  const parts = s.split(',').map((p) => p.trim())
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : s
  return words(ordered.replace(/['’]/g, '')).join('|')
}
function titleFormattingSafe(title: string, record: { title: string; subtitle?: string }): boolean {
  const titleWords = (s: string) => words(s.replace(/(^|\s)&(?=\s|$)/g, '$1and'))
  const a = titleWords(title)
  return [record.title, ...(record.subtitle ? [`${record.title} ${record.subtitle}`] : [])].some(
    (t) => {
      const b = titleWords(t)
      if (a.join('') === b.join('')) return true
      const [short, long] = a.length < b.length ? [a, b] : [b, a]
      // Admission separately validates the descriptive suffix. This only guards its preserved
      // title prefix against Unicode mark collisions in the older compact comparison key.
      return short.length >= 2 && short.every((w, i) => w === long[i])
    },
  )
}
// A roleless intake name is a creator anchor, never a match against every credited person.
// Editing a whole edition does not establish authorship. Editor-led collections stay in review
// until an explicit role-aware identity handoff exists; retain their full credit arrays unchanged.
const creators = (credits: IntakeCredit[]) =>
  credits
    .filter(
      (c) => c.scope === 'whole' && ['author', 'playwright', 'original_story'].includes(c.role),
    )
    .map((c) => c.name)
const identityNames = (request: IntakeEvidenceRequest, credits: IntakeCredit[]) =>
  request.version === 2 && request.target.identityAnchors
    ? credits
        .filter(
          (c) =>
            c.scope === 'whole' &&
            request.target.identityAnchors!.some((a) => a.role === c.role) &&
            (c.role !== 'editor' || c.basis === 'edition'),
        )
        .map((c) => c.name)
    : creators(credits)
const requestedNames = (request: IntakeEvidenceRequest) =>
  request.target.identityAnchors?.map((a) => a.name) ?? request.target.contributors
const ambiguousName = (name: string): boolean => {
  const parts = name.split(',').map((p) => p.trim())
  const ordered = parts.length === 2 ? `${parts[1]} ${parts[0]}` : name
  const words = ordered.match(/\p{L}+/gu) ?? []
  if (words.length === 1 && /^\p{Script=Latin}$/u.test(words[0]!)) return true
  return words.length > 1 && words.slice(0, -1).every((w) => w.length === 1)
}
const strongSource = (o: IntakeObservation) =>
  ['publisher', 'author', 'reviewed_catalog'].includes(o.source.kind)
const originCount = (observations: IntakeObservation[]) =>
  new Set(observations.map((o) => o.source.lineage).filter((x): x is string => x !== null)).size
const supported = (observations: IntakeObservation[]) =>
  observations.some(strongSource) || originCount(observations) >= 2
const stable = (v: unknown): string => {
  if (Array.isArray(v)) return `[${v.map(stable).join(',')}]`
  if (v && typeof v === 'object')
    return `{${Object.entries(v)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([k, x]) => `${JSON.stringify(k)}:${stable(x)}`)
      .join(',')}}`
  return JSON.stringify(v)
}
const editionFields = new Set<IntakeField>([
  'pages',
  'publication',
  'publisher',
  'language',
  'format',
])

function sourceReasons(request: IntakeEvidenceRequest, o: IntakeObservation): IntakeReviewReason[] {
  const reasons: IntakeReviewReason[] = []
  if (o.status === 'failed') reasons.push('source_failed')
  if (o.status === 'capped') reasons.push('source_capped')
  if (o.targetFingerprint !== request.targetFingerprint) reasons.push('target_changed')
  const age = Date.parse(request.asOf) - Date.parse(o.source.retrievedAt)
  // Fixed review freshness window. It is policy, not a model-supplied confidence score.
  if (age < 0 || age > 30 * 86400000) reasons.push('stale_evidence')
  if (o.source.usage !== 'eligible') reasons.push('review_only_source')
  if (o.source.kind === 'unverified') reasons.push('unverified_source')
  if (o.source.method === 'model_proposal') reasons.push('model_proposal')
  return reasons
}

/** Identity comparison alone is diagnostic, never evidence qualification or permission to fill. */
function identityComparisonReasons(
  request: IntakeEvidenceRequest,
  o: IntakeObservation,
): IntakeReviewReason[] {
  const target = request.target
  const record = o.identity
  if (!record) return ['identity_incomplete']
  const names = identityNames(request, record.contributors)
  if (!names.length || !/[\p{L}\p{N}]/u.test(record.title) || names.some((n) => !/\p{L}/u.test(n)))
    return ['identity_incomplete']
  // An initialed secondary creator does not erase a separately named full creator. Initial-only
  // identity anchors still cannot establish a match; observed credits never expand initials.
  if (names.every(ambiguousName) || requestedNames(request)?.some(ambiguousName))
    return ['ambiguous_name']
  if (
    target.identityAnchors?.some(
      (a) =>
        !record.contributors.some(
          (c) =>
            c.scope === 'whole' &&
            c.role === a.role &&
            nameKey(c.name) === nameKey(a.name) &&
            (c.role !== 'editor' || (c.basis === 'edition' && record.scope === 'edition')),
        ),
    )
  )
    return ['responsibility_unreviewed']
  if (
    request.version === 2 &&
    record.contributors.some((c) => c.scope === 'whole' && c.role === 'unknown')
  )
    return ['responsibility_unreviewed']
  const isbn = normalizeIsbn(target.isbn ?? '')
  if (target.isbn && !isbn) return ['invalid_isbn']
  if (!isbn && (!target.title || !requestedNames(request)?.length)) return ['identity_incomplete']
  if (
    target.editionLocator &&
    (record.scope !== 'edition' ||
      record.isbns.length ||
      record.editionLocator?.provider !== target.editionLocator.provider ||
      record.editionLocator?.recordId !== target.editionLocator.recordId ||
      o.source.provider !== target.editionLocator.provider ||
      o.source.recordId !== target.editionLocator.recordId)
  )
    return ['edition_unresolved']
  const source = {
    title: record.title,
    subtitle: record.subtitle,
    authors: names,
    scope: record.scope,
    isbns: record.isbns,
  }
  // An unselected sibling edition may corroborate work identity, but cannot supply edition fields.
  const compared = !isbn ? { ...source, scope: 'work' as const } : source
  const authors = requestedNames(request)?.length ? requestedNames(request)! : [undefined]
  if (
    !authors.every((author) => admitSourceRecord({ title: target.title, author, isbn }, compared))
  ) {
    if (
      isbn &&
      record.isbns.some((x) => normalizeIsbn(x) === isbn) &&
      record.scope === 'edition' &&
      record.isbns.some((x) => normalizeIsbn(x) !== isbn)
    )
      return ['isbn_conflict']
    return ['identity_mismatch']
  }
  if (
    (target.title && !titleFormattingSafe(target.title, record)) ||
    requestedNames(request)?.some((author) => !names.some((n) => nameKey(n) === nameKey(author)))
  )
    return ['identity_mismatch']
  return []
}

/** Unparsed responsibility evidence is a hold, not a wrong-book diagnosis or an inferred role.
 * Keep title/name/ISBN comparison axes visible, including when another identity check fails. */
export function intakeIdentityReviewReasons(
  request: IntakeEvidenceRequest,
  o: IntakeObservation,
): IntakeReviewReason[] {
  return unique([
    ...identityComparisonReasons(request, o),
    ...(o.responsibilityStatement || o.creditStatements?.length
      ? (['responsibility_unreviewed'] as const)
      : []),
  ])
}

function claimReasons(
  c: IntakeClaim,
  o: IntakeObservation,
  editionResolved: boolean,
  audiobook: boolean,
): IntakeReviewReason[] {
  const reasons: IntakeReviewReason[] = []
  const r = o.identity!
  if (editionFields.has(c.field) && c.scope !== 'edition') reasons.push('wrong_scope')
  if (['title', 'description', 'series'].includes(c.field) && c.scope !== 'work')
    reasons.push('wrong_scope')
  if (c.scope === 'edition' && (r.scope !== 'edition' || !editionResolved))
    reasons.push('edition_unresolved')
  if (c.field === 'pages' && audiobook) reasons.push('not_applicable')
  if (c.field === 'title' && c.value !== r.title && c.value !== `${r.title} ${r.subtitle ?? ''}`)
    reasons.push('unsupported_claim')
  if (c.field === 'contributors') {
    if (stable(c.value) !== stable(r.contributors)) reasons.push('unsupported_claim')
    if (c.value.some((x) => x.role === 'unknown')) reasons.push('unsupported_claim')
    if (c.scope === 'work' && c.value.some((x) => ['translator', 'narrator'].includes(x.role)))
      reasons.push('wrong_scope')
    if (c.scope === 'edition' && c.value.some((x) => x.basis === 'work'))
      reasons.push('credit_scope_unverified')
  }
  if (c.field === 'series') {
    const member = c.value
    if (
      member.relationship !== 'explicit_membership' ||
      !member.memberContributors.length ||
      member.memberContributors.some(ambiguousName) ||
      !titleFormattingSafe(member.memberTitle, r) ||
      member.memberContributors.some(
        (author) => !creators(r.contributors).some((n) => nameKey(n) === nameKey(author)),
      ) ||
      !member.memberContributors.every((author) =>
        admitSourceRecord(
          { title: member.memberTitle, author },
          {
            title: r.title,
            subtitle: r.subtitle,
            authors: creators(r.contributors),
            scope: 'work',
          },
        ),
      )
    )
      reasons.push('relationship_unverified')
  }
  return unique(reasons)
}

/** Compare only the title axis. Joint admission would blame a title for an unrelated ISBN/name
 * failure and, without an author argument, misreport accepted edition-formatting alternatives.
 * Details are fixed codes: no provider text, tokens, hashes or fragments enter durable reports. */
function titleDiagnostics(request: IntakeEvidenceRequest, o: IntakeObservation) {
  const t = request.target
  const r = o.identity
  if (!t.title) return { title: 'not_requested', titleDetail: 'not_requested' } as const
  if (!r) return { title: 'missing', titleDetail: 'not_observed' } as const
  if (t.title === r.title) return { title: 'exact', titleDetail: 'literal' } as const
  const safe = titleFormattingSafe(t.title, r)
  // The shared helper compares titles only; it does not select or certify an edition.
  const record = { title: r.title, subtitle: r.subtitle, authors: [] }
  if (sourceTitleMatches(t.title, record)) {
    if (!safe) return { title: 'mismatch', titleDetail: 'significant_marks' } as const
    return {
      title: 'formatting',
      titleDetail: sourceTitleMatches(t.title, { ...record, subtitle: undefined })
        ? 'normalized'
        : 'declared_subtitle',
    } as const
  }
  if (sourceTitleMatches(t.title, record, true)) {
    if (!safe) return { title: 'mismatch', titleDetail: 'significant_marks' } as const
    const isbn = normalizeIsbn(t.isbn ?? '')
    const editionContext =
      !!isbn &&
      r.scope === 'edition' &&
      r.isbns.length > 0 &&
      r.isbns.every((value) => normalizeIsbn(value) === isbn) &&
      !!requestedNames(request)?.length &&
      !requestedNames(request)!.some(ambiguousName)
    return editionContext
      ? ({ title: 'formatting', titleDetail: 'edition_formatting' } as const)
      : ({ title: 'mismatch', titleDetail: 'unconfirmed_edition_formatting' } as const)
  }
  const a = words(t.title)
  const additionalWords = [r.title, ...(r.subtitle ? [`${r.title} ${r.subtitle}`] : [])].some(
    (candidate) => {
      const b = words(candidate)
      const [short, long] = a.length < b.length ? [a, b] : [b, a]
      return short.length >= 2 && short.length < long.length && short.every((w, i) => w === long[i])
    },
  )
  // Structural difference only: extra words do not diagnose a wrong book or a safe subtitle.
  return {
    title: 'mismatch',
    titleDetail: additionalWords ? 'additional_words' : 'different_words',
  } as const
}

/** Diagnostic axes only. They never relax admission or authorize a saved fact. */
export function intakeIdentityDiagnostics(request: IntakeEvidenceRequest, o: IntakeObservation) {
  const r = o.identity,
    t = request.target
  const names = r ? identityNames(request, r.contributors) : []
  const isbn = normalizeIsbn(t.isbn ?? '')
  return {
    responsibility:
      o.responsibilityStatement || o.creditStatements?.length ? 'unreviewed' : 'not_observed',
    ...titleDiagnostics(request, o),
    isbn: !t.isbn
      ? 'not_requested'
      : !isbn
        ? 'invalid'
        : !r?.isbns.length
          ? 'missing'
          : r.isbns.every((x) => normalizeIsbn(x) === isbn)
            ? 'exact'
            : 'conflict',
    contributors: (requestedNames(request) ?? []).map((name, index) => {
      const anchor = t.identityAnchors?.[index]
      const relevantNames = anchor
        ? (r?.contributors
            .filter(
              (c) =>
                c.scope === 'whole' &&
                c.role === anchor.role &&
                (c.role !== 'editor' || c.basis === 'edition'),
            )
            .map((c) => c.name) ?? [])
        : names
      if (ambiguousName(name)) return 'ambiguous'
      if (relevantNames.some((n) => n === name)) return 'exact'
      if (relevantNames.some((n) => nameKey(n) === nameKey(name))) return 'formatting'
      const other = r?.contributors.filter((c) => nameKey(c.name) === nameKey(name)) ?? []
      if (other.some((c) => c.role === 'unknown')) return 'unknown_role'
      if (other.some((c) => c.scope === 'part')) return 'part_only'
      if (other.length) return 'secondary_role_only'
      return r ? 'mismatch' : 'missing'
    }),
    reasons: intakeIdentityReviewReasons(request, o),
  }
}

function sameObservedWork(
  a: IntakeObservation,
  b: IntakeObservation,
  isbn: string,
  request: IntakeEvidenceRequest,
): boolean {
  const agrees = (left: IntakeObservation, right: IntakeObservation): boolean => {
    const l = left.identity!
    const r = right.identity!
    const title = l.subtitle ? `${l.title} ${l.subtitle}` : l.title
    if (!titleFormattingSafe(title, r)) return false
    const names = (credits: IntakeCredit[]) => creators(credits)
    // A union of creator/editor names would conceal swapped responsibility roles.
    for (const role of request.version === 2
      ? (['author', 'playwright', 'original_story', 'editor'] as const)
      : []) {
      const roleNames = (credits: IntakeCredit[]) =>
        credits
          .filter(
            (c) =>
              c.scope === 'whole' &&
              c.role === role &&
              (role !== 'editor' || c.basis === 'edition'),
          )
          .map((c) => nameKey(c.name))
          .sort()
      if (stable(roleNames(l.contributors)) !== stable(roleNames(r.contributors))) return false
    }
    return names(l.contributors).every(
      (author) =>
        names(r.contributors).some((n) => nameKey(n) === nameKey(author)) &&
        admitSourceRecord(
          { title, author, isbn },
          {
            title: r.title,
            subtitle: r.subtitle,
            authors: names(r.contributors),
            scope: isbn ? r.scope : 'work',
            isbns: r.isbns,
          },
        ),
    )
  }
  // Check both directions: a shared coauthor must not collapse two different creator sets.
  return agrees(a, b) && agrees(b, a)
}

/** Deterministic, side-effect-free review. No acquisition, writes, personal data or model calls.
 * This is deliberately not an Incoming/Book: callers cannot pass it to existing intake writers. */
export function resolveIntakeEvidence(input: unknown): IntakeResolution {
  const request = parseIntakeEvidence(input)
  const isbn = normalizeIsbn(request.target.isbn ?? '')
  const observations = request.observations.map((o) => ({
    id: o.id,
    reasons: unique([
      ...sourceReasons(request, o),
      ...(o.status === 'ok' ? intakeIdentityReviewReasons(request, o) : []),
    ]),
  }))
  const decisions = new Map(observations.map((o) => [o.id, o]))
  const matches = request.observations.filter(
    (o) => o.status === 'ok' && !decisions.get(o.id)!.reasons.length,
  )
  // Reuse bounded admission pairwise instead of raw string signatures (which falsely split
  // surname-first/descriptive-title variants). A query naming one shared coauthor cannot hide
  // competing complete creator sets, even if both candidates separately match that query.
  const competing = matches.some((a, i) =>
    matches.slice(i + 1).some((b) => !sameObservedWork(a, b, isbn, request)),
  )
  const isbnContradiction =
    !!isbn &&
    request.observations.some(
      (o) =>
        o.status === 'ok' &&
        !sourceReasons(request, o).length &&
        o.identity!.isbns.some((x) => normalizeIsbn(x) === isbn) &&
        intakeIdentityReviewReasons(request, o).some((r) => r !== 'responsibility_unreviewed'),
    )
  const workReasons: IntakeReviewReason[] = []
  if (request.existing.title !== undefined || request.existing.contributors !== undefined) {
    const existingNames = request.existing.contributors
      ? identityNames(request, request.existing.contributors)
      : requestedNames(request)
    const existingRequest: IntakeEvidenceRequest = {
      ...request,
      target: {
        ...request.target,
        title: request.existing.title ?? request.target.title,
        ...(request.target.identityAnchors
          ? {
              identityAnchors: request.existing.contributors
                ? request.existing.contributors
                    .filter(
                      (c) =>
                        c.scope === 'whole' &&
                        (['author', 'playwright', 'original_story'].includes(c.role) ||
                          request.target.identityAnchors!.some((a) => a.role === c.role)),
                    )
                    .map((c) => ({
                      name: c.name,
                      role: c.role as NonNullable<
                        IntakeEvidenceRequest['target']['identityAnchors']
                      >[number]['role'],
                    }))
                : request.target.identityAnchors,
            }
          : { contributors: existingNames }),
      },
    }
    if (
      (request.existing.contributors !== undefined && !existingNames?.length) ||
      request.existing.contributors?.some((c) => c.scope === 'whole' && c.role === 'unknown') ||
      matches.some((o) => intakeIdentityReviewReasons(existingRequest, o).length > 0)
    )
      workReasons.push('existing_identity_conflict')
  }
  if (request.target.isbn && !isbn) workReasons.push('invalid_isbn')
  if (competing) workReasons.push('competing_identities')
  if (isbnContradiction) workReasons.push('isbn_conflict')
  if (!matches.length)
    workReasons.push(...observations.flatMap((o) => o.reasons), 'identity_incomplete')
  // ISBN-only captures need independently supported identity, not a self-confirming query echo.
  if (matches.length && !supported(matches)) workReasons.push('insufficient_support')
  const workResolved = matches.length > 0 && !workReasons.length
  const editionMatches = matches.filter(
    (o) =>
      o.identity!.scope === 'edition' &&
      (isbn
        ? o.identity!.isbns.length > 0 && o.identity!.isbns.every((x) => normalizeIsbn(x) === isbn)
        : !!request.target.editionLocator &&
          !o.identity!.isbns.length &&
          o.identity!.editionLocator?.provider === request.target.editionLocator.provider &&
          o.identity!.editionLocator?.recordId === request.target.editionLocator.recordId),
  )
  const editionReasons: IntakeReviewReason[] = []
  if (!workResolved || !editionMatches.length || !supported(editionMatches))
    editionReasons.push('edition_unresolved')
  const editionClaims = editionMatches.flatMap((o) =>
    o.claims.filter(
      (c) => c.scope === 'edition' && (c.field === 'format' || c.field === 'language'),
    ),
  )
  for (const field of ['format', 'language'] as const) {
    const values = unique(
      editionClaims.filter((c) => c.field === field).map((c) => stable(c.value)),
    )
    const expected = request.target[field] ?? request.existing[field]
    if (values.length > 1 || (expected !== undefined && values.some((v) => v !== stable(expected))))
      editionReasons.push('edition_conflict')
  }
  const editionResolved = !editionReasons.length
  const audiobook =
    request.target.format === 'audiobook' ||
    request.existing.format === 'audiobook' ||
    editionClaims.some((c) => c.field === 'format' && c.value === 'audiobook')
  const claims = request.observations.flatMap((o) =>
    o.claims.map((c) => {
      const reasons = unique([
        ...decisions.get(o.id)!.reasons,
        ...(!workResolved ? workReasons : []),
        ...claimReasons(c, o, editionResolved, audiobook),
      ])
      return {
        observationId: o.id,
        claimId: c.id,
        field: c.field,
        state: reasons.length ? ('review' as const) : ('supported' as const),
        reasons,
      }
    }),
  )
  const fields = intakeFields.map((field) => {
    const all = claims.filter((c) => c.field === field)
    const eligible = all.filter((c) => c.state === 'supported')
    const refs = eligible.map((c) => {
      const o = request.observations.find((o) => o.id === c.observationId)!
      return { o, c: o.claims.find((x) => x.id === c.claimId)! }
    })
    const values = unique(refs.map(({ c }) => stable(c.value)))
    const evidence = all.map((c) => ({ observationId: c.observationId, claimId: c.claimId }))
    const reasons = unique(all.flatMap((c) => c.reasons))
    const current = request.existing[field]
    const proposed = refs[0]?.c.value
    const enough = supported(refs.map(({ o }) => o))
    const conflict =
      values.length > 1 || (current !== undefined && values.some((v) => v !== stable(current)))
    if (conflict) reasons.push('field_conflict')
    if (eligible.length && !enough) reasons.push('insufficient_support')
    if (current !== undefined) reasons.push('existing_value')
    const state =
      current !== undefined
        ? conflict
          ? ('review' as const)
          : ('preserved' as const)
        : eligible.length && enough && !conflict
          ? ('proposed' as const)
          : all.length
            ? ('review' as const)
            : ('missing' as const)
    return {
      field,
      state,
      ...(current !== undefined ? { current } : {}),
      ...(state === 'proposed' ? { proposed } : {}),
      evidence,
      independentOrigins: originCount(refs.map(({ o }) => o)),
      reasons: unique(reasons),
    }
  })
  return {
    version: INTAKE_EVIDENCE_VERSION,
    mode: 'review_only',
    targetFingerprint: request.targetFingerprint,
    request,
    work: {
      state: workResolved
        ? 'resolved'
        : request.observations.some((o) => o.status !== 'empty')
          ? 'review'
          : 'unresolved',
      observationIds: matches.map((o) => o.id),
      reasons: unique(workReasons),
    },
    edition: {
      state: editionResolved
        ? 'resolved'
        : request.target.isbn || request.target.editionLocator
          ? 'review'
          : 'unknown',
      isbn: editionResolved && isbn ? isbn : null,
      reasons: unique(editionReasons),
    },
    acquisition: {
      complete:
        request.observations.length > 0 &&
        !request.observations.some((o) => o.status === 'failed' || o.status === 'capped'),
      empty: request.observations.filter((o) => o.status === 'empty').length,
      failed: request.observations.filter((o) => o.status === 'failed').length,
      capped: request.observations.filter((o) => o.status === 'capped').length,
    },
    observations,
    claims,
    fields,
  }
}
