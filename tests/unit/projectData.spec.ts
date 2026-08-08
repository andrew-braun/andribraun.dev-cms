import { describe, expect, it } from 'vitest'

import type { CaseStudySidecar } from '../../scripts/ingest/lib/caseStudy'
import type { ManifestEntry } from '../../scripts/ingest/lib/types'

import { buildProjectData } from '../../scripts/ingest/lib/projectData'

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
})
