import { describe, expect, it, vi } from 'vitest'

import { assertPublicHttpUrl, fetchRead, type Lookup } from '../../scripts/ingest/lib/transport'

const fakeLookup: Lookup = () => Promise.resolve([{ address: '203.0.113.10', family: 4 }])

describe('safe ingest transport', () => {
  it.each([
    ['http://127.0.0.1', 'loopback'],
    ['http://169.254.169.254/latest/meta-data', 'link-local'],
    ['http://10.0.0.1', 'private'],
    ['file:///etc/passwd', 'http or https'],
  ])('rejects %s', async (url, message) => {
    await expect(assertPublicHttpUrl(url, fakeLookup)).rejects.toThrow(message)
  })

  it('rejects a redirect to a private destination', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        new Response('', { headers: { location: 'http://127.0.0.1/admin' }, status: 302 }),
      )
    await expect(
      fetchRead('https://public.example', {}, { fetchImpl, lookup: fakeLookup }),
    ).rejects.toThrow('loopback')
  })

  it('turns an abort into an actionable timeout', async () => {
    const hangingFetch = vi.fn(
      async (_url: Request | string | URL, init?: RequestInit) =>
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
    await expect(
      fetchRead(
        'https://public.example',
        {},
        { fetchImpl: hangingFetch, lookup: fakeLookup, timeoutMs: 5 },
      ),
    ).rejects.toThrow('timed out after 5ms')
  })

  it('retries a GET twice on transient 503 responses', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('{}'))
    await expect(
      fetchRead(
        'https://public.example',
        { method: 'GET' },
        { backoffMs: 0, fetchImpl, lookup: fakeLookup },
      ),
    ).resolves.toBeInstanceOf(Response)
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it('never retries POST', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(new Response('', { status: 503 }))
    await expect(
      fetchRead('https://public.example', { method: 'POST' }, { fetchImpl, lookup: fakeLookup }),
    ).rejects.toThrow('503')
    expect(fetchImpl).toHaveBeenCalledOnce()
  })
})
