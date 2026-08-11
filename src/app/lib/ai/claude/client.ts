const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-5'

export type ClaudeContentBlock =
  | {
      source: { data: string; media_type: string; type: 'base64' }
      type: 'image'
    }
  | { text: string; type: 'text' }

export interface ClaudeMessage {
  content: ClaudeContentBlock[] | string
  role: 'assistant' | 'user'
}

export interface JsonSchema {
  additionalProperties?: boolean
  description?: string
  enum?: string[]
  items?: JsonSchema
  maxItems?: number
  maxLength?: number
  minItems?: number
  minLength?: number
  properties?: Record<string, { enum?: string[]; items?: JsonSchema; type: string } | JsonSchema>
  required?: string[]
  type: string
}

export interface ClaudeRequestOptions {
  /** Thinking depth / token spend. Only supported on Claude 4.5+ models. */
  effort?: 'high' | 'low' | 'max' | 'medium' | 'xhigh'
  fetchImpl?: typeof fetch
  maxTokens?: number
  model?: string
  outputSchema?: JsonSchema
  signal?: AbortSignal
  system?: string
}

export interface ClaudeResponse {
  /**
   * Response blocks. Models with thinking enabled (on by default for Opus 5)
   * emit a leading `thinking` block, so never index this directly — use
   * {@link getTextContent}.
   */
  content: Array<{
    text?: string
    thinking?: string
    type: string
  }>
  model: string
  stop_reason: string
  usage: {
    input_tokens: number
    output_tokens: number
  }
}

export class ClaudeAPIError extends Error {
  constructor(
    message: string,
    public statusCode?: number,
    public responseBody?: string,
  ) {
    super(message)
    this.name = 'ClaudeAPIError'
  }

  /** Client-side API failures affect every remaining item in an ingest batch. */
  get fatal(): boolean {
    return this.statusCode !== undefined && this.statusCode >= 400 && this.statusCode < 500
  }
}

const UNSUPPORTED_SCHEMA_BOUNDS = ['maxItems', 'maxLength', 'minItems', 'minLength'] as const

/**
 * Anthropic's raw Messages API accepts only a JSON Schema subset. Official
 * SDKs strip unsupported bounds and retain them as descriptions before
 * sending; this fetch-based client performs the same wire transformation while
 * domain validators continue enforcing the original schema locally.
 */
function schemaForClaude(schema: JsonSchema): JsonSchema {
  const transformed: JsonSchema = { ...schema }
  const constraints: string[] = []

  for (const key of UNSUPPORTED_SCHEMA_BOUNDS) {
    const value = transformed[key]
    if (value !== undefined) {
      constraints.push(`${key}=${value}`)
      delete transformed[key]
    }
  }

  if (constraints.length > 0) {
    transformed.description = [schema.description, `Constraints: ${constraints.join(', ')}`]
      .filter(Boolean)
      .join(' ')
  }
  if (schema.items) {
    transformed.items = schemaForClaude(schema.items)
  }
  if (schema.properties) {
    transformed.properties = Object.fromEntries(
      Object.entries(schema.properties).map(([key, value]) => [key, schemaForClaude(value)]),
    )
  }
  return transformed
}

export async function sendMessage(
  messages: ClaudeMessage[],
  options: ClaudeRequestOptions = {},
): Promise<ClaudeResponse> {
  const {
    effort,
    fetchImpl = fetch,
    maxTokens = 1024,
    model = DEFAULT_MODEL,
    outputSchema,
    signal,
    system,
  } = options

  const body: Record<string, unknown> = {
    max_tokens: maxTokens,
    messages,
    model,
  }

  if (system) {
    body.system = system
  }

  const outputConfig: Record<string, unknown> = {}

  if (outputSchema) {
    outputConfig.format = {
      type: 'json_schema',
      schema: schemaForClaude(outputSchema),
    }
  }

  if (effort) {
    outputConfig.effort = effort
  }

  if (Object.keys(outputConfig).length > 0) {
    body.output_config = outputConfig
  }

  const apiKey = process.env.CLAUDE_API_KEY
  if (!apiKey) {
    throw new ClaudeAPIError('CLAUDE_API_KEY environment variable is not set')
  }

  const controller = new AbortController()
  let timedOut = false
  const timer = setTimeout(() => {
    timedOut = true
    controller.abort(new Error('timeout'))
  }, 90_000)
  const abort = () => controller.abort(signal?.reason)
  signal?.addEventListener('abort', abort, { once: true })
  if (signal?.aborted) {
    abort()
  }

  let response: Response
  try {
    response = await fetchImpl(ANTHROPIC_API_URL, {
      body: JSON.stringify(body),
      headers: {
        'anthropic-version': ANTHROPIC_VERSION,
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
      },
      method: 'POST',
      signal: controller.signal,
    })
  } catch (error) {
    if (timedOut) {
      throw new ClaudeAPIError('Anthropic request timed out after 90000ms')
    }
    throw error
  } finally {
    clearTimeout(timer)
    signal?.removeEventListener('abort', abort)
  }

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Claude API error:', errorBody)
    throw new ClaudeAPIError('Claude API request failed', response.status, errorBody)
  }

  return response.json()
}

export function getTextContent(response: ClaudeResponse): string {
  // Thinking-enabled models put a `thinking` block first, so select by type
  // rather than position.
  return response.content.find((block) => block.type === 'text')?.text || ''
}

/** Rejects incomplete prose so callers never persist a token-truncated draft. */
export function parseTextResponse(response: ClaudeResponse): string {
  if (response.stop_reason !== 'end_turn') {
    throw new ClaudeAPIError(
      `Claude did not complete text output (stop reason: ${response.stop_reason})`,
    )
  }
  const text = getTextContent(response)
  if (!text.trim()) {
    throw new ClaudeAPIError('Claude returned empty text output')
  }
  return text
}

/**
 * Parses a JSON response produced through Anthropic's structured-output mode.
 * A syntactically valid prefix is not a completed response: token exhaustion,
 * refusals, and tool turns must be surfaced to the caller instead of becoming
 * fallback content.
 */
export function parseStructuredResponse<T>(response: ClaudeResponse): T {
  if (response.stop_reason !== 'end_turn') {
    throw new ClaudeAPIError(
      `Claude did not complete structured output (stop reason: ${response.stop_reason})`,
    )
  }

  const text = getTextContent(response).trim()
  if (!text) {
    throw new ClaudeAPIError('Claude returned empty structured output')
  }

  try {
    return JSON.parse(text) as T
  } catch {
    throw new ClaudeAPIError('Claude returned invalid structured JSON')
  }
}

export function parseJsonFromResponse<T>(response: ClaudeResponse, fallback: T): T {
  const text = getTextContent(response)

  // With structured outputs, the response should be valid JSON directly
  // But we still handle the case where it might be wrapped in markdown code blocks
  const cleanText = text
    .replace(/^```json\s*/, '')
    .replace(/\s*```$/, '')
    .trim()

  try {
    return JSON.parse(cleanText)
  } catch (error) {
    console.error('Failed to parse JSON from Claude response:', error)
    console.error('Raw response text:', text)
    // Fallback: try to extract JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch (matchError) {
        console.error('Failed to parse extracted JSON:', matchError)
        return fallback
      }
    }
    return fallback
  }
}
