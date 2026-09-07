const identityKey = (testCase) => JSON.stringify([testCase?.title ?? null, testCase?.authors ?? []])

export function reusableProviderResults(currentCases, reports) {
  const currentById = new Map(currentCases.map((testCase) => [testCase.id, testCase]))
  const reusable = new Map()

  for (const report of reports) {
    if (!Array.isArray(report?.caseSet?.cases) || !Array.isArray(report?.runs)) {
      throw new Error('Resume input must be a complete series trial JSON report')
    }
    const recordedById = new Map(report.caseSet.cases.map((testCase) => [testCase.id, testCase]))

    for (const run of report.runs) {
      if (!run?.provider || !Array.isArray(run.results)) continue
      const byCase = reusable.get(run.provider) ?? new Map()
      for (const result of run.results) {
        const current = currentById.get(result.caseId)
        const recorded = recordedById.get(result.caseId)
        if (
          result.error ||
          !current ||
          !recorded ||
          identityKey(current) !== identityKey(recorded)
        ) {
          continue
        }
        byCase.set(result.caseId, result)
      }
      reusable.set(run.provider, byCase)
    }
  }

  return reusable
}
