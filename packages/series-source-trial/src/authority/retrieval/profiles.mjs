import { REPEATED_NUMBERED_CATALOG_HEADINGS } from './profile.mjs'

export const AUTHORITY_RETRIEVAL_PROFILES_VERSION = 'authority-retrieval-profiles-v5'

export const authorityRetrievalProfiles = [
  {
    schemaVersion: 1,
    profileVersion: 'pipwritesfiction-pending-v1',
    canonicalOrigin: 'https://www.pipwritesfiction.com',
    canonicalAliases: ['https://pipwritesfiction.com'],
    sourceKind: 'author',
    evidenceCapabilities: [],
    status: 'pending',
    termsReviewedAt: null,
    expiresAt: null,
    reviewedBy: null,
    reviewReference:
      'docs/decisions/0009-authority-retrieval-gateway.md#first-live-origin-candidate',
  },
  {
    schemaVersion: 1,
    profileVersion: 'authorljshen-approved-trial-v1',
    canonicalOrigin: 'https://www.authorljshen.com',
    canonicalAliases: ['https://authorljshen.com'],
    sourceKind: 'author',
    evidenceCapabilities: [],
    status: 'approved_trial',
    termsReviewedAt: '2026-09-07T06:40:08.000Z',
    expiresAt: '2026-10-07T06:40:08.000Z',
    reviewedBy: 'reverie-owner',
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-approval-pilot-2026-09-06.md',
  },
  {
    schemaVersion: 1,
    profileVersion: 'penguin-uk-manual-v1',
    canonicalOrigin: 'https://www.penguin.co.uk',
    canonicalAliases: ['https://penguin.co.uk'],
    sourceKind: 'publisher',
    evidenceCapabilities: [],
    status: 'manual_only',
    termsReviewedAt: null,
    expiresAt: null,
    reviewedBy: null,
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-evaluation-2026-09-05.md#penguin-uk',
  },
  {
    schemaVersion: 1,
    profileVersion: 'smdaviesauthor-approved-trial-v1',
    canonicalOrigin: 'https://smdaviesauthor.com',
    canonicalAliases: ['https://www.smdaviesauthor.com'],
    sourceKind: 'author',
    evidenceCapabilities: [REPEATED_NUMBERED_CATALOG_HEADINGS],
    status: 'approved_trial',
    termsReviewedAt: '2026-09-07T19:20:57.000Z',
    expiresAt: '2026-10-07T19:20:57.000Z',
    reviewedBy: 'reverie-owner',
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-approval-sm-davies-2026-09-07.md',
  },
  {
    schemaVersion: 1,
    profileVersion: 'alihazelwood-manual-v1',
    canonicalOrigin: 'https://alihazelwood.com',
    canonicalAliases: ['https://www.alihazelwood.com'],
    sourceKind: 'author',
    evidenceCapabilities: [],
    status: 'manual_only',
    termsReviewedAt: '2026-09-07T18:16:14.000Z',
    expiresAt: null,
    reviewedBy: 'codex-source-review',
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-coverage-evaluation-2026-09-07.md#ali-hazelwood',
  },
  {
    schemaVersion: 1,
    profileVersion: 'penguinrandomhouse-us-manual-v1',
    canonicalOrigin: 'https://www.penguinrandomhouse.com',
    canonicalAliases: ['https://penguinrandomhouse.com'],
    sourceKind: 'publisher',
    evidenceCapabilities: [],
    status: 'manual_only',
    termsReviewedAt: '2026-09-07T18:16:14.000Z',
    expiresAt: null,
    reviewedBy: 'codex-source-review',
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-coverage-evaluation-2026-09-07.md#penguin-random-house-us',
  },
]
