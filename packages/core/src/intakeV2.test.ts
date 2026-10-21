import { expect, it } from 'vitest'
import { resolveIntakeEvidence } from './intakeResolver'
import type { IntakeEvidenceRequest } from './intakeEvidence'

function packet(): IntakeEvidenceRequest {
  return {
    version: 2,
    targetFingerprint: 'a'.repeat(32),
    asOf: '2026-10-20T12:00:00Z',
    target: {
      title: 'Collected Stories',
      identityAnchors: [{ name: 'Jane Smith', role: 'editor' }],
      isbn: '9780306406157',
    },
    existing: {},
    observations: [
      {
        id: 'publisher',
        targetFingerprint: 'a'.repeat(32),
        status: 'ok',
        source: {
          provider: 'synthetic',
          recordId: 'edition-1',
          url: 'https://publisher.example/book',
          retrievedAt: '2026-10-20T12:00:00Z',
          lineage: 'publisher:edition-1',
          kind: 'publisher',
          usage: 'eligible',
          method: 'inspected',
        },
        identity: {
          title: 'Collected Stories',
          contributors: [{ name: 'Jane Smith', role: 'editor', scope: 'whole', basis: 'edition' }],
          scope: 'edition',
          isbns: ['9780306406157'],
        },
        claims: [
          { id: 'pages', field: 'pages', value: 250, scope: 'edition', locator: 'Edition details' },
        ],
      },
    ],
  }
}
it('admits an explicit full-name editor anchor without relabelling the credit as an author', () => {
  const result = resolveIntakeEvidence(packet())
  expect(result.work.state).toBe('resolved')
  expect(result.edition.state).toBe('resolved')
  expect(result.fields.find((f) => f.field === 'pages')?.state).toBe('proposed')
  expect(result.request.observations[0]?.identity?.contributors[0]?.role).toBe('editor')
})
it.each(['author', 'unknown', 'introduction'] as const)(
  'holds a different or ambiguous observed role: %s',
  (role) => {
    const p = packet()
    p.observations[0]!.identity!.contributors[0]!.role = role
    expect(resolveIntakeEvidence(p).work.state).toBe('review')
  },
)
it('retains creator-only legacy targets, part and work-basis holds, and exact ISBN checks', () => {
  const legacy = packet()
  legacy.version = 1
  legacy.target = {
    title: 'Collected Stories',
    contributors: ['Jane Smith'],
    isbn: '9780306406157',
  }
  expect(resolveIntakeEvidence(legacy).work.state).toBe('review')
  const p = packet()
  p.observations[0]!.identity!.contributors[0]!.basis = 'work'
  expect(resolveIntakeEvidence(p).work.state).toBe('review')
  const wrong = packet()
  wrong.observations[0]!.identity!.isbns = ['9781649374042']
  expect(resolveIntakeEvidence(wrong).work.state).toBe('review')
  const part = packet()
  Object.assign(part.observations[0]!.identity!.contributors[0]!, {
    scope: 'part',
    part: 'One story',
  })
  expect(resolveIntakeEvidence(part).work.state).toBe('review')
})
it('holds initial-only anchors and conflicting existing contributors', () => {
  const p = packet()
  p.target.identityAnchors![0]!.name = 'J. Smith'
  expect(resolveIntakeEvidence(p).work.reasons).toContain('ambiguous_name')
  const old = packet()
  old.existing.contributors = [
    { name: 'Mary Brown', role: 'editor', scope: 'whole', basis: 'edition' },
  ]
  expect(resolveIntakeEvidence(old).work.reasons).toContain('existing_identity_conflict')
})
it('resolves an explicitly selected ISBN-less edition only at its exact provider locator', () => {
  const p = packet()
  delete p.target.isbn
  p.target.editionLocator = { provider: 'synthetic', recordId: 'edition-1' }
  p.observations[0]!.identity!.isbns = []
  p.observations[0]!.identity!.editionLocator = { ...p.target.editionLocator }
  expect(resolveIntakeEvidence(p).edition).toMatchObject({ state: 'resolved', isbn: null })
  p.observations[0]!.source.recordId = 'different-edition'
  expect(resolveIntakeEvidence(p).edition.state).toBe('review')
})
it('rejects mixed or legacy role-aware identity documents', () => {
  const p = packet()
  p.target.contributors = ['Jane Smith']
  expect(() => resolveIntakeEvidence(p)).toThrow()
  const old = packet()
  old.version = 1
  expect(() => resolveIntakeEvidence(old)).toThrow()
})

it('keeps creator and editor sets distinct when providers swap their roles', () => {
  const p = packet()
  const peer = structuredClone(p.observations[0]!)
  peer.id = 'peer'
  peer.source.lineage = 'peer:edition'
  p.observations[0]!.identity!.contributors.push(
    { name: 'Alice Brown', role: 'author', scope: 'whole', basis: 'edition' },
    { name: 'Robert Jones', role: 'editor', scope: 'whole', basis: 'edition' },
  )
  peer.identity!.contributors.push(
    { name: 'Robert Jones', role: 'author', scope: 'whole', basis: 'edition' },
    { name: 'Alice Brown', role: 'editor', scope: 'whole', basis: 'edition' },
  )
  p.observations.push(peer)
  expect(resolveIntakeEvidence(p).work.reasons).toContain('competing_identities')
})
it('an explicit editor anchor cannot erase an existing creator', () => {
  const p = packet()
  p.existing.contributors = [
    { name: 'Jane Smith', role: 'editor', scope: 'whole', basis: 'edition' },
    { name: 'Alice Brown', role: 'author', scope: 'whole' },
  ]
  expect(resolveIntakeEvidence(p).work.reasons).toContain('existing_identity_conflict')
  const unknown = packet()
  unknown.existing.contributors = [
    { name: 'Jane Smith', role: 'editor', scope: 'whole', basis: 'edition' },
    { name: 'Alice Brown', role: 'unknown', scope: 'whole' },
  ]
  expect(resolveIntakeEvidence(unknown).work.reasons).toContain('existing_identity_conflict')
})

it('holds a lone Latin initial without treating a single CJK name as an initial', () => {
  const p = packet()
  p.target.identityAnchors![0]!.name = 'J.'
  p.observations[0]!.identity!.contributors[0]!.name = 'J.'
  expect(resolveIntakeEvidence(p).work.reasons).toContain('ambiguous_name')
  p.target.identityAnchors![0]!.name = '王'
  p.observations[0]!.identity!.contributors[0]!.name = '王'
  expect(resolveIntakeEvidence(p).work.reasons).not.toContain('ambiguous_name')
})
