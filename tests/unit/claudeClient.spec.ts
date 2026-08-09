import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { sendMessage } from '../../src/app/lib/ai/claude/client'

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
