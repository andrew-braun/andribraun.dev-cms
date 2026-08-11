import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  type ClaudeResponse,
  type JsonSchema,
  parseStructuredResponse,
  parseTextResponse,
  sendMessage,
} from '../../src/app/lib/ai/claude/client'

function response(text: string, stopReason = 'end_turn'): ClaudeResponse {
  return {
    content: [{ type: 'text', text }],
    model: 'claude-test',
    stop_reason: stopReason,
    usage: { input_tokens: 10, output_tokens: 5 },
  }
}

describe('Claude structured responses', () => {
  it('parses completed structured JSON', () => {
    expect(parseStructuredResponse<{ value: string }>(response('{"value":"ok"}'))).toEqual({
      value: 'ok',
    })
  })

  it('rejects output truncated at the token limit', () => {
    expect(() => parseStructuredResponse(response('{"value":"unterminated', 'max_tokens'))).toThrow(
      'stop reason: max_tokens',
    )
  })

  it('rejects empty structured output', () => {
    expect(() => parseStructuredResponse(response(''))).toThrow('empty structured output')
  })

  it('rejects malformed JSON without logging the raw response', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined)

    expect(() => parseStructuredResponse(response('{"secret":"do not log"'))).toThrow(
      'invalid structured JSON',
    )
    expect(error).not.toHaveBeenCalled()

    error.mockRestore()
  })
})

describe('Claude text responses', () => {
  it('returns completed text and rejects token-truncated prose', () => {
    expect(parseTextResponse(response('Complete writeup.'))).toBe('Complete writeup.')
    expect(() => parseTextResponse(response('Truncated writeup', 'max_tokens'))).toThrow(
      'stop reason: max_tokens',
    )
  })

  it('rejects empty completed text', () => {
    expect(() => parseTextResponse(response('   '))).toThrow('empty text output')
  })
})

describe('Claude structured-output request schema', () => {
  it('strips unsupported bounds from the wire schema and preserves them in descriptions', async () => {
    process.env.CLAUDE_API_KEY = 'test-key'
    let requestBody: unknown
    const fetchImpl = vi.fn((_input: Request | string | URL, init?: RequestInit) => {
      if (typeof init?.body !== 'string') {
        throw new Error('expected a serialized request body')
      }
      requestBody = JSON.parse(init.body) as unknown
      return Promise.resolve(
        new Response(JSON.stringify(response('{"items":[]}')), {
          headers: { 'content-type': 'application/json' },
          status: 200,
        }),
      )
    })

    await sendMessage([{ content: 'hello', role: 'user' }], {
      fetchImpl,
      outputSchema: {
        type: 'object',
        properties: {
          items: {
            type: 'array',
            items: { type: 'string', maxLength: 20, minLength: 1 },
            maxItems: 3,
          },
        },
        required: ['items'],
      },
    })

    const schema = (requestBody as { output_config: { format: { schema: JsonSchema } } })
      .output_config.format.schema
    const items = schema.properties?.items as JsonSchema | undefined
    expect(items).not.toHaveProperty('maxItems')
    expect(items?.items).not.toHaveProperty('maxLength')
    expect(items?.items).not.toHaveProperty('minLength')
    expect(items?.description).toContain('maxItems=3')
    expect(items?.items?.description).toContain('maxLength=20')
  })
})

describe('Claude client timeout', () => {
  beforeEach(() => {
    process.env.CLAUDE_API_KEY = 'test-key'
    vi.useFakeTimers()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('aborts Anthropic after 90000ms without retrying', async () => {
    const fetchImpl = vi.fn(
      async (_input: Request | string | URL, init?: RequestInit) =>
        await new Promise<Response>((_resolve, reject) => {
          init?.signal?.addEventListener(
            'abort',
            () => {
              reject(
                init.signal?.reason instanceof Error
                  ? init.signal.reason
                  : new Error(String(init.signal?.reason)),
              )
            },
            { once: true },
          )
        }),
    )
    const request = sendMessage([{ content: 'hello', role: 'user' }], { fetchImpl })
    const rejection = expect(request).rejects.toThrow('Anthropic request timed out after 90000ms')
    await vi.advanceTimersByTimeAsync(90_000)
    await rejection
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
