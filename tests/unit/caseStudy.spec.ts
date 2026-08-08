import { describe, expect, it } from 'vitest'

import {
  CASE_STUDY_FIELD_KEYS,
  emptyCaseStudyStub,
  normalizeCaseStudy,
} from '../../scripts/ingest/lib/caseStudy'

describe('emptyCaseStudyStub', () => {
  it('flags every case-study field for review', () => {
    const stub = emptyCaseStudyStub()
    expect(stub.needsReview).toEqual([...CASE_STUDY_FIELD_KEYS])
    expect(stub.client_name).toBeUndefined()
    expect(stub.contribution_highlights).toBeUndefined()
  })
})

describe('normalizeCaseStudy', () => {
  it('keeps valid fields and drops invalid status', () => {
    const result = normalizeCaseStudy({
      business_challenge: 'Fragmented planning.',
      client_name: ' WhereNext.ai ',
      contribution_highlights: [{ statement: 'Built end-to-end' }, { statement: '  ' }],
      needsReview: ['status'],
      outcomes: [
        { metric: 'From idea to live product', statement: 'End-to-end experience' },
        { metric: 'ignored', statement: '' },
      ],
      status: 'shipping',
    })

    expect(result.client_name).toBe('WhereNext.ai')
    expect(result.business_challenge).toBe('Fragmented planning.')
    expect(result.contribution_highlights).toEqual([{ statement: 'Built end-to-end' }])
    expect(result.outcomes).toEqual([
      { metric: 'From idea to live product', statement: 'End-to-end experience' },
    ])
    expect(result.status).toBeUndefined()
    expect(result.needsReview).toContain('status')
  })

  it('accepts valid status and merges missing fields into needsReview', () => {
    const result = normalizeCaseStudy({
      needsReview: [],
      status: 'live',
    })
    expect(result.status).toBe('live')
    expect(result.needsReview).toEqual(
      expect.arrayContaining([
        'client_name',
        'business_challenge',
        'contribution_highlights',
        'outcomes',
      ]),
    )
    expect(result.needsReview).not.toContain('status')
  })

  it('returns a full stub for non-objects', () => {
    expect(normalizeCaseStudy(null).needsReview).toEqual([...CASE_STUDY_FIELD_KEYS])
  })
})
