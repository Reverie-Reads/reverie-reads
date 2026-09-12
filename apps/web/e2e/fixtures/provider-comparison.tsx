// Developer-browser fixture only. Not imported by the application or a production route.
import { createRoot } from 'react-dom/client'
import { providerComparisonFixture } from '../../../../packages/core/src/providerComparison.fixture'
import { ProviderComparison } from '../../src/components/catalog/ProviderComparison'
import '../../src/styles/tokens.css'
import '../../src/styles/globals.css'
import '../../src/styles/skin-kit.css'

const { context } = providerComparisonFixture()
createRoot(document.getElementById('root')!).render(
  <main className="mx-auto max-w-3xl p-4">
    <h1 className="mb-4 text-2xl">Synthetic comparison fixture</h1>
    <p className="mb-4 text-sm">
      Offline development only. No provider connection or saved catalog data.
    </p>
    <ProviderComparison
      context={context}
      accountId="synthetic-account"
      permission="confirmed"
      permissionEpoch="synthetic-check"
      online
      sharedPages={999}
      load={async () => {
        const { dto } = providerComparisonFixture(Date.now())
        dto.results[1] = {
          provider: 'openlibrary',
          endpoint: 'isbn_edition',
          status: 'identity_review',
          reason: 'title_mismatch',
          observedAt: dto.acquiredAt,
        }
        dto.joint = 'identity_review'
        dto.expiresAt = new Date(Date.parse(dto.acquiredAt) + 300000).toISOString()
        return dto
      }}
    />
  </main>,
)
