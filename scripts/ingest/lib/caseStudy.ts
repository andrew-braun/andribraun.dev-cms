import type { JsonSchema } from '@/app/lib/ai/claude'

import { IngestError } from './log'

export type ProjectStatus = 'archived' | 'completed' | 'live' | 'ongoing'

/**
 * Every structured Project field the sidecar carries. `summary` is not part of
 * the admin's "case study" group, but it is generated and reviewed the same
 * way, so it rides along rather than needing a second sidecar.
 */
export type CaseStudyFieldKey =
  | 'business_challenge'
  | 'client_name'
  | 'contribution_highlights'
  | 'outcomes'
  | 'status'
  | 'summary'

export const CASE_STUDY_FIELD_KEYS: CaseStudyFieldKey[] = [
  'summary',
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
  /** Short standalone blurb for the Project `summary` field. Plain markdown. */
  summary?: string
}

export const caseStudyOutputSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    business_challenge: { type: 'string', maxLength: 1500, minLength: 1 },
    client_name: { type: 'string', maxLength: 200, minLength: 1 },
    contribution_highlights: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: { statement: { type: 'string', maxLength: 500, minLength: 1 } },
        required: ['statement'],
      },
      maxItems: 6,
    },
    needsReview: {
      type: 'array',
      items: { type: 'string', enum: [...CASE_STUDY_FIELD_KEYS] },
      maxItems: CASE_STUDY_FIELD_KEYS.length,
    },
    outcomes: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          metric: { type: 'string', maxLength: 160, minLength: 1 },
          statement: { type: 'string', maxLength: 500, minLength: 1 },
        },
        required: ['statement'],
      },
      maxItems: 6,
    },
    status: { type: 'string', enum: [...PROJECT_STATUSES] },
    summary: { type: 'string', maxLength: 800, minLength: 1 },
  },
  required: ['needsReview'],
}

export function emptyCaseStudyStub(): CaseStudySidecar {
  return { needsReview: [...CASE_STUDY_FIELD_KEYS] }
}

/** Unwraps `<span class="tech" ...>Name</span>` markers to their label text. */
function stripTechSpans(value: string): string {
  return value
    .replace(/<span[^>]*>([\s\S]*?)<\/span>/g, '$1')
    .replace(/[ \t]+/g, ' ')
    .trim()
}

/**
 * Falls back to the write-up's opening paragraph when the model omits
 * `summary`. The write-up instructions already open with a 2–3 sentence
 * layperson introduction, which is the same job the `summary` field does.
 * `summary` stays in `needsReview` either way — an intro written to sit above
 * the full description usually wants trimming to stand on its own.
 */
export function summaryFromWriteup(markdown: string): string | undefined {
  const paragraph = markdown
    .split(/\n\s*\n/)
    .map((block) => block.trim())
    .find((block) => block !== '' && !block.startsWith('#') && !block.startsWith('```'))

  if (!paragraph) {
    return undefined
  }

  const plain = stripTechSpans(paragraph)
  if (plain === '') {
    return undefined
  }
  if (plain.length <= 800) {
    return plain
  }
  const clipped = plain.slice(0, 797)
  const boundary = clipped.lastIndexOf(' ')
  return `${clipped.slice(0, boundary > 0 ? boundary : undefined).trimEnd()}...`
}

/**
 * Listing summaries are always derived from the completed, grounded writeup.
 * This avoids persisting fluent-looking decoder tails from a separate
 * structured-output field while keeping the rest of the sidecar independent.
 */
export function preferWriteupSummary(
  caseStudy: CaseStudySidecar,
  markdown: string,
): CaseStudySidecar {
  const summary = summaryFromWriteup(markdown)
  return summary ? { ...caseStudy, summary } : caseStudy
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

  if (typeof input.summary === 'string' && input.summary.trim()) {
    // Tech spans belong to description_markdown — the extraction service only
    // reads that field, so a span here would render as literal markup.
    result.summary = stripTechSpans(input.summary)
  }

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
  if (!result.summary) {
    missing.push('summary')
  }
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

export function validateCaseStudySidecar(raw: unknown): CaseStudySidecar {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new IngestError('case study must be an object')
  }
  const input = raw as Record<string, unknown>
  const allowed = new Set(['needsReview', ...CASE_STUDY_FIELD_KEYS])
  const unknown = Object.keys(input).find((key) => !allowed.has(key as CaseStudyFieldKey))
  if (unknown) {
    throw new IngestError(`case study contains unknown field "${unknown}"`)
  }
  if (!Array.isArray(input.needsReview)) {
    throw new IngestError('case study needsReview must be an array')
  }
  if (input.needsReview.some((field) => !isFieldKey(field))) {
    throw new IngestError('case study needsReview contains an invalid field')
  }
  if (input.needsReview.length > CASE_STUDY_FIELD_KEYS.length) {
    throw new IngestError(
      `case study needsReview must contain at most ${CASE_STUDY_FIELD_KEYS.length} fields`,
    )
  }
  const stringBounds = {
    business_challenge: 1500,
    client_name: 200,
    summary: 800,
  } as const
  for (const field of ['summary', 'client_name', 'business_challenge'] as const) {
    if (input[field] !== undefined && (typeof input[field] !== 'string' || !input[field].trim())) {
      throw new IngestError(`case study ${field} must be a non-empty string`)
    }
    if (typeof input[field] === 'string' && input[field].trim().length > stringBounds[field]) {
      throw new IngestError(`case study ${field} must be at most ${stringBounds[field]} characters`)
    }
  }
  if (input.status !== undefined && !isStatus(input.status)) {
    throw new IngestError('case study status is invalid')
  }
  if (input.contribution_highlights !== undefined) {
    if (Array.isArray(input.contribution_highlights) && input.contribution_highlights.length > 6) {
      throw new IngestError('case study contribution_highlights must contain at most 6 rows')
    }
    if (
      !Array.isArray(input.contribution_highlights) ||
      input.contribution_highlights.some(
        (row) =>
          !row ||
          typeof row !== 'object' ||
          typeof (row as { statement?: unknown }).statement !== 'string' ||
          !(row as { statement: string }).statement.trim(),
      )
    ) {
      throw new IngestError('case study contribution_highlights contains an invalid row')
    }
    if (
      input.contribution_highlights.some(
        (row) => (row as { statement: string }).statement.trim().length > 500,
      )
    ) {
      throw new IngestError(
        'case study contribution_highlights statements must be at most 500 characters',
      )
    }
  }
  if (input.outcomes !== undefined) {
    if (Array.isArray(input.outcomes) && input.outcomes.length > 6) {
      throw new IngestError('case study outcomes must contain at most 6 rows')
    }
    if (
      !Array.isArray(input.outcomes) ||
      input.outcomes.some((row) => {
        if (!row || typeof row !== 'object') {
          return true
        }
        const outcome = row as { metric?: unknown; statement?: unknown }
        return (
          typeof outcome.statement !== 'string' ||
          !outcome.statement.trim() ||
          (outcome.metric !== undefined &&
            (typeof outcome.metric !== 'string' || !outcome.metric.trim()))
        )
      })
    ) {
      throw new IngestError('case study outcomes contains an invalid row')
    }
    if (
      input.outcomes.some((row) => {
        const outcome = row as { metric?: string; statement: string }
        return outcome.statement.trim().length > 500 || (outcome.metric?.trim().length ?? 0) > 160
      })
    ) {
      throw new IngestError('case study outcomes exceed local string bounds')
    }
  }
  return normalizeCaseStudy(input)
}

/**
 * Structured-output providers can materialize an omitted optional string as an
 * empty value. Treat those model-only placeholders as omissions, then apply the
 * same strict validation used for persisted sidecars.
 */
export function validateGeneratedCaseStudy(raw: unknown): CaseStudySidecar {
  return validateCaseStudySidecar(normalizeCaseStudy(raw))
}
