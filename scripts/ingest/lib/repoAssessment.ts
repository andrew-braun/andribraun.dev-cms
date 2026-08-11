import type { JsonSchema } from '@/app/lib/ai/claude'

import type { EntryContext } from './types'

import { IngestError } from './log'

export type RepoFindingCategory =
  'architecture' | 'capability' | 'delivery' | 'quality' | 'technology'
export type RepoFindingConfidence = 'high' | 'low' | 'medium'

export interface RepoEvidence {
  path: string
  rationale: string
}

export interface RepoFinding {
  category: RepoFindingCategory
  claim: string
  confidence: RepoFindingConfidence
  evidence: RepoEvidence[]
}

export interface RepoAssessment {
  analysisFingerprint: string
  findings: RepoFinding[]
  generatedAt: string
  purpose?: string
  repository?: string
  slug: string
  status: 'assessed' | 'unavailable'
  technologies: string[]
  unavailableReason?: string
  unknowns: string[]
  version: 1
}

export interface RepoAssessmentMetadata {
  analysisFingerprint: string
  generatedAt: string
  slug: string
}

const CATEGORIES: RepoFindingCategory[] = [
  'architecture',
  'capability',
  'delivery',
  'quality',
  'technology',
]
const CONFIDENCES: RepoFindingConfidence[] = ['high', 'medium', 'low']

export const repoAssessmentOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    findings: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          category: { type: 'string', enum: [...CATEGORIES] },
          claim: { type: 'string', maxLength: 800, minLength: 1 },
          confidence: { type: 'string', enum: [...CONFIDENCES] },
          evidence: {
            type: 'array',
            items: {
              type: 'object',
              additionalProperties: false,
              properties: {
                path: { type: 'string', maxLength: 500, minLength: 1 },
                rationale: { type: 'string', maxLength: 500, minLength: 1 },
              },
              required: ['path', 'rationale'],
            },
            maxItems: 6,
            minItems: 1,
          },
        },
        required: ['category', 'claim', 'confidence', 'evidence'],
      },
      maxItems: 12,
    },
    purpose: { type: 'string', maxLength: 1000, minLength: 1 },
    technologies: {
      type: 'array',
      items: { type: 'string', maxLength: 100, minLength: 1 },
      maxItems: 30,
    },
    unknowns: {
      type: 'array',
      items: { type: 'string', maxLength: 500, minLength: 1 },
      maxItems: 12,
    },
  },
  required: ['findings', 'technologies', 'unknowns'],
}

function object(value: unknown, field: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new IngestError(`${field} must be an object`)
  }
  return value as Record<string, unknown>
}

function text(value: unknown, field: string, maxLength?: number): string {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new IngestError(`${field} must be a non-empty string`)
  }
  const trimmed = value.trim()
  if (maxLength !== undefined && trimmed.length > maxLength) {
    throw new IngestError(`${field} must be at most ${maxLength} characters`)
  }
  return trimmed
}

function textArray(
  value: unknown,
  field: string,
  options: { itemMaxLength: number; maxItems: number },
): string[] {
  if (!Array.isArray(value)) {
    throw new IngestError(`${field} must be an array`)
  }
  if (value.length > options.maxItems) {
    throw new IngestError(`${field} must contain at most ${options.maxItems} items`)
  }
  return [
    ...new Set(value.map((item, index) => text(item, `${field}[${index}]`, options.itemMaxLength))),
  ]
}

export function validateRepoAssessment(
  raw: unknown,
  context: EntryContext,
  metadata: RepoAssessmentMetadata,
): RepoAssessment {
  if (!context.repo) {
    throw new IngestError(`${metadata.slug}: repository context is unavailable`)
  }
  const input = object(raw, 'repository assessment')
  if (!Array.isArray(input.findings)) {
    throw new IngestError('repository assessment.findings must be an array')
  }
  if (input.findings.length > 12) {
    throw new IngestError('repository assessment.findings must contain at most 12 items')
  }
  const knownPaths = new Set(Object.keys(context.repo.files))
  const findings = input.findings.map((value, findingIndex): RepoFinding => {
    const finding = object(value, `findings[${findingIndex}]`)
    const claim = text(finding.claim, `findings[${findingIndex}].claim`, 800)
    if (!CATEGORIES.includes(finding.category as RepoFindingCategory)) {
      throw new IngestError(`findings[${findingIndex}].category must be ${CATEGORIES.join(', ')}`)
    }
    if (!CONFIDENCES.includes(finding.confidence as RepoFindingConfidence)) {
      throw new IngestError(`findings[${findingIndex}].confidence must be high, medium, or low`)
    }
    if (!Array.isArray(finding.evidence) || finding.evidence.length === 0) {
      throw new IngestError(`findings[${findingIndex}] requires evidence`)
    }
    if (finding.evidence.length > 6) {
      throw new IngestError(`findings[${findingIndex}].evidence must contain at most 6 items`)
    }
    const evidence = finding.evidence.map((value, evidenceIndex): RepoEvidence => {
      const item = object(value, `findings[${findingIndex}].evidence[${evidenceIndex}]`)
      const sourcePath = text(
        item.path,
        `findings[${findingIndex}].evidence[${evidenceIndex}].path`,
        500,
      )
      if (!knownPaths.has(sourcePath)) {
        throw new IngestError(
          `findings[${findingIndex}] references unknown source path "${sourcePath}"`,
        )
      }
      return {
        path: sourcePath,
        rationale: text(
          item.rationale,
          `findings[${findingIndex}].evidence[${evidenceIndex}].rationale`,
          500,
        ),
      }
    })
    return {
      category: finding.category as RepoFindingCategory,
      claim,
      confidence: finding.confidence as RepoFindingConfidence,
      evidence,
    }
  })

  return {
    ...metadata,
    findings,
    purpose: input.purpose === undefined ? undefined : text(input.purpose, 'purpose', 1000),
    repository: context.repo.repo,
    status: 'assessed',
    technologies: textArray(input.technologies, 'technologies', {
      itemMaxLength: 100,
      maxItems: 30,
    }),
    unknowns: textArray(input.unknowns, 'unknowns', { itemMaxLength: 500, maxItems: 12 }),
    version: 1,
  }
}

export function unavailableRepoAssessment(
  metadata: RepoAssessmentMetadata,
  reason: string,
): RepoAssessment {
  return {
    ...metadata,
    findings: [],
    status: 'unavailable',
    technologies: [],
    unavailableReason: text(reason, 'unavailableReason'),
    unknowns: ['Repository implementation details are unavailable.'],
    version: 1,
  }
}

export function validateStoredRepoAssessment(
  raw: unknown,
  context: EntryContext,
  expectedAnalysisFingerprint: string,
): RepoAssessment {
  const input = object(raw, 'stored repository assessment')
  if (input.version !== 1) {
    throw new IngestError('stored repository assessment.version must be 1')
  }
  const slug = text(input.slug, 'stored repository assessment.slug')
  if (slug !== context.slug) {
    throw new IngestError(
      `stored repository assessment slug "${slug}" does not match "${context.slug}"`,
    )
  }
  const generatedAt = text(input.generatedAt, 'stored repository assessment.generatedAt')
  if (Number.isNaN(Date.parse(generatedAt))) {
    throw new IngestError('stored repository assessment.generatedAt must be an ISO timestamp')
  }
  const analysisFingerprint = text(
    input.analysisFingerprint,
    'stored repository assessment.analysisFingerprint',
  )
  if (analysisFingerprint !== expectedAnalysisFingerprint) {
    throw new IngestError('stored repository assessment analysis fingerprint does not match')
  }

  const metadata = { slug, analysisFingerprint, generatedAt }
  if (input.status === 'assessed') {
    if (!context.repo) {
      throw new IngestError('stored assessed repository requires repository context')
    }
    const assessment = validateRepoAssessment(input, context, metadata)
    if (input.repository !== context.repo.repo) {
      throw new IngestError('stored repository identity does not match analyzed context')
    }
    return assessment
  }
  if (input.status !== 'unavailable') {
    throw new IngestError('stored repository assessment.status must be assessed or unavailable')
  }
  if (context.repo) {
    throw new IngestError(
      'stored repository assessment cannot be unavailable when repository context exists',
    )
  }
  if (!Array.isArray(input.findings) || input.findings.length > 0) {
    throw new IngestError('unavailable repository assessment.findings must be empty')
  }
  if (!Array.isArray(input.technologies) || input.technologies.length > 0) {
    throw new IngestError('unavailable repository assessment.technologies must be empty')
  }
  return {
    ...metadata,
    findings: [],
    status: 'unavailable',
    technologies: [],
    unavailableReason: text(input.unavailableReason, 'unavailableReason'),
    unknowns: textArray(input.unknowns, 'unknowns', { itemMaxLength: 500, maxItems: 12 }),
    version: 1,
  }
}

export function renderRepoAssessment(assessment: RepoAssessment): string {
  const lines = [
    `Repository assessment status: ${assessment.status}`,
    assessment.repository ? `Repository: ${assessment.repository}` : '',
    assessment.purpose ? `Purpose: ${assessment.purpose}` : '',
  ].filter(Boolean)

  if (assessment.findings.length > 0) {
    lines.push('Findings:')
    for (const finding of assessment.findings) {
      const evidence = finding.evidence.map((item) => `${item.path} (${item.rationale})`).join('; ')
      lines.push(
        `- [${finding.category}; ${finding.confidence}] ${finding.claim} Evidence: ${evidence}`,
      )
    }
  }
  if (assessment.technologies.length > 0) {
    lines.push(`Technologies: ${assessment.technologies.join(', ')}`)
  }
  if (assessment.unknowns.length > 0) {
    lines.push('Unknowns:', ...assessment.unknowns.map((item) => `- ${item}`))
  }
  if (assessment.unavailableReason) {
    lines.push(`Unavailable reason: ${assessment.unavailableReason}`)
  }
  return lines.join('\n')
}
