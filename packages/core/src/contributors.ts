// Ordered, multi-contributor authorship (docs/reference/DATA_MODEL.md). A book carries an ordered list of
// contributors (authors, co-authors, translators, illustrators, narrators, editors). The single
// author_first/author_last on the book stays as the denormalized PRIMARY author (back-compat); it
// mirrors the first author-role contributor. These helpers are pure so byline formatting, name
// dedupe, and contributor-list reconciliation on merge are all unit-tested.

import type { Contributor, ContributorRole } from './types'

export const CONTRIBUTOR_ROLES: ContributorRole[] = [
  'author',
  'co_author',
  'translator',
  'illustrator',
  'narrator',
  'editor',
]

/** Human label for a role (UI). */
export const ROLE_LABELS: Record<ContributorRole, string> = {
  author: 'Author',
  co_author: 'Co-author',
  translator: 'Translator',
  illustrator: 'Illustrator',
  narrator: 'Narrator',
  editor: 'Editor',
}

/** Subtle byline suffix for non-author roles (author/co-author shown plainly). */
const ROLE_ABBR: Partial<Record<ContributorRole, string>> = {
  translator: 'tr.',
  illustrator: 'ill.',
  narrator: 'narr.',
  editor: 'ed.',
}

const AUTHORING: ContributorRole[] = ['author', 'co_author']
export const isAuthorRole = (r: ContributorRole): boolean => r === 'author' || r === 'co_author'

export const isContributorRole = (s: string): s is ContributorRole =>
  (CONTRIBUTOR_ROLES as string[]).includes(s)

/** Dedupe key for a name: lowercased, collapsed whitespace. "Ana  Huang" === "ana huang". */
export const normalizeName = (name: string): string =>
  (name ?? '').trim().toLowerCase().replace(/\s+/g, ' ')

/** Split a display name into given/family parts for the back-compat first/last columns.
 *  Single-token names become the last name (the prototype keyed matching on `last`). */
export function splitName(name: string): { first: string; last: string } {
  const parts = (name ?? '').trim().split(/\s+/).filter(Boolean)
  if (parts.length === 0) return { first: '', last: '' }
  if (parts.length === 1) return { first: '', last: parts[0]! }
  const familyStart =
    parts.length >= 3 && /^st[.]?$/i.test(parts[parts.length - 2]!)
      ? parts.length - 2
      : parts.length - 1
  return { first: parts.slice(0, familyStart).join(' '), last: parts.slice(familyStart).join(' ') }
}

/** Join first/last back into a display name. */
export const joinName = (first: string, last: string): string =>
  [first, last].filter(Boolean).join(' ').trim()

/** Order by position, defensively (callers may pass an unsorted list). */
const ordered = (cs: readonly Contributor[]): Contributor[] =>
  [...cs].sort((a, b) => a.position - b.position)

/** The primary author: the first (by position) author/co-author, else the first contributor. */
export function primaryAuthor(contributors: readonly Contributor[]): Contributor | null {
  if (!contributors.length) return null
  const sorted = ordered(contributors)
  return sorted.find((c) => isAuthorRole(c.role)) ?? sorted[0]!
}

/** Back-compat first/last from a contributor list (the primary author's name). */
export function toFirstLast(contributors: readonly Contributor[]): { first: string; last: string } {
  const primary = primaryAuthor(contributors)
  return primary ? splitName(primary.name) : { first: '', last: '' }
}

/** A single primary author (first/last) as a one-element contributor list (empty if no name). */
export function fromFirstLast(first: string, last: string): Contributor[] {
  const name = joinName(first, last)
  return name ? [{ name, role: 'author', position: 0 }] : []
}

/**
 * Map an ordered list of author names (e.g. enrichment's authors[]) to contributors: the first is
 * the primary `author`, the rest are `co_author`. Optional role overrides by name let a source that
 * knows roles (e.g. Hardcover translators/narrators) tag specific contributors.
 */
export function contributorsFromAuthors(
  names: readonly string[],
  roles?: Record<string, ContributorRole>,
): Contributor[] {
  return names
    .map((n) => n.trim())
    .filter(Boolean)
    .map((name, i) => ({
      name,
      role: roles?.[normalizeName(name)] ?? (i === 0 ? 'author' : 'co_author'),
      position: i,
    }))
}

/** Renumber positions 0..n-1 in current order (after an insert/remove/reorder). */
export const renumber = (cs: readonly Contributor[]): Contributor[] =>
  ordered(cs).map((c, i) => ({ ...c, position: i }))

/** Just the author/co-author names, "A", "A & B", or "A, B & C" (no "by", no other roles). */
export function formatAuthors(contributors: readonly Contributor[]): string {
  const authors = ordered(contributors)
    .filter((c) => isAuthorRole(c.role))
    .map((c) => c.name)
  if (authors.length <= 1) return authors[0] ?? ''
  if (authors.length === 2) return `${authors[0]} & ${authors[1]}`
  return `${authors.slice(0, -1).join(', ')} & ${authors[authors.length - 1]}`
}

/**
 * "by A, B & C" — author/co-author names first, with non-author roles appended subtly
 * (", tr. X", ", ill. Y"). Returns '' when there are no contributors.
 */
export function formatByline(contributors: readonly Contributor[]): string {
  const main = formatAuthors(contributors)
  const extra = ordered(contributors)
    .filter((c) => !isAuthorRole(c.role))
    .map((c) => `${ROLE_ABBR[c.role] ?? ''} ${c.name}`.trim())
  const parts = [main, ...extra].filter(Boolean)
  if (!parts.length) return ''
  return `by ${parts.join(', ')}`
}

/**
 * Reconcile contributor lists on merge: keep the existing list (user edits win) and APPEND any
 * incoming contributors not already present (matched by normalized name + role), preserving order,
 * then renumber. Additive — never drops or reorders a curated contributor. Idempotent.
 */
export function reconcileContributors(
  existing: readonly Contributor[],
  incoming: readonly Contributor[],
): Contributor[] {
  const have = new Set(existing.map((c) => `${normalizeName(c.name)}|${c.role}`))
  const merged = [...ordered(existing)]
  for (const c of ordered(incoming)) {
    const key = `${normalizeName(c.name)}|${c.role}`
    if (c.name.trim() && !have.has(key)) {
      have.add(key)
      merged.push(c)
    }
  }
  return renumber(merged)
}

/** Did reconciliation change the list (new contributors added)? */
export const contributorsChanged = (
  existing: readonly Contributor[],
  next: readonly Contributor[],
): boolean =>
  existing.length !== next.length ||
  next.some((c, i) => {
    const e = existing[i]
    return !e || normalizeName(e.name) !== normalizeName(c.name) || e.role !== c.role
  })

export { AUTHORING }
