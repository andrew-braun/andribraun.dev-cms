import type { ParsedArgs } from '../lib/args'
import type { CapturedShot, EntryContext, ManifestEntry } from '../lib/types'

import { atomicWriteJson } from '../lib/artifacts'
import { validateCaseStudySidecar } from '../lib/caseStudy'
import { log } from '../lib/log'
import { loadManifest, readJson, selectEntries } from '../lib/manifest'
import {
  caseStudyPath,
  contextPath,
  QUALITY_REPORT_PATH,
  rel,
  shotsDir,
  shotsManifestPath,
} from '../lib/paths'
import {
  type EntryQualityInput,
  evaluateEntryQuality,
  type QualityReport,
  type QualityReportEntry,
  type QualityWarning,
  summarizeQuality,
} from '../lib/quality'
import { validateCapturedShots } from '../lib/validation'

type LoadedQualityInput = Omit<EntryQualityInput, 'entry'>

export function requiresScreenshotArtifact(entry: ManifestEntry): boolean {
  return Boolean(entry.liveUrl)
}

function missingArtifactWarning(message: string): QualityWarning {
  return {
    code: 'missing-artifact',
    message: `Quality checks could not load ${message}.`,
    remediation: 'Regenerate the unavailable artifact, then run pnpm ingest quality again.',
  }
}

export async function buildQualityReport(
  entries: ManifestEntry[],
  load: (entry: ManifestEntry) => Promise<LoadedQualityInput>,
  generatedAt = new Date().toISOString(),
): Promise<QualityReport> {
  const reportEntries: QualityReportEntry[] = []
  for (const entry of entries) {
    try {
      reportEntries.push(evaluateEntryQuality({ entry, ...(await load(entry)) }))
    } catch (error) {
      reportEntries.push({
        slug: entry.slug,
        title: entry.title,
        warnings: [missingArtifactWarning(error instanceof Error ? error.message : String(error))],
      })
    }
  }
  return {
    entries: reportEntries,
    generatedAt,
    summary: summarizeQuality(reportEntries),
    version: 1,
  }
}

async function loadQualityInput(entry: ManifestEntry): Promise<LoadedQualityInput> {
  const context = await readJson<EntryContext>(contextPath(entry.slug))
  if (!context) {
    throw new Error('context.json')
  }

  const rawCaseStudy = await readJson<unknown>(caseStudyPath(entry.slug))
  if (!rawCaseStudy) {
    throw new Error('case-study.json')
  }
  const caseStudy = validateCaseStudySidecar(rawCaseStudy)

  if (!requiresScreenshotArtifact(entry)) {
    return { caseStudy, context, shots: [] }
  }
  const rawShots = await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))
  if (!rawShots) {
    throw new Error('shots.json')
  }
  await validateCapturedShots(rawShots, shotsDir(entry.slug))

  return { caseStudy, context, shots: rawShots }
}

export async function quality(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const report = await buildQualityReport(entries, loadQualityInput)
  await atomicWriteJson(QUALITY_REPORT_PATH, report)
  log.info(`${report.summary.warnings} warnings → ${rel(QUALITY_REPORT_PATH)}`)
}
