import { beforeEach, describe, expect, it, vi } from 'vitest'

const payload = {
  create: vi.fn(),
  find: vi.fn(),
  update: vi.fn(({ id }: { data: Record<string, unknown>; id: number }) => Promise.resolve({ id })),
}

vi.mock('payload', () => ({ getPayload: vi.fn(() => Promise.resolve(payload)) }))
vi.mock('@payload-config', () => ({ default: {} }))
vi.mock('@/services/technologyExtraction', () => ({
  extractTechnologiesFromProject: vi.fn(),
}))

import { localBackend, remoteBackend } from '../../scripts/ingest/lib/backend'

describe('publish backend update pass-through', () => {
  beforeEach(() => {
    process.env.DATABASE_URI = 'postgres://user:pass@localhost:5432/test'
    vi.clearAllMocks()
  })

  it('passes explicit null and omission through the Local API', async () => {
    const backend = await localBackend()
    await backend.updateProject(7, { live_link: null })
    expect(payload.update).toHaveBeenCalledWith({
      id: 7,
      collection: 'projects',
      data: { live_link: null },
    })
    expect('github_link' in payload.update.mock.calls[0][0].data).toBe(false)
  })

  it('passes explicit null and omission through the remote adapter', async () => {
    const client = {
      update: vi.fn((_collection: string, _id: number, _data: Record<string, unknown>) =>
        Promise.resolve({ id: 8 }),
      ),
    }
    const backend = remoteBackend(client as never)
    await backend.updateProject(8, { live_link: null })
    expect(client.update).toHaveBeenCalledWith('projects', 8, { live_link: null })
    expect('github_link' in client.update.mock.calls[0][2]).toBe(false)
  })
})
