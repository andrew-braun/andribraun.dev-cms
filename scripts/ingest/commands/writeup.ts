import fs from 'node:fs/promises'

import type { RepoAssessment } from '../lib/repoAssessment'
import type { EntryContext, StageState } from '../lib/types'

import { generateCaseStudy, generateWriteup } from '../lib/ai'
import { flagBoolean, type ParsedArgs } from '../lib/args'
import {
  atomicWriteFile,
  atomicWriteJson,
  reconcileEntryArtifacts,
  recordStageCompletion,
} from '../lib/artifacts'
import { runBatch } from '../lib/batch'
import { preferWriteupSummary } from '../lib/caseStudy'
import { IngestError, log } from '../lib/log'
import { loadManifest, readJson, selectEntries } from '../lib/manifest'
import { readNotes } from '../lib/notes'
import {
  caseStudyPath,
  contextPath,
  notesPath,
  rel,
  repoAssessmentPath,
  writeupPath,
} from '../lib/paths'
import { writeSheet } from '../lib/sheet'

export function planProseGeneration(
  stages: Pick<StageState, 'caseStudyAt' | 'writeupAt'>,
  force: boolean,
): { caseStudy: boolean; writeup: boolean } {
  const writeup = force || !stages.writeupAt
  return {
    caseStudy: force || writeup || !stages.caseStudyAt,
    writeup,
  }
}

/**
 * Turns each analyzed context bundle into a `description_markdown` body using
 * `ai/project.summary-instructions.md` as the system prompt, plus a structured
 * `case-study.json` sidecar for the case-study CMS fields. Outputs land in
 * `ingest/work/<slug>/` for review — nothing reaches the CMS here.
 */
export async function writeup(args: ParsedArgs): Promise<void> {
  if (!process.env.CLAUDE_API_KEY) {
    throw new IngestError('CLAUDE_API_KEY is not set — add it to .env before running this stage.')
  }

  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const force = flagBoolean(args, 'force') ?? false

  await runBatch(entries, async (selected) => {
    const notes = await readNotes(selected.slug)
    const entry = await reconcileEntryArtifacts(selected.slug, notes)
    if (!entry.stages.analyzedAt) {
      log.detail(`${entry.slug}: not analyzed yet — run \`pnpm ingest analyze ${entry.slug}\``)
      return
    }
    if (!entry.stages.assessedAt) {
      throw new IngestError(
        `${entry.slug}: repository not assessed yet — run \`pnpm ingest assess ${entry.slug}\``,
      )
    }
    const generation = planProseGeneration(entry.stages, force)
    if (!generation.writeup && !generation.caseStudy) {
      log.detail(`${entry.slug}: write-up and case study already exist (--force to regenerate)`)
      return
    }

    const context = await readJson<EntryContext>(contextPath(entry.slug))
    if (!context) {
      log.warn(`${entry.slug}: context.json is missing — re-run analyze`)
      throw new IngestError(`${entry.slug}: context.json is missing — re-run analyze`)
    }

    log.step(`Writing up ${entry.slug}`)

    // Re-read the notes rather than trusting the copy in context.json, so
    // editing them takes effect without re-running analyze.
    if (notes) {
      log.detail(`using notes from ${rel(notesPath(entry.slug))}`)
    }

    // Use the manifest title, which the user may have corrected since analyze.
    const briefing = { ...context, notes, title: entry.title }
    const markdown = generation.writeup
      ? await generateWriteup(briefing)
      : (await fs.readFile(writeupPath(entry.slug), 'utf8')).trim()
    const assessment = await readJson<RepoAssessment>(repoAssessmentPath(entry.slug))
    if (!assessment) {
      throw new IngestError(`${entry.slug}: repo-assessment.json is missing — re-run assess`)
    }
    const caseStudy = preferWriteupSummary(
      await generateCaseStudy({
        assessment,
        context: briefing,
        notes,
        writeup: markdown,
      }),
      markdown,
    )

    let completed = entry
    if (generation.writeup) {
      await atomicWriteFile(writeupPath(entry.slug), `${markdown}\n`)
      completed = await recordStageCompletion(
        entry.slug,
        'writeup',
        new Date().toISOString(),
        notes,
      )
    }
    await atomicWriteJson(caseStudyPath(entry.slug), caseStudy)
    completed = await recordStageCompletion(
      entry.slug,
      'caseStudy',
      new Date().toISOString(),
      notes,
    )
    await writeSheet(completed)

    const words = markdown.split(/\s+/).length
    const tags = new Set([...markdown.matchAll(/data-tag="([^"]+)"/g)].map((match) => match[1]))
      .size
    const review = caseStudy.needsReview.length > 0 ? caseStudy.needsReview.join(',') : 'none'
    log.ok(
      `${entry.slug} → ${rel(writeupPath(entry.slug))} (${words} words, ${tags} tech tags); case-study needsReview=${review}`,
    )
  })

  log.info('')
  log.detail('Review and edit the write-ups, then run: pnpm ingest shots')
}
