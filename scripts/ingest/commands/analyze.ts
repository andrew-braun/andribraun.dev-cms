import fs from 'fs/promises'
import path from 'path'

import type { EntryContext } from '../lib/types'

import { renderContext } from '../lib/ai'
import { hasFlag, type ParsedArgs } from '../lib/args'
import { assertGhReady, gatherRepoContext } from '../lib/github'
import { log } from '../lib/log'
import { loadManifest, selectEntries, updateEntry, writeJson } from '../lib/manifest'
import { contextPath, entryDir, rel } from '../lib/paths'
import { probeSite } from '../lib/site'

/**
 * Builds the evidence bundle for each entry: repo metadata, tree, key files, and
 * a probe of the deployed site. Writes `context.json` (machine-readable) and
 * `context.md` (the exact briefing the write-up stage sends to Claude).
 */
export async function analyze(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const force = hasFlag(args, 'force')

  if (entries.length === 0) {
    log.warn('No active entries. Run `pnpm ingest discover` or unskip entries in the manifest.')
    return
  }

  let needsGh = false
  for (const entry of entries) {
    if (entry.repo && (force || !entry.stages.analyzedAt)) {
      needsGh = true
    }
  }
  if (needsGh) {
    await assertGhReady()
  }

  for (const entry of entries) {
    if (!force && entry.stages.analyzedAt) {
      log.detail(`${entry.slug}: already analyzed (--force to redo)`)
      continue
    }

    log.step(`Analyzing ${entry.slug}`)

    if (!entry.repo && !entry.liveUrl) {
      log.warn(`${entry.slug}: no repo and no liveUrl — nothing to analyze. Skipping.`)
      continue
    }

    const context: EntryContext = {
      slug: entry.slug,
      gatheredAt: new Date().toISOString(),
      title: entry.title,
    }

    if (entry.repo) {
      try {
        context.repo = await gatherRepoContext(entry.repo)
        const fileCount = Object.keys(context.repo.files).length
        log.info(
          `repo ${context.repo.repo}: ${context.repo.tree.length} paths, ${fileCount} files read`,
        )
      } catch (error) {
        log.error(`${entry.slug}: ${error instanceof Error ? error.message : String(error)}`)
        continue
      }
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
    await fs.writeFile(briefingPath, renderContext(context), 'utf8')

    await updateEntry(entry.slug, (target) => {
      target.stages.analyzedAt = context.gatheredAt
    })

    log.ok(`${entry.slug} → ${rel(briefingPath)}`)
  }

  log.info('')
  log.detail('Next: pnpm ingest writeup')
}
