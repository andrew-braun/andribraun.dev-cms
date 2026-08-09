import { describe, expect, it, vi } from 'vitest'

import { type ProjectIdentity, resolveProject } from '../../scripts/ingest/lib/projectResolution'

function fakeBackend({
  byId,
  bySlug,
}: {
  byId: null | ProjectIdentity
  bySlug: null | ProjectIdentity
}) {
  return {
    findProjectById: vi.fn(() => Promise.resolve(byId)),
    findProjectBySlug: vi.fn(() => Promise.resolve(bySlug)),
  }
}

describe('project resolution', () => {
  it.each([
    ['matching hint', 7, { id: 7, slug: 'alpha' }, null, { id: 7, action: 'update' }],
    [
      'stale hint adopts slug match',
      7,
      null,
      { id: 9, slug: 'alpha' },
      { id: 9, action: 'update' },
    ],
    [
      'missing hint adopts slug match',
      undefined,
      null,
      { id: 9, slug: 'alpha' },
      { id: 9, action: 'update' },
    ],
    ['no match creates', undefined, null, null, { action: 'create' }],
  ] as const)('%s', async (_name, hintedId, byId, bySlug, expected) => {
    await expect(resolveProject(fakeBackend({ byId, bySlug }), 'alpha', hintedId)).resolves.toEqual(
      expected,
    )
  })

  it('fails when the recorded ID belongs to another slug', async () => {
    await expect(
      resolveProject(fakeBackend({ byId: { id: 7, slug: 'beta' }, bySlug: null }), 'alpha', 7),
    ).rejects.toThrow('belongs to slug "beta"')
  })
})
