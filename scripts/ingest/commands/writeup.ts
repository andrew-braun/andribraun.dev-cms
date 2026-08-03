import fs from 'fs/promises'

import type { EntryContext } from '../lib/types'

import { generateWriteup } from '../lib/ai'
import { hasFlag, type ParsedArgs } from '../lib/args'
import { log } from '../lib/log'
import { loadManifest, readJson, selectEntries, updateEntry } from '../lib/manifest'
import { contextPath, rel, writeupPath } from '../lib/paths'

/**
 * Turns each analyzed context bundle into a `description_markdown` body using
 * `ai/project.summary-instructions.md` as the system prompt. Output lands in
 * `ingest/work/<slug>/writeup.md` for review — nothing reaches the CMS here.
 */
export async function writeup(args: ParsedArgs): Promise<void> {
  if (!process.env.CLAUDE_API_KEY) {
    log.error('CLAUDE_API_KEY is not set — add it to .env before running this stage.')
    process.exitCode = 1
    return
  }

  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const force = hasFlag(args, 'force')

  for (const entry of entries) {
    if (!entry.stages.analyzedAt) {
      log.detail(`${entry.slug}: not analyzed yet — run \`pnpm ingest analyze ${entry.slug}\``)
      continue
    }
    if (!force && entry.stages.writeupAt) {
      log.detail(`${entry.slug}: write-up already exists (--force to regenerate)`)
      continue
    }

    const context = await readJson<EntryContext>(contextPath(entry.slug))
    if (!context) {
      log.warn(`${entry.slug}: context.json is missing — re-run analyze`)
      continue
    }

    log.step(`Writing up ${entry.slug}`)

    try {
      // Use the manifest title, which the user may have corrected since analyze.
      const markdown = await generateWriteup({ ...context, title: entry.title })
      await fs.writeFile(writeupPath(entry.slug), `${markdown}\n`, 'utf8')

      await updateEntry(entry.slug, (target) => {
        target.stages.writeupAt = new Date().toISOString()
      })

      const words = markdown.split(/\s+/).length
      const tags = new Set([...markdown.matchAll(/data-tag="([^"]+)"/g)].map((match) => match[1]))
        .size
      log.ok(`${entry.slug} → ${rel(writeupPath(entry.slug))} (${words} words, ${tags} tech tags)`)
    } catch (error) {
      log.error(`${entry.slug}: ${error instanceof Error ? error.message : String(error)}`)
    }
  }

  log.info('')
  log.detail('Review and edit the write-ups, then run: pnpm ingest shots')
}
