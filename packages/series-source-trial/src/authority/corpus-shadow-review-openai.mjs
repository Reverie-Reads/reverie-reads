import { performance } from 'node:perf_hooks'
import { responseWebEvidence } from './openai.mjs'
import {
  authorityAcquisitionOutputSchema,
  authorityIdentityObservationInstructions,
  authorityRelationshipEncodingInstructions,
} from './schema.mjs'
import { CORPUS_SHADOW_REVIEW_PROMPT_VERSION } from './corpus-shadow-review.mjs'

export const corpusShadowGroupReviewInstructions = `You are Reverie's authority-source reviewer.
Review one proposed bibliographic series group and every listed member. Provider relationships are
candidates, not truth. Your response is a private review artifact and never a database decision.

Rules:
- Search the live web; do not answer from memory.
- Prefer one direct author-controlled bibliography, series, reading-order, or book page that covers
  several group members, then the publisher's catalog. Use further searches only when needed.
- Apply the identity and classification rules independently to every member. Copy each caseId
  exactly and return one review for every member, in input order.
- A series result requires direct author or publisher evidence placing that exact title and complete
  author list in the named bibliographic series. Provider labels, search snippets, retailers,
  reviews, libraries, Wikipedia, Goodreads, link hubs, title patterns, worlds, universes, campaigns,
  imprints, and reading lists are discovery aids or non-series context, not authority evidence.
- Do not accept the proposed group merely because it appears in the input. Preserve a different
  directly evidenced series name. Return unresolved when the exact member or relationship is not
  shown by a qualifying source.
- Report position only when the qualifying source explicitly supplies it. Otherwise use null.
- Standalone requires affirmative author or publisher evidence. Silence or absence from a list is
  unresolved.
- Every evidence URL must be copied from this run's consulted-source manifest. Never construct a
  plausible URL. Keep summaries paraphrased and attributable; quoted reviews and blurbs remain
  third-party evidence even on a first-party page.
- Stop early when the group and every member are directly resolved. Keep each note under 240
  characters.
${authorityRelationshipEncodingInstructions}
${authorityIdentityObservationInstructions}`

export const corpusShadowGroupReviewOutputSchema = {
  type: 'object',
  additionalProperties: false,
  required: ['groupId', 'reviews'],
  properties: {
    groupId: { type: 'string' },
    reviews: {
      type: 'array',
      items: authorityAcquisitionOutputSchema,
    },
  },
}

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

const apiError = (response, body) => {
  const error = new Error(
    `Corpus shadow review API ${response.status}: ${body?.error?.message ?? response.statusText}`,
  )
  error.infrastructureFailure =
    response.status === 408 || response.status === 429 || response.status >= 500
  error.httpStatus = response.status
  return error
}

export async function reviewCorpusShadowGroup(
  target,
  {
    apiKey = process.env.OPENAI_API_KEY,
    apiUrl = process.env.BOOK_AUTHORITY_API_URL ?? 'https://api.openai.com/v1/responses',
    model = process.env.BOOK_AUTHORITY_MODEL ?? 'gpt-5.6-luna',
    reasoningEffort = process.env.BOOK_AUTHORITY_REASONING ?? 'low',
    maxToolCalls = Number(process.env.BOOK_AUTHORITY_MAX_TOOL_CALLS ?? 3),
    searchContextSize = process.env.BOOK_AUTHORITY_SEARCH_CONTEXT_SIZE ?? 'medium',
    fetchImpl = fetch,
  } = {},
) {
  if (!apiKey) throw new Error('OPENAI_API_KEY is required for corpus shadow review')
  const boundedToolCalls = Math.max(1, Math.min(6, Math.floor(maxToolCalls)))
  const maxOutputTokens = Math.min(8000, 1800 + target.members.length * 650)
  const started = performance.now()
  let response
  try {
    response = await fetchImpl(apiUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        store: false,
        reasoning: { effort: reasoningEffort },
        max_output_tokens: maxOutputTokens,
        max_tool_calls: boundedToolCalls,
        instructions: corpusShadowGroupReviewInstructions,
        input: JSON.stringify(target),
        tools: [
          {
            type: 'web_search',
            external_web_access: true,
            search_context_size: searchContextSize,
          },
        ],
        tool_choice: 'required',
        include: ['web_search_call.action.sources'],
        text: {
          format: {
            type: 'json_schema',
            name: 'reverie_corpus_series_group_review',
            strict: true,
            schema: corpusShadowGroupReviewOutputSchema,
          },
        },
        metadata: {
          prompt_version: CORPUS_SHADOW_REVIEW_PROMPT_VERSION,
          group_id: target.groupId,
        },
      }),
    })
  } catch (cause) {
    const error = new Error(`Corpus shadow review API network error: ${cause?.message ?? cause}`, {
      cause,
    })
    error.infrastructureFailure = true
    throw error
  }
  const body = await response.json().catch(() => null)
  if (!response.ok) throw apiError(response, body)
  const text = outputContent(body)
    .map((entry) => entry.text)
    .join('')
  if (!text) throw new Error('Corpus shadow review API returned no structured output')
  const webEvidence = responseWebEvidence(body)
  return {
    output: JSON.parse(text),
    ...webEvidence,
    responseId: body.id ?? null,
    responseModel: body.model ?? model,
    usage: body.usage ?? null,
    latencyMs: Math.round(performance.now() - started),
    promptVersion: CORPUS_SHADOW_REVIEW_PROMPT_VERSION,
  }
}
