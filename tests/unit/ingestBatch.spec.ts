import { describe, expect, it } from 'vitest'

import { runBatch } from '../../scripts/ingest/lib/batch'

describe('runBatch', () => {
  it('continues independent entries and reports an overall failure', async () => {
    const visited: string[] = []
    await expect(
      runBatch([{ slug: 'a' }, { slug: 'b' }], (entry) => {
        visited.push(entry.slug)
        if (entry.slug === 'a') {
          return Promise.reject(new Error('broken'))
        }
        return Promise.resolve()
      }),
    ).rejects.toThrow('1 of 2 entries failed')
    expect(visited).toEqual(['a', 'b'])
  })

  it('stops after a fatal shared-service failure', async () => {
    const visited: string[] = []
    const fatal = Object.assign(new Error('billing unavailable'), { fatal: true })

    await expect(
      runBatch([{ slug: 'a' }, { slug: 'b' }], (entry) => {
        visited.push(entry.slug)
        return Promise.reject(fatal)
      }),
    ).rejects.toThrow('billing unavailable')
    expect(visited).toEqual(['a'])
  })
})
