import fs from 'fs/promises'
import path from 'path'

import type { ParsedArgs } from '../lib/args'
import type { ManifestEntry } from '../lib/types'

import { log } from '../lib/log'
import { loadManifest } from '../lib/manifest'
import { entryDir, MANIFEST_PATH, rel } from '../lib/paths'

const STAGES = ['analyze', 'writeup', 'shots', 'ready'] as const

/**
 * Prints a per-entry stage matrix. `ready` means the manual-entry checklist
 * exists, which is the pipeline's actual finish line — whether a project has
 * been typed into the admin panel is something only you know.
 */
export async function status(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()

  if (manifest.entries.length === 0) {
    log.warn(`No entries in ${rel(MANIFEST_PATH)}. Run: pnpm ingest discover`)
    return
  }

  const filter = args.positionals
  const entries =
    filter.length > 0
      ? manifest.entries.filter((entry) => filter.includes(entry.slug))
      : manifest.entries

  const width = Math.max(...entries.map((entry) => entry.slug.length), 4)

  log.banner(`${rel(MANIFEST_PATH)} — updated ${manifest.updatedAt}`)
  log.info(`${'slug'.padEnd(width)}  ${STAGES.map((stage) => stage.padEnd(8)).join('')}`)

  let ready = 0

  for (const entry of entries) {
    const hasSheet = await exists(path.join(entryDir(entry.slug), 'ENTER-ME.md'))
    if (hasSheet && !entry.skip) {
      ready += 1
    }

    const marks = STAGES.map((stage) => mark(entry, stage, hasSheet).padEnd(8)).join('')
    const notes: string[] = []

    if (entry.skip) {
      notes.push('skipped')
    }

    // Only surface the optional publish command's bookkeeping when it has
    // actually been used, so it stays out of the way of the manual workflow.
    const targets = Object.keys(entry.publishedTo ?? {})
    if (targets.length > 0) {
      notes.push(`published to ${targets.join(', ')}`)
    }

    const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : ''
    log.info(`${entry.slug.padEnd(width)}  ${marks}${suffix}`)
  }

  const active = entries.filter((entry) => !entry.skip).length
  log.info('')
  log.info(`${ready}/${active} active entries ready for manual entry.`)
  if (ready > 0) {
    log.detail('Open ingest/work/<slug>/ENTER-ME.md and follow it in /admin')
  }
}

function mark(entry: ManifestEntry, stage: (typeof STAGES)[number], hasSheet: boolean): string {
  const done =
    stage === 'analyze'
      ? entry.stages.analyzedAt
      : stage === 'writeup'
        ? entry.stages.writeupAt
        : stage === 'shots'
          ? entry.stages.shotsAt
          : hasSheet
  return done ? '  ok' : '   ·'
}

async function exists(target: string): Promise<boolean> {
  try {
    await fs.access(target)
    return true
  } catch {
    return false
  }
}
