import { describe, expect, it } from 'vitest'

import { validateManifest } from '../../scripts/ingest/lib/validation'

const valid = {
  entries: [{ slug: 'safe-project', stages: {}, title: 'Safe Project' }],
  updatedAt: '2026-08-09T00:00:00.000Z',
  version: 1,
}

describe('validateManifest', () => {
  it('accepts omitted, concrete, and null nullable links', () => {
    expect(validateManifest(valid).entries[0].liveUrl).toBeUndefined()
    expect(
      validateManifest({ ...valid, entries: [{ ...valid.entries[0], liveUrl: null }] }).entries[0]
        .liveUrl,
    ).toBeNull()
  })

  it.each(['../escape', '/absolute', 'A B', 'a/b', ''])('rejects unsafe slug %j', (slug) => {
    expect(() => validateManifest({ ...valid, entries: [{ ...valid.entries[0], slug }] })).toThrow(
      'entries[0].slug',
    )
  })

  it('rejects duplicate slugs', () => {
    expect(() =>
      validateManifest({ ...valid, entries: [valid.entries[0], valid.entries[0]] }),
    ).toThrow('duplicate slug')
  })

  it('rejects unsupported URL schemes and null required fields', () => {
    expect(() =>
      validateManifest({
        ...valid,
        entries: [{ ...valid.entries[0], liveUrl: 'file:///etc/passwd' }],
      }),
    ).toThrow('liveUrl')
    expect(() =>
      validateManifest({ ...valid, entries: [{ ...valid.entries[0], title: null }] }),
    ).toThrow('title')
  })
})
