import { mkdir, readFile, rename, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { EXA_SEARCH_REQUEST_USD } from './exa-locator.mjs'

export async function createCorpusShadowExaBudget({ path, reviewSha256, maximumUsd }) {
  if (!/^[a-f0-9]{64}$/.test(reviewSha256 ?? '')) throw new Error('Exa budget requires review hash')
  if (!Number.isFinite(maximumUsd) || maximumUsd <= 0 || maximumUsd > 10) {
    throw new Error('Exa budget must be greater than zero and at most $10')
  }
  await mkdir(dirname(path), { recursive: true, mode: 0o700 })
  let state
  try {
    state = JSON.parse(await readFile(path, 'utf8'))
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error
    state = {
      schemaVersion: 1,
      purpose: 'corpus-series-shadow-exa-budget',
      reviewSha256,
      maximumUsd,
      reservedRequests: 0,
      reservedUsd: 0,
    }
    await writeFile(path, `${JSON.stringify(state, null, 2)}\n`, {
      encoding: 'utf8',
      mode: 0o600,
      flag: 'wx',
    })
  }
  if (
    state?.schemaVersion !== 1 ||
    state?.purpose !== 'corpus-series-shadow-exa-budget' ||
    state?.reviewSha256 !== reviewSha256 ||
    state?.maximumUsd !== maximumUsd ||
    !Number.isInteger(state?.reservedRequests) ||
    state.reservedRequests < 0 ||
    Number(state?.reservedUsd) !==
      Number((state.reservedRequests * EXA_SEARCH_REQUEST_USD).toFixed(6))
  ) {
    throw new Error('Exa budget state does not match the frozen review')
  }

  let lock = Promise.resolve()
  const reserve = () => {
    const pending = lock.then(async () => {
      const nextRequests = state.reservedRequests + 1
      const nextUsd = Number((nextRequests * EXA_SEARCH_REQUEST_USD).toFixed(6))
      if (nextUsd > maximumUsd) throw new Error('corpus_shadow_exa_budget_exhausted')
      state = { ...state, reservedRequests: nextRequests, reservedUsd: nextUsd }
      const temporary = `${path}.${process.pid}.tmp`
      await writeFile(temporary, `${JSON.stringify(state, null, 2)}\n`, {
        encoding: 'utf8',
        mode: 0o600,
      })
      await rename(temporary, path)
    })
    lock = pending.catch(() => {})
    return pending
  }

  return {
    reserve,
    snapshot: () => ({ ...state }),
  }
}
