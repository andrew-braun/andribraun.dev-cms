import { describe, expect, it, vi } from 'vitest'

import { RemoteClient, type RemoteConfig } from '../../scripts/ingest/lib/remote'

const config: RemoteConfig = {
  apiKey: 'secret',
  authCollection: 'third-party-access',
  baseUrl: 'https://203.0.113.10',
}

describe('RemoteClient transport policy', () => {
  it('retries transient reads', async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response('', { status: 503 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ docs: [], totalDocs: 0 })))
    const client = new RemoteClient(config, { backoffMs: 0, fetchImpl })
    await client.find('projects')
    expect(fetchImpl).toHaveBeenCalledTimes(3)
  })

  it.each(['create', 'update', 'delete', 'post'] as const)(
    '%s is attempted once',
    async (method) => {
      const fetchImpl = vi.fn().mockResolvedValue(new Response('unavailable', { status: 503 }))
      const client = new RemoteClient(config, { fetchImpl })
      const call = {
        create: () => client.create('projects', {}),
        delete: () => client.delete('projects', 1),
        post: () => client.post('action', {}),
        update: () => client.update('projects', 1, {}),
      }[method]
      await expect(call()).rejects.toThrow('503')
      expect(fetchImpl).toHaveBeenCalledOnce()
    },
  )

  it('turns a write abort into an actionable timeout', async () => {
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
    const client = new RemoteClient(config, { fetchImpl, timeoutMs: 5 })
    await expect(client.create('projects', {})).rejects.toThrow('timed out after 5ms')
  })

  it('preserves Payload field details', async () => {
    const body = {
      errors: [
        {
          data: { errors: [{ message: 'required', path: 'title' }] },
          message: 'Validation failed',
        },
      ],
    }
    const client = new RemoteClient(config, {
      fetchImpl: vi.fn().mockResolvedValue(new Response(JSON.stringify(body), { status: 400 })),
    })
    await expect(client.create('projects', {})).rejects.toThrow('title: required')
  })
})
