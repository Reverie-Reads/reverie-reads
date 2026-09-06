export const AUTHORITY_RETRIEVAL_PROFILES_VERSION = 'authority-retrieval-profiles-v2'

export const authorityRetrievalProfiles = [
  {
    schemaVersion: 1,
    profileVersion: 'pipwritesfiction-pending-v1',
    canonicalOrigin: 'https://www.pipwritesfiction.com',
    canonicalAliases: ['https://pipwritesfiction.com'],
    sourceKind: 'author',
    status: 'pending',
    termsReviewedAt: null,
    expiresAt: null,
    reviewedBy: null,
    reviewReference:
      'docs/decisions/0009-authority-retrieval-gateway.md#first-live-origin-candidate',
  },
  {
    schemaVersion: 1,
    profileVersion: 'authorljshen-pending-v1',
    canonicalOrigin: 'https://www.authorljshen.com',
    canonicalAliases: ['https://authorljshen.com'],
    sourceKind: 'author',
    status: 'pending',
    termsReviewedAt: null,
    expiresAt: null,
    reviewedBy: null,
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-evaluation-2026-09-05.md#lj-shen-author-site',
  },
  {
    schemaVersion: 1,
    profileVersion: 'penguin-uk-manual-v1',
    canonicalOrigin: 'https://www.penguin.co.uk',
    canonicalAliases: ['https://penguin.co.uk'],
    sourceKind: 'publisher',
    status: 'manual_only',
    termsReviewedAt: null,
    expiresAt: null,
    reviewedBy: null,
    reviewReference:
      'packages/series-source-trial/reports/authority-origin-evaluation-2026-09-05.md#penguin-uk',
  },
]
