import fs from 'fs/promises'
import path from 'path'

import type { EntryContext } from '../lib/types'

import { renderContext } from '../lib/ai'
import { flagBoolean, type ParsedArgs } from '../lib/args'
import { atomicWriteFile, reconcileEntryArtifacts, recordStageCompletion } from '../lib/artifacts'
import { runBatch } from '../lib/batch'
import { assertGhReady, gatherRepoContext } from '../lib/github'
import { log } from '../lib/log'
import { loadManifest, selectEntries, writeJson } from '../lib/manifest'
import { readNotes } from '../lib/notes'
import { contextPath, entryDir, notesPath, rel } from '../lib/paths'
import { probeSite } from '../lib/site'

/**
 * Builds the evidence bundle for each entry: repo metadata, tree, key files, and
 * a probe of the deployed site. Writes `context.json` (machine-readable) and
 * `context.md` (the exact briefing the write-up stage sends to Claude).
 */
export async function analyze(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const selected = selectEntries(manifest, args.positionals)
  const force = flagBoolean(args, 'force') ?? false

  if (selected.length === 0) {
    log.warn('No active entries. Run `pnpm ingest discover` or unskip entries in the manifest.')
    return
  }

  let needsGh = false
  for (const entry of selected) {
    if (entry.repo && (force || !entry.stages.analyzedAt)) {
      needsGh = true
    }
  }
  if (needsGh) {
    await assertGhReady()
  }

  await runBatch(selected, async (selectedEntry) => {
    const notes = await readNotes(selectedEntry.slug)
    const entry = await reconcileEntryArtifacts(selectedEntry.slug, notes)
    if (!force && entry.stages.analyzedAt) {
      log.detail(`${entry.slug}: already analyzed (--force to redo)`)
      return
    }

    log.step(`Analyzing ${entry.slug}`)

    if (!entry.repo && !entry.liveUrl && !notes) {
      log.warn(`${entry.slug}: no repo, liveUrl, or notes — nothing to analyze. Skipping.`)
      return
    }

    const context: EntryContext = {
      slug: entry.slug,
      gatheredAt: new Date().toISOString(),
      notes,
      title: entry.title,
    }

    if (notes) {
      log.info(`notes ${rel(notesPath(entry.slug))}: ${notes.length} chars`)
    }

    if (entry.repo) {
      context.repo = await gatherRepoContext(entry.repo)
      const fileCount = Object.keys(context.repo.files).length
      log.info(
        `repo ${context.repo.repo}: ${context.repo.tree.length} paths, ${fileCount} files read`,
      )
    }

    if (entry.liveUrl) {
      const site = await probeSite(entry.liveUrl)
      context.site = site
      if (site.ok) {
        log.info(
          `site ${site.url}: ${site.navLinks.length} nav links, signals: ${site.signals.join(', ') || 'none'}`,
        )
      } else {
        log.warn(`site ${entry.liveUrl} unreachable (${site.reason}) — screenshots will fail`)
      }
    }

    await fs.mkdir(entryDir(entry.slug), { recursive: true })
    await writeJson(contextPath(entry.slug), context)

    const briefingPath = path.join(entryDir(entry.slug), 'context.md')
    await atomicWriteFile(briefingPath, renderContext(context))

    await recordStageCompletion(entry.slug, 'analysis', context.gatheredAt, notes)

    log.ok(`${entry.slug} → ${rel(briefingPath)}`)
  })

  log.info('')
  log.detail('Next: pnpm ingest writeup')
}
