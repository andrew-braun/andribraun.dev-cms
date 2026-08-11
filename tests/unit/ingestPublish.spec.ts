import { describe, expect, it, vi } from 'vitest'

import type { PublishBackend } from '../../scripts/ingest/lib/backend'
import type { ManifestEntry } from '../../scripts/ingest/lib/types'

import { publicationReadinessIssue, publishEntry } from '../../scripts/ingest/commands/publish'

const entry: ManifestEntry = {
  slug: 'alpha',
  stages: { writeupAt: '2026-08-01T00:00:00.000Z' },
  title: 'Alpha',
}

function setup({ extractionFails = false, preflightFails = false } = {}) {
  const calls: string[] = []
  const backend: PublishBackend = {
    close: vi.fn(() => Promise.resolve()),
    createProject: vi.fn(() => {
      calls.push('create')
      return Promise.resolve(7)
    }),
    description: 'test',
    extractTechnologies: vi.fn(() => {
      calls.push('extract')
      if (extractionFails) {
        return Promise.reject(new Error('extract failed'))
      }
      return Promise.resolve({ created: [], linked: 0, message: 'ok', success: true })
    }),
    findProjectById: vi.fn(),
    findProjectBySlug: vi.fn(),
    target: 'test-target',
    updateProject: vi.fn(),
    uploadMedia: vi.fn(() => {
      calls.push('upload')
      return Promise.resolve(3)
    }),
  }
  const dependencies = {
    loadAndValidateArtifacts: vi.fn(() => {
      calls.push('validate')
      if (preflightFails) {
        return Promise.reject(new Error('bad artifact'))
      }
      return Promise.resolve({
        caseStudy: null,
        markdown: 'body',
        shots: [
          {
            alt: 'Alpha home',
            data: Buffer.from('png'),
            file: 'home.png',
            height: 1440,
            hero: true,
            label: 'Home',
            url: 'https://alpha.test',
            width: 2560,
          },
        ],
      })
    }),
    recordPublished: vi.fn(() => {
      calls.push('record')
      return Promise.resolve()
    }),
    resolve: vi.fn(() => {
      calls.push('resolve')
      return Promise.resolve({ action: 'create' as const })
    }),
  }
  return { backend, calls, dependencies }
}

describe('publishEntry ordering', () => {
  it('preflights, resolves, uploads, writes, records, then extracts', async () => {
    const fixture = setup()
    await publishEntry(entry, { backend: fixture.backend }, fixture.dependencies)
    expect(fixture.calls).toEqual(['validate', 'resolve', 'upload', 'create', 'record', 'extract'])
  })

  it('does not write or record after failed preflight', async () => {
    const fixture = setup({ preflightFails: true })
    await expect(
      publishEntry(entry, { backend: fixture.backend }, fixture.dependencies),
    ).rejects.toThrow('bad artifact')
    expect(fixture.calls).toEqual(['validate'])
  })

  it('treats extraction failure as a warning after a durable project write', async () => {
    const fixture = setup({ extractionFails: true })
    await expect(
      publishEntry(entry, { backend: fixture.backend }, fixture.dependencies),
    ).resolves.toBe(7)
    expect(fixture.calls).toEqual(['validate', 'resolve', 'upload', 'create', 'record', 'extract'])
  })
})

describe('publication readiness', () => {
  it('requires a separately completed case-study stage', () => {
    expect(
      publicationReadinessIssue({
        ...entry,
        stages: {
          assessedAt: '2026-08-09T00:00:00.000Z',
          writeupAt: '2026-08-09T00:00:00.000Z',
        },
      }),
    ).toBe('case study')
  })

  it('accepts entries with all required prose stages', () => {
    expect(
      publicationReadinessIssue({
        ...entry,
        stages: {
          assessedAt: '2026-08-09T00:00:00.000Z',
          caseStudyAt: '2026-08-09T00:00:00.000Z',
          writeupAt: '2026-08-09T00:00:00.000Z',
        },
      }),
    ).toBeUndefined()
  })
})
