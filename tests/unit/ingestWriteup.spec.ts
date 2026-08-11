import { describe, expect, it } from 'vitest'

import { planProseGeneration } from '../../scripts/ingest/commands/writeup'

describe('writeup generation plan', () => {
  it('regenerates only a stale case study when the writeup remains current', () => {
    expect(
      planProseGeneration(
        {
          caseStudyAt: undefined,
          writeupAt: '2026-08-09T00:00:00.000Z',
        },
        false,
      ),
    ).toEqual({ caseStudy: true, writeup: false })
  })

  it('generates both artifacts when the writeup is stale or force is used', () => {
    expect(planProseGeneration({}, false)).toEqual({ caseStudy: true, writeup: true })
    expect(
      planProseGeneration(
        {
          caseStudyAt: '2026-08-09T00:00:00.000Z',
          writeupAt: '2026-08-09T00:00:00.000Z',
        },
        true,
      ),
    ).toEqual({ caseStudy: true, writeup: true })
  })

  it('skips generation when both artifacts are current', () => {
    expect(
      planProseGeneration(
        {
          caseStudyAt: '2026-08-09T00:00:00.000Z',
          writeupAt: '2026-08-09T00:00:00.000Z',
        },
        false,
      ),
    ).toEqual({ caseStudy: false, writeup: false })
  })
})
