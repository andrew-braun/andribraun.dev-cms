import { describe, expect, it } from 'vitest'

import { renderCaseStudyBriefing } from '../../scripts/ingest/lib/ai'
import {
  CASE_STUDY_FIELD_KEYS,
  caseStudyOutputSchema,
  emptyCaseStudyStub,
  normalizeCaseStudy,
  preferWriteupSummary,
  validateCaseStudySidecar,
  validateGeneratedCaseStudy,
} from '../../scripts/ingest/lib/caseStudy'

describe('case-study briefing', () => {
  it('includes assessed evidence and the writeup without raw repository content or trees', () => {
    const briefing = renderCaseStudyBriefing({
      assessment: {
        slug: 'alpha',
        analysisFingerprint: 'a'.repeat(64),
        findings: [
          {
            category: 'architecture',
            claim: 'The app uses a service boundary.',
            confidence: 'high',
            evidence: [{ path: 'src/service.ts', rationale: 'Exports the service interface.' }],
          },
        ],
        generatedAt: '2026-08-09T00:00:00.000Z',
        repository: 'example/alpha',
        status: 'assessed',
        technologies: ['TypeScript'],
        unknowns: [],
        version: 1,
      },
      context: {
        slug: 'alpha',
        gatheredAt: '2026-08-09T00:00:00.000Z',
        repo: {
          defaultBranch: 'main',
          files: { 'src/service.ts': 'SECRET_SOURCE_BODY' },
          languages: { TypeScript: 100 },
          repo: 'example/alpha',
          topics: [],
          tree: ['src/service.ts', 'private/tree-only.txt'],
        },
        site: { navLinks: [], ok: true, signals: ['Next.js'], url: 'https://alpha.test/' },
        title: 'Alpha',
      },
      notes: 'Built for a client team.',
      writeup: 'Completed portfolio writeup.',
    })

    expect(briefing).toContain('The app uses a service boundary.')
    expect(briefing).toContain('src/service.ts')
    expect(briefing).toContain('Completed portfolio writeup.')
    expect(briefing).not.toContain('SECRET_SOURCE_BODY')
    expect(briefing).not.toContain('private/tree-only.txt')
  })
})

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

  it('treats empty optional model fields as omitted and flags them for review', () => {
    const result = validateGeneratedCaseStudy({ client_name: '', needsReview: ['client_name'] })

    expect(result.client_name).toBeUndefined()
    expect(result.needsReview).toContain('client_name')
    expect(() => validateCaseStudySidecar(result)).not.toThrow()
  })
})

describe('preferWriteupSummary', () => {
  it('preserves a valid 20–45 word generated summary', () => {
    const summary =
      'A focused platform for advisors that organizes student applications, deadlines, and next steps while helping each applicant receive practical one-to-one guidance throughout the process.'

    expect(
      preferWriteupSummary({ needsReview: [], summary }, 'A much longer writeup introduction.')
        .summary,
    ).toBe(summary)
  })

  it('uses a review-marked 20–45 word fallback when the generated summary is invalid', () => {
    const result = preferWriteupSummary(
      { needsReview: [], summary: 'Too brief.' },
      'The platform gives advisors a focused workspace for coordinating student applications, deadlines, and decisions while keeping every applicant informed about the next practical step.',
    )

    expect(result.needsReview).toContain('summary')
    expect(result.summary?.trim().split(/\s+/)).toHaveLength(24)
  })
})

describe('stored case-study validation', () => {
  it('accepts a normalized sidecar with explicit review fields', () => {
    const sidecar = normalizeCaseStudy({
      business_challenge: 'A clear challenge.',
      needsReview: ['client_name'],
      status: 'live',
      summary: 'A concise summary.',
    })
    expect(validateCaseStudySidecar(sidecar)).toEqual(sidecar)
  })

  it('rejects parseable JSON that is not a valid sidecar', () => {
    expect(() => validateCaseStudySidecar({})).toThrow('needsReview must be an array')
    expect(() => validateCaseStudySidecar({ needsReview: [], status: 'shipping' })).toThrow(
      'status is invalid',
    )
    expect(() =>
      validateCaseStudySidecar({ contribution_highlights: [{ statement: '' }], needsReview: [] }),
    ).toThrow('contribution_highlights contains an invalid row')
  })

  it('enforces schema bounds locally after wire-schema transformation', () => {
    expect(() => validateCaseStudySidecar({ needsReview: [], summary: 'x'.repeat(801) })).toThrow(
      'summary must be at most 800 characters',
    )
    expect(() =>
      validateCaseStudySidecar({
        contribution_highlights: Array.from({ length: 7 }, () => ({ statement: 'Built it.' })),
        needsReview: [],
      }),
    ).toThrow('contribution_highlights must contain at most 6 rows')
    expect(() =>
      validateCaseStudySidecar({ needsReview: [...CASE_STUDY_FIELD_KEYS, 'summary'] }),
    ).toThrow('needsReview must contain at most 6 fields')
  })
})

describe('case-study output schema bounds', () => {
  it('bounds freeform strings and arrays to prevent token-limit decoder loops', () => {
    const summary = caseStudyOutputSchema.properties?.summary
    const outcomes = caseStudyOutputSchema.properties?.outcomes

    expect(summary).toMatchObject({ type: 'string', maxLength: 800 })
    expect(outcomes).toMatchObject({ type: 'array', maxItems: 6 })
  })
})
