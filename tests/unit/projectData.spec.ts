import { describe, expect, it } from 'vitest'

import type { CaseStudySidecar } from '../../scripts/ingest/lib/caseStudy'
import type { ManifestEntry } from '../../scripts/ingest/lib/types'

import {
  buildProjectCreateData,
  buildProjectData,
  buildProjectUpdateData,
} from '../../scripts/ingest/lib/projectData'

const entry: ManifestEntry = {
  slug: 'wherenext-ai',
  githubLink: 'https://github.com/example/wherenext',
  liveUrl: 'https://wherenext.ai',
  stages: { writeupAt: '2026-01-01T00:00:00.000Z' },
  title: 'WhereNext.ai',
}

describe('buildProjectData', () => {
  it('maps slug, writeup, and sidecar fields', () => {
    const caseStudy: CaseStudySidecar = {
      business_challenge: 'Fragmented planning.',
      client_name: 'WhereNext.ai',
      contribution_highlights: [{ statement: 'Built end-to-end' }],
      needsReview: [],
      outcomes: [{ metric: 'Live product', statement: 'End-to-end experience' }],
      status: 'live',
    }

    const data = buildProjectData(entry, '# Writeup', [10, 11], false, caseStudy)

    expect(data.slug).toBe('wherenext-ai')
    expect(data.title).toBe('WhereNext.ai')
    expect(data.description_markdown).toBe('# Writeup')
    expect(data.client_name).toBe('WhereNext.ai')
    expect(data.business_challenge).toBe('Fragmented planning.')
    expect(data.contribution_highlights).toEqual([{ statement: 'Built end-to-end' }])
    expect(data.outcomes).toEqual([{ metric: 'Live product', statement: 'End-to-end experience' }])
    expect(data.status).toBe('live')
    expect(data.display?.hide).toBe(true)
    expect(data.thumbnail).toBe(10)
    expect(data.images).toEqual([10, 11])
  })

  it('omits case-study fields when sidecar is missing but still sets slug', () => {
    const data = buildProjectData(entry, 'body', [], true, null)
    expect(data.slug).toBe('wherenext-ai')
    expect(data.client_name).toBeUndefined()
    expect(data.status).toBeUndefined()
    expect(data.display?.hide).toBe(false)
  })

  // These assert on key *presence*, not on the value. An update is a partial
  // write, so a missing key preserves what the project already has while a key
  // set to `[]` or `undefined` can clear it — publishing an entry that has not
  // been screenshotted must not wipe media uploaded through the admin.
  describe('does not clear fields the ingest run knows nothing about', () => {
    it('omits every media key when no screenshots were captured', () => {
      const data = buildProjectData(entry, 'body', [], true, null)

      expect('images' in data).toBe(false)
      expect('thumbnail' in data).toBe(false)
      expect('hero_image' in data).toBe(false)
    })

    it('omits links absent from the manifest', () => {
      const { githubLink: _github, liveUrl: _live, ...linkless } = entry

      const data = buildProjectData(linkless, 'body', [], true, null)

      expect('live_link' in data).toBe(false)
      expect('github_link' in data).toBe(false)
      expect('snapshot_link' in data).toBe(false)
    })

    it('omits display.order when the manifest has no position', () => {
      const data = buildProjectData(entry, 'body', [], true, null)

      expect(data.display && 'order' in data.display).toBe(false)
    })

    it('still sends order 0, which is a real position rather than an absence', () => {
      const data = buildProjectData({ ...entry, order: 0 }, 'body', [], true, null)

      expect(data.display?.order).toBe(0)
    })
  })
})

describe('create and update ownership', () => {
  it('applies safe defaults when creating', () => {
    const data = buildProjectCreateData({
      caseStudy: null,
      entry,
      markdown: 'body',
      media: undefined,
      visibility: undefined,
    })
    expect(data.display).toMatchObject({ card_type: 'visual', featured: false, hide: true })
  })

  it('omits create defaults from an update unless explicitly requested', () => {
    const patch = buildProjectUpdateData({
      caseStudy: null,
      entry,
      markdown: 'body',
      media: undefined,
      visibility: undefined,
    })
    expect(patch.display).toBeUndefined()
    expect('live_link' in patch).toBe(true)
    expect('images' in patch).toBe(false)
  })

  it('retains explicit false, zero, and null clearing intentions', () => {
    const patch = buildProjectUpdateData({
      caseStudy: null,
      entry: {
        ...entry,
        cardType: null,
        featured: false,
        githubLink: null,
        liveUrl: null,
        order: 0,
        screenshots: null,
        snapshotLink: null,
      },
      markdown: 'body',
      media: null,
      visibility: false,
    })
    expect(patch).toMatchObject({
      display: { card_type: null, featured: false, hide: true, order: 0 },
      github_link: null,
      hero_image: null,
      images: null,
      live_link: null,
      snapshot_link: null,
      thumbnail: null,
    })
  })
})
