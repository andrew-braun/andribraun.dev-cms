const ANTHROPIC_API_URL = 'https://api.anthropic.com/v1/messages'
const ANTHROPIC_VERSION = '2023-06-01'
const DEFAULT_MODEL = 'claude-sonnet-4-5'

export interface ClaudeMessage {
  content: string
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
  maxTokens?: number
  model?: string
  outputSchema?: JsonSchema
  system?: string
}

export interface ClaudeResponse {
  content: Array<{
    text: string
    type: 'text'
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
  const { maxTokens = 1024, model = DEFAULT_MODEL, outputSchema, system } = options

  const body: Record<string, unknown> = {
    max_tokens: maxTokens,
    messages,
    model,
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
