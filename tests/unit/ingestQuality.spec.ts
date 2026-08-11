import { describe, expect, it } from 'vitest'

import type { CapturedShot, EntryContext, ManifestEntry } from '../../scripts/ingest/lib/types'

import {
  buildQualityReport,
  requiresScreenshotArtifact,
} from '../../scripts/ingest/commands/quality'
import { evaluateEntryQuality } from '../../scripts/ingest/lib/quality'

function entry(): ManifestEntry {
  return { slug: 'alpha', stages: {}, title: 'Alpha' }
}

function shot(overrides: Partial<CapturedShot> = {}): CapturedShot {
  return {
    alt: 'Alpha homepage with clear navigation and service highlights.',
    file: 'home.png',
    height: 1440,
    hero: true,
    label: 'Home',
    url: 'https://alpha.test/',
    width: 2560,
    ...overrides,
  }
}

describe('ingestion quality evaluation', () => {
  it('reports review, authorship, summary, alt, and capture warnings together', () => {
    const result = evaluateEntryQuality({
      caseStudy: {
        contribution_highlights: [{ statement: 'Designed and built the platform.' }],
        needsReview: ['outcomes'],
        summary: Array.from({ length: 50 }, (_, index) => `word${index + 1}`).join(' '),
      },
      context: { slug: 'alpha', gatheredAt: '2026-08-11T00:00:00.000Z', title: 'Alpha' },
      entry: entry(),
      shots: [shot({ alt: 'Alpha — Home', captureIssues: ['cookie-consent'] })],
    })

    expect(result.warnings.map((warning) => warning.code)).toEqual([
      'case-study-needs-review',
      'unverified-authorship',
      'summary-length',
      'generic-screenshot-alt',
      'screenshot-capture-issue',
    ])
  })

  it('does not warn for a fully evidenced entry with descriptive alt text', () => {
    const context: EntryContext = {
      slug: 'alpha',
      gatheredAt: '2026-08-11T00:00:00.000Z',
      notes: 'I designed and implemented this project for the client.',
      title: 'Alpha',
    }
    const result = evaluateEntryQuality({
      caseStudy: {
        contribution_highlights: [{ statement: 'Designed and built the platform.' }],
        needsReview: [],
        outcomes: [{ statement: 'Delivered a focused customer experience.' }],
        summary: Array.from({ length: 20 }, (_, index) => `word${index + 1}`).join(' '),
      },
      context,
      entry: entry(),
      shots: [shot()],
    })

    expect(result.warnings).toEqual([])
  })

  it('keeps a per-entry missing artifact failure in the report', () => {
    return buildQualityReport(
      [entry()],
      () => Promise.reject(new Error('case-study.json is unavailable')),
      '2026-08-11T00:00:00.000Z',
    ).then((report) => {
      expect(report).toMatchObject({
        generatedAt: '2026-08-11T00:00:00.000Z',
        summary: { byCode: { 'missing-artifact': 1 }, entries: 1, warnings: 1 },
        version: 1,
      })
      expect(report.entries[0].warnings[0].code).toBe('missing-artifact')
    })
  })

  it('does not require screenshots for an entry without a deployed site', () => {
    expect(requiresScreenshotArtifact(entry())).toBe(false)
    expect(requiresScreenshotArtifact({ ...entry(), liveUrl: 'https://alpha.test/' })).toBe(true)
  })
})
