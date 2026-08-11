import type { EntryContext } from '../lib/types'

import { generateRepoAssessment } from '../lib/ai'
import { flagBoolean, type ParsedArgs } from '../lib/args'
import { atomicWriteJson, reconcileEntryArtifacts, recordStageCompletion } from '../lib/artifacts'
import { runBatch } from '../lib/batch'
import { IngestError, log } from '../lib/log'
import { loadManifest, readJson, selectEntries } from '../lib/manifest'
import { readNotes } from '../lib/notes'
import { contextPath, rel, repoAssessmentPath } from '../lib/paths'
import { unavailableRepoAssessment } from '../lib/repoAssessment'

export async function assess(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const force = flagBoolean(args, 'force') ?? false

  await runBatch(entries, async (selected) => {
    const notes = await readNotes(selected.slug)
    const entry = await reconcileEntryArtifacts(selected.slug, notes)
    if (!entry.stages.analyzedAt || !entry.stages.analysisArtifact) {
      throw new IngestError(
        `${entry.slug}: not analyzed yet — run \`pnpm ingest analyze ${entry.slug}\``,
      )
    }
    if (!force && entry.stages.assessedAt) {
      log.detail(`${entry.slug}: repository assessment already exists (--force to regenerate)`)
      return
    }
    const context = await readJson<EntryContext>(contextPath(entry.slug))
    if (!context) {
      throw new IngestError(`${entry.slug}: context.json is missing — re-run analyze`)
    }

    log.step(`Assessing ${entry.slug}`)
    const generatedAt = new Date().toISOString()
    const assessment = context.repo
      ? await generateRepoAssessment(context, entry.stages.analysisArtifact)
      : unavailableRepoAssessment(
          {
            slug: entry.slug,
            analysisFingerprint: entry.stages.analysisArtifact,
            generatedAt,
          },
          'No repository is configured for this project.',
        )

    await atomicWriteJson(repoAssessmentPath(entry.slug), assessment)
    await recordStageCompletion(entry.slug, 'assessment', assessment.generatedAt, notes)
    log.ok(`${entry.slug} → ${rel(repoAssessmentPath(entry.slug))} (${assessment.status})`)
  })

  log.info('')
  log.detail('Next: pnpm ingest writeup')
}
