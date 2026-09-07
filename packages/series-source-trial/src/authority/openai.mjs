import { performance } from 'node:perf_hooks'
import {
  AUTHORITY_ACQUISITION_PROMPT_VERSION,
  AUTHORITY_ACQUISITION_REPAIR_PROMPT_VERSION,
  authorityAcquisitionInstructions,
  authorityAcquisitionRepairInstructions,
  authorityAcquisitionOutputSchema,
} from './schema.mjs'

const outputContent = (response) => {
  const contents = []
  for (const item of response.output ?? []) {
    if (item.type !== 'message') continue
    for (const content of item.content ?? []) {
      if (content.type === 'output_text') contents.push(content)
    }
  }
  if (contents.length) return contents
  if (typeof response.output_text === 'string') {
    return [{ type: 'output_text', text: response.output_text, annotations: [] }]
  }
  return []
}

const uniqueUrls = (values) => [
  ...new Set(values.filter((value) => typeof value === 'string' && value.startsWith('https://'))),
]
const uniqueStrings = (values) => [
  ...new Set(
    values
      .filter((value) => typeof value === 'string' && value.trim())
      .map((value) => value.trim()),
  ),
]

export const responseWebEvidence = (response) => {
  const searchedUrls = []
  const searchedQueries = []
  const citationUrls = []
  let webSearchCalls = 0

  for (const item of response.output ?? []) {
    if (item.type !== 'web_search_call') continue
    webSearchCalls += 1
    if (typeof item.action?.query === 'string') searchedQueries.push(item.action.query)
    for (const query of item.action?.queries ?? []) searchedQueries.push(query)
    for (const source of item.action?.sources ?? []) searchedUrls.push(source?.url)
  }

  for (const content of outputContent(response)) {
    for (const annotation of content.annotations ?? []) {
      if (annotation.type === 'url_citation') citationUrls.push(annotation.url)
    }
  }

  return {
    searchedQueries: uniqueStrings(searchedQueries),
    searchedUrls: uniqueUrls(searchedUrls),
    citationUrls: uniqueUrls(citationUrls),
    consultedUrls: uniqueUrls([...searchedUrls, ...citationUrls]),
    webSearchCalls,
  }
}

export async function acquireAuthorityEvidence(
  target,
  {
    apiKey = process.env.OPENAI_API_KEY,
    apiUrl = process.env.BOOK_AUTHORITY_API_URL ?? 'https://api.openai.com/v1/responses',
    model = process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    reasoningEffort = process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    maxToolCalls = Number(process.env.BOOK_AUTHORITY_MAX_TOOL_CALLS ?? 3),
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the authority acquisition trial')
  const boundedToolCalls = Math.max(1, Math.min(6, Math.floor(maxToolCalls)))
  const started = performance.now()
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: 1400,
      max_tool_calls: boundedToolCalls,
      instructions: authorityAcquisitionInstructions,
      input: JSON.stringify(target),
      tools: [{ type: 'web_search', external_web_access: true }],
      tool_choice: 'required',
      include: ['web_search_call.action.sources'],
      text: {
        format: {
          type: 'json_schema',
          name: 'reverie_authority_source_proposal',
          strict: true,
          schema: authorityAcquisitionOutputSchema,
        },
      },
      metadata: {
        prompt_version: AUTHORITY_ACQUISITION_PROMPT_VERSION,
        case_id: target.caseId,
      },
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `Authority acquisition API ${response.status}: ${body?.error?.message ?? response.statusText}`,
    )
  }
  const content = outputContent(body)
  const text = content.map((entry) => entry.text).join('')
  if (!text) throw new Error('Authority acquisition API returned no structured output text')
  const webEvidence = responseWebEvidence(body)

  return {
    output: JSON.parse(text),
    ...webEvidence,
    responseId: body.id ?? null,
    responseModel: body.model ?? model,
    usage: body.usage ?? null,
    latencyMs: Math.round(performance.now() - started),
    promptVersion: AUTHORITY_ACQUISITION_PROMPT_VERSION,
  }
}

export async function repairAuthorityEvidence(
  target,
  originalOutput,
  validationErrors,
  {
    apiKey = process.env.OPENAI_API_KEY,
    apiUrl = process.env.BOOK_AUTHORITY_API_URL ?? 'https://api.openai.com/v1/responses',
    model = process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    reasoningEffort = process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for the authority acquisition trial')
  const started = performance.now()
  const response = await fetchImpl(apiUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      model,
      store: false,
      reasoning: { effort: reasoningEffort },
      max_output_tokens: 1000,
      instructions: authorityAcquisitionRepairInstructions,
      input: JSON.stringify({ target, originalOutput, validationErrors }),
      text: {
        format: {
          type: 'json_schema',
          name: 'reverie_authority_source_proposal_repair',
          strict: true,
          schema: authorityAcquisitionOutputSchema,
        },
      },
      metadata: {
        prompt_version: AUTHORITY_ACQUISITION_REPAIR_PROMPT_VERSION,
        case_id: target.caseId,
      },
    }),
  })
  const body = await response.json().catch(() => null)
  if (!response.ok) {
    throw new Error(
      `Authority acquisition repair API ${response.status}: ${body?.error?.message ?? response.statusText}`,
    )
  }
  const content = outputContent(body)
  const text = content.map((entry) => entry.text).join('')
  if (!text) throw new Error('Authority acquisition repair API returned no structured output text')

  return {
    output: JSON.parse(text),
    responseId: body.id ?? null,
    responseModel: body.model ?? model,
    usage: body.usage ?? null,
    latencyMs: Math.round(performance.now() - started),
    promptVersion: AUTHORITY_ACQUISITION_REPAIR_PROMPT_VERSION,
  }
}
