import type { JsonSchema } from '@/app/lib/ai/claude'

export type ProjectStatus = 'archived' | 'completed' | 'live' | 'ongoing'

export type CaseStudyFieldKey =
  'business_challenge' | 'client_name' | 'contribution_highlights' | 'outcomes' | 'status'

export const CASE_STUDY_FIELD_KEYS: CaseStudyFieldKey[] = [
  'client_name',
  'business_challenge',
  'contribution_highlights',
  'outcomes',
  'status',
]

export const PROJECT_STATUSES: ProjectStatus[] = ['live', 'ongoing', 'completed', 'archived']

export interface CaseStudySidecar {
  business_challenge?: string
  client_name?: string
  contribution_highlights?: { statement: string }[]
  needsReview: CaseStudyFieldKey[]
  outcomes?: { metric?: string; statement: string }[]
  status?: ProjectStatus
}

export const caseStudyOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    business_challenge: { type: 'string' },
    client_name: { type: 'string' },
    contribution_highlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { statement: { type: 'string' } },
        required: ['statement'],
      },
    },
    needsReview: {
      type: 'array',
      items: { type: 'string', enum: [...CASE_STUDY_FIELD_KEYS] },
    },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          metric: { type: 'string' },
          statement: { type: 'string' },
        },
        required: ['statement'],
      },
    },
    status: { type: 'string', enum: [...PROJECT_STATUSES] },
  },
  required: ['needsReview'],
}

export function emptyCaseStudyStub(): CaseStudySidecar {
  return { needsReview: [...CASE_STUDY_FIELD_KEYS] }
}

function isStatus(value: unknown): value is ProjectStatus {
  return typeof value === 'string' && (PROJECT_STATUSES as string[]).includes(value)
}

function isFieldKey(value: unknown): value is CaseStudyFieldKey {
  return typeof value === 'string' && (CASE_STUDY_FIELD_KEYS as string[]).includes(value)
}

/**
 * Coerces model / file JSON into a publishable sidecar. Invalid status is
 * dropped and flagged. Empty statements are removed. Any case-study field that
 * is still empty after coercion is added to needsReview (union with model list).
 */
export function normalizeCaseStudy(raw: unknown): CaseStudySidecar {
  if (!raw || typeof raw !== 'object') {
    return emptyCaseStudyStub()
  }

  const input = raw as Record<string, unknown>
  const result: CaseStudySidecar = { needsReview: [] }

  if (typeof input.client_name === 'string' && input.client_name.trim()) {
    result.client_name = input.client_name.trim()
  }

  if (typeof input.business_challenge === 'string' && input.business_challenge.trim()) {
    result.business_challenge = input.business_challenge.trim()
  }

  if (Array.isArray(input.contribution_highlights)) {
    const highlights = input.contribution_highlights
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null
        }
        const statement = (row as { statement?: unknown }).statement
        if (typeof statement !== 'string' || !statement.trim()) {
          return null
        }
        return { statement: statement.trim() }
      })
      .filter((row): row is { statement: string } => row !== null)
    if (highlights.length > 0) {
      result.contribution_highlights = highlights
    }
  }

  if (Array.isArray(input.outcomes)) {
    const outcomes = input.outcomes
      .map((row) => {
        if (!row || typeof row !== 'object') {
          return null
        }
        const statement = (row as { statement?: unknown }).statement
        if (typeof statement !== 'string' || !statement.trim()) {
          return null
        }
        const metricRaw = (row as { metric?: unknown }).metric
        const metric =
          typeof metricRaw === 'string' && metricRaw.trim() ? metricRaw.trim() : undefined
        return metric ? { metric, statement: statement.trim() } : { statement: statement.trim() }
      })
      .filter((row): row is { metric?: string; statement: string } => row !== null)
    if (outcomes.length > 0) {
      result.outcomes = outcomes
    }
  }

  if (isStatus(input.status)) {
    result.status = input.status
  } else if (input.status != null && input.status !== '') {
    result.needsReview.push('status')
  }

  const fromModel = Array.isArray(input.needsReview) ? input.needsReview.filter(isFieldKey) : []

  const missing: CaseStudyFieldKey[] = []
  if (!result.client_name) {
    missing.push('client_name')
  }
  if (!result.business_challenge) {
    missing.push('business_challenge')
  }
  if (!result.contribution_highlights) {
    missing.push('contribution_highlights')
  }
  if (!result.outcomes) {
    missing.push('outcomes')
  }
  if (!result.status) {
    missing.push('status')
  }

  result.needsReview = [...new Set([...fromModel, ...missing, ...result.needsReview])]
  return result
}
