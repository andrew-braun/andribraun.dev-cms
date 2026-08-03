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
  properties?: Record<string, { enum?: string[]; items?: JsonSchema; type: string } | JsonSchema>
  required?: string[]
  type: string
}

export interface ClaudeRequestOptions {
  /** Thinking depth / token spend. Only supported on Claude 4.5+ models. */
  effort?: 'high' | 'low' | 'max' | 'medium' | 'xhigh'
  maxTokens?: number
  model?: string
  outputSchema?: JsonSchema
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
}

export async function sendMessage(
  messages: ClaudeMessage[],
  options: ClaudeRequestOptions = {},
): Promise<ClaudeResponse> {
  const { effort, maxTokens = 1024, model = DEFAULT_MODEL, outputSchema, system } = options

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
      schema: outputSchema,
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

  const response = await fetch(ANTHROPIC_API_URL, {
    body: JSON.stringify(body),
    headers: {
      'anthropic-version': ANTHROPIC_VERSION,
      'Content-Type': 'application/json',
      'x-api-key': apiKey,
    },
    method: 'POST',
  })

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
