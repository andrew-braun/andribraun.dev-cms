const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-5'

export interface ClaudeMessage {
  role: 'user' | 'assistant'
  content: string
}

export interface JsonSchema {
  type: string
  properties?: Record<string, JsonSchema | { type: string; items?: JsonSchema; enum?: string[] }>
  items?: JsonSchema
  required?: string[]
  additionalProperties?: boolean
  enum?: string[]
  description?: string
}

export interface ClaudeRequestOptions {
  model?: string
  maxTokens?: number
  system?: string
  outputSchema?: JsonSchema
}

export interface ClaudeResponse {
  content: Array<{
    type: 'text'
    text: string
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
  const { model = DEFAULT_MODEL, maxTokens = 1024, system, outputSchema } = options

  const body: Record<string, unknown> = {
    model,
    max_tokens: maxTokens,
    messages,
  }

  if (system) {
    body.system = system
  }

  if (outputSchema) {
    body.output_config = {
      format: {
        type: 'json_schema',
        schema: outputSchema,
      },
    }
  }

  const response = await fetch(ANTHROPIC_API_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': process.env.CLAUDE_API_KEY!,
      'anthropic-version': ANTHROPIC_VERSION,
    },
    body: JSON.stringify(body),
  })

  if (!response.ok) {
    const errorBody = await response.text()
    console.error('Claude API error:', errorBody)
    throw new ClaudeAPIError('Claude API request failed', response.status, errorBody)
  }

  return response.json()
}

export function getTextContent(response: ClaudeResponse): string {
  return response.content[0]?.text || ''
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
  } catch {
    // Fallback: try to extract JSON from the response
    const jsonMatch = text.match(/\[[\s\S]*\]/) || text.match(/\{[\s\S]*\}/)
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0])
      } catch {
        return fallback
      }
    }
    return fallback
  }
}
