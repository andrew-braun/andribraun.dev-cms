import type { CapturedShot, EntryContext, ManifestEntry } from './types'

import { type CaseStudySidecar, isSummaryWithinWordRange } from './caseStudy'

export type QualityWarningCode =
  | 'case-study-needs-review'
  | 'generic-screenshot-alt'
  | 'missing-artifact'
  | 'screenshot-capture-issue'
  | 'summary-length'
  | 'unverified-authorship'

export interface QualityWarning {
  code: QualityWarningCode
  message: string
  remediation: string
}

export interface QualityReportEntry {
  slug: string
  title: string
  warnings: QualityWarning[]
}

export interface QualityReport {
  entries: QualityReportEntry[]
  generatedAt: string
  summary: {
    byCode: Partial<Record<QualityWarningCode, number>>
    entries: number
    warnings: number
  }
  version: 1
}

export interface EntryQualityInput {
  caseStudy?: CaseStudySidecar | null
  context?: EntryContext | null
  entry: ManifestEntry
  shots?: CapturedShot[] | null
}

function warning(code: QualityWarningCode, message: string, remediation: string): QualityWarning {
  return { code, message, remediation }
}

export function evaluateEntryQuality(input: EntryQualityInput): QualityReportEntry {
  const { caseStudy, context, entry, shots = [] } = input
  const warnings: QualityWarning[] = []

  if (caseStudy?.needsReview.length) {
    warnings.push(
      warning(
        'case-study-needs-review',
        `Case-study fields need review: ${caseStudy.needsReview.join(', ')}.`,
        'Verify or complete the listed case-study fields before publication.',
      ),
    )
  }

  const hasAuthorshipClaims = Boolean(
    caseStudy?.contribution_highlights?.length || caseStudy?.outcomes?.length,
  )
  const hasFirstHandEvidence = Boolean(context?.notes?.trim() || context?.repo)
  if (hasAuthorshipClaims && !hasFirstHandEvidence) {
    warnings.push(
      warning(
        'unverified-authorship',
        'Contribution or outcome claims have no repository or authored-note evidence.',
        'Add a repository or authored notes that substantiate the claimed contribution.',
      ),
    )
  }

  if (caseStudy?.summary && !isSummaryWithinWordRange(caseStudy.summary)) {
    warnings.push(
      warning(
        'summary-length',
        'The case-study summary is outside the 20–45-word range.',
        'Edit the summary to a concise standalone blurb between 20 and 45 words.',
      ),
    )
  }

  for (const shot of shots) {
    if (shot.alt === `${entry.title} — ${shot.label}`) {
      warnings.push(
        warning(
          'generic-screenshot-alt',
          `${shot.label} uses the generic fallback alt text.`,
          'Replace it with descriptive alt text that identifies the interface and visible content.',
        ),
      )
    }
    for (const issue of shot.captureIssues ?? []) {
      warnings.push(
        warning(
          'screenshot-capture-issue',
          `${shot.label} was captured with a detected ${issue.replace('-', ' ')} issue.`,
          'Review the image and recapture it after resolving the visible page-state issue.',
        ),
      )
    }
  }

  return { slug: entry.slug, title: entry.title, warnings }
}

export function summarizeQuality(entries: QualityReportEntry[]): QualityReport['summary'] {
  const byCode: Partial<Record<QualityWarningCode, number>> = {}
  let warnings = 0
  for (const entry of entries) {
    for (const item of entry.warnings) {
      warnings += 1
      byCode[item.code] = (byCode[item.code] ?? 0) + 1
    }
  }
  return { byCode, entries: entries.length, warnings }
}
