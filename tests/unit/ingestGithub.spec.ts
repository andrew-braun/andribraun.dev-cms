import { describe, expect, it, vi } from 'vitest'

import { runGh } from '../../scripts/ingest/lib/github'

describe('GitHub subprocess', () => {
  it('sets a hard timeout and bounded output buffer', async () => {
    const exec = vi.fn((_file, _args, options, callback) => {
      callback(null, 'ok', '')
      return {} as never
    })
    await expect(runGh(['api', 'user'], exec as never)).resolves.toBe('ok')
    expect(exec).toHaveBeenCalledWith(
      'gh',
      ['api', 'user'],
      expect.objectContaining({
        killSignal: 'SIGTERM',
        maxBuffer: 32 * 1024 * 1024,
        timeout: 30_000,
      }),
      expect.any(Function),
    )
  })
})
