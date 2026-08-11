import { describe, expect, it } from 'vitest'

import type { ManifestEntry } from '../../scripts/ingest/lib/types'

import { formatQualityReportStatus, isEntryReady } from '../../scripts/ingest/commands/status'

function entry(stages: ManifestEntry['stages'], skip = false): ManifestEntry {
  return { slug: 'alpha', skip, stages, title: 'Alpha' }
}

describe('ingest status readiness', () => {
  it('requires current assessment, writeup, case study, and checklist', () => {
    const complete = entry({
      assessedAt: '2026-08-09T00:00:00.000Z',
      caseStudyAt: '2026-08-09T00:00:00.000Z',
      writeupAt: '2026-08-09T00:00:00.000Z',
    })

    expect(isEntryReady(complete, true)).toBe(true)
    expect(
      isEntryReady({ ...complete, stages: { ...complete.stages, caseStudyAt: undefined } }, true),
    ).toBe(false)
    expect(isEntryReady(complete, false)).toBe(false)
  })

  it('never reports skipped entries as ready', () => {
    expect(
      isEntryReady(
        entry(
          {
            assessedAt: '2026-08-09T00:00:00.000Z',
            caseStudyAt: '2026-08-09T00:00:00.000Z',
            writeupAt: '2026-08-09T00:00:00.000Z',
          },
          true,
        ),
        true,
      ),
    ).toBe(false)
  })

  it('renders the advisory warning count without changing readiness', () => {
    expect(formatQualityReportStatus({ summary: { warnings: 3 } } as never)).toBe(
      'Quality report: ingest/quality-report.json (3 warnings)',
    )
  })
})
