import { describe, expect, it } from 'vitest'

import type { EntryContext } from '../../scripts/ingest/lib/types'

import {
  renderRepoAssessment,
  repoAssessmentOutputSchema,
  unavailableRepoAssessment,
  validateRepoAssessment,
  validateStoredRepoAssessment,
} from '../../scripts/ingest/lib/repoAssessment'

const context: EntryContext = {
  slug: 'alpha',
  gatheredAt: '2026-08-09T00:00:00.000Z',
  repo: {
    defaultBranch: 'main',
    files: {
      'package.json': '{"scripts":{"test":"vitest"},"secret":"SECRET_SOURCE_BODY"}',
      'src/app.ts': 'export const app = true',
    },
    languages: { TypeScript: 100 },
    repo: 'example/alpha',
    topics: [],
    tree: ['package.json', 'src/app.ts', 'private/unread.txt'],
  },
  title: 'Alpha',
}

const metadata = {
  slug: 'alpha',
  analysisFingerprint: 'a'.repeat(64),
  generatedAt: '2026-08-09T01:00:00.000Z',
}

function validRaw() {
  return {
    findings: [
      {
        category: 'quality',
        claim: 'The repository defines an automated test command.',
        confidence: 'high',
        evidence: [{ path: 'package.json', rationale: 'The scripts object defines Vitest.' }],
      },
    ],
    purpose: 'A small TypeScript application.',
    technologies: ['TypeScript', 'Vitest'],
    unknowns: ['Production usage is not visible in the repository.'],
  }
}

describe('repository assessment validation', () => {
  it('bounds model-generated findings and claim lengths', () => {
    const findings = repoAssessmentOutputSchema.properties?.findings
    expect(findings).toMatchObject({ type: 'array', maxItems: 12 })
    expect(findings?.items?.properties?.claim).toMatchObject({ type: 'string', maxLength: 800 })
  })

  it('accepts and stamps source-backed findings', () => {
    expect(validateRepoAssessment(validRaw(), context, metadata)).toEqual({
      ...metadata,
      findings: validRaw().findings,
      purpose: 'A small TypeScript application.',
      repository: 'example/alpha',
      status: 'assessed',
      technologies: ['TypeScript', 'Vitest'],
      unknowns: ['Production usage is not visible in the repository.'],
      version: 1,
    })
  })

  it('rejects a substantive finding without evidence', () => {
    const raw = validRaw()
    raw.findings[0].evidence = []

    expect(() => validateRepoAssessment(raw, context, metadata)).toThrow('requires evidence')
  })

  it('rejects evidence paths that were not read during analysis', () => {
    const raw = validRaw()
    raw.findings[0].evidence[0].path = 'private/unread.txt'

    expect(() => validateRepoAssessment(raw, context, metadata)).toThrow(
      'unknown source path "private/unread.txt"',
    )
  })

  it('rejects unsupported confidence levels and empty claims', () => {
    const confidence = validRaw() as Record<string, unknown>
    ;(confidence.findings as Array<Record<string, unknown>>)[0].confidence = 'certain'
    expect(() => validateRepoAssessment(confidence, context, metadata)).toThrow(
      'confidence must be high, medium, or low',
    )

    const empty = validRaw()
    empty.findings[0].claim = '   '
    expect(() => validateRepoAssessment(empty, context, metadata)).toThrow(
      'claim must be a non-empty string',
    )
  })

  it('enforces schema bounds locally after wire-schema transformation', () => {
    const tooMany = validRaw()
    tooMany.findings = Array.from({ length: 13 }, () => validRaw().findings[0])
    expect(() => validateRepoAssessment(tooMany, context, metadata)).toThrow(
      'findings must contain at most 12 items',
    )

    const longClaim = validRaw()
    longClaim.findings[0].claim = 'x'.repeat(801)
    expect(() => validateRepoAssessment(longClaim, context, metadata)).toThrow(
      'claim must be at most 800 characters',
    )

    const tooManyTechnologies = validRaw()
    tooManyTechnologies.technologies = Array.from({ length: 31 }, (_, index) => `Tech ${index}`)
    expect(() => validateRepoAssessment(tooManyTechnologies, context, metadata)).toThrow(
      'technologies must contain at most 30 items',
    )
  })

  it('creates a valid explicit unavailable state for projects without a repository', () => {
    expect(
      unavailableRepoAssessment(metadata, 'No repository is configured for this project.'),
    ).toEqual({
      ...metadata,
      findings: [],
      status: 'unavailable',
      technologies: [],
      unavailableReason: 'No repository is configured for this project.',
      unknowns: ['Repository implementation details are unavailable.'],
      version: 1,
    })
  })

  it('renders compact findings and citations without source file bodies or the tree', () => {
    const rendered = renderRepoAssessment(validateRepoAssessment(validRaw(), context, metadata))

    expect(rendered).toContain('The repository defines an automated test command.')
    expect(rendered).toContain('package.json')
    expect(rendered).not.toContain('SECRET_SOURCE_BODY')
    expect(rendered).not.toContain('private/unread.txt')
  })

  it('revalidates a stored assessment against current context and fingerprint', () => {
    const assessment = validateRepoAssessment(validRaw(), context, metadata)
    expect(validateStoredRepoAssessment(assessment, context, metadata.analysisFingerprint)).toEqual(
      assessment,
    )

    expect(() => validateStoredRepoAssessment(assessment, context, 'b'.repeat(64))).toThrow(
      'analysis fingerprint does not match',
    )
  })

  it('rejects malformed stored artifacts and invalid unavailable states', () => {
    expect(() => validateStoredRepoAssessment({}, context, metadata.analysisFingerprint)).toThrow(
      'version must be 1',
    )

    const unavailable = unavailableRepoAssessment(metadata, 'No repository configured.')
    expect(() =>
      validateStoredRepoAssessment(unavailable, context, metadata.analysisFingerprint),
    ).toThrow('cannot be unavailable when repository context exists')
  })
})
