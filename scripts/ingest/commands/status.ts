import type { ParsedArgs } from '../lib/args'
import type { ManifestEntry } from '../lib/types'

import { log } from '../lib/log'
import { loadManifest } from '../lib/manifest'
import { MANIFEST_PATH, rel } from '../lib/paths'
import { currentTarget } from '../lib/target'

const STAGES = ['analyze', 'writeup', 'shots', 'publish'] as const

/**
 * Prints a per-entry stage matrix. The publish column reflects the database
 * `DATABASE_URI` currently points at — a project published to dev is not
 * published to prod.
 */
export async function status(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()

  if (manifest.entries.length === 0) {
    log.warn(`No entries in ${rel(MANIFEST_PATH)}. Run: pnpm ingest discover`)
    return
  }

  let target: string
  try {
    target = currentTarget()
  } catch {
    target = '(DATABASE_URI unset)'
  }

  const filter = args.positionals
  const entries =
    filter.length > 0
      ? manifest.entries.filter((entry) => filter.includes(entry.slug))
      : manifest.entries

  const width = Math.max(...entries.map((entry) => entry.slug.length), 4)

  log.banner(`${rel(MANIFEST_PATH)} — updated ${manifest.updatedAt}`)
  log.detail(`publish column reflects: ${target}`)
  log.info(`${'slug'.padEnd(width)}  ${STAGES.map((stage) => stage.padEnd(8)).join('')}`)

  for (const entry of entries) {
    const marks = STAGES.map((stage) => mark(entry, stage, target).padEnd(8)).join('')
    const notes: string[] = []

    if (entry.skip) {
      notes.push('skipped')
    }

    // Surface publishes to other databases so a dev publish is never mistaken
    // for a production one.
    const others = Object.keys(entry.publishedTo ?? {}).filter((key) => key !== target)
    if (others.length > 0) {
      notes.push(`also in ${others.join(', ')}`)
    }

    const suffix = notes.length > 0 ? ` (${notes.join('; ')})` : ''
    log.info(`${entry.slug.padEnd(width)}  ${marks}${suffix}`)
  }

  const active = entries.filter((entry) => !entry.skip)
  const published = active.filter((entry) => entry.publishedTo?.[target]).length
  log.info('')
  log.info(`${published}/${active.length} active entries published to ${target}.`)
}

function mark(entry: ManifestEntry, stage: (typeof STAGES)[number], target: string): string {
  const done =
    stage === 'analyze'
      ? entry.stages.analyzedAt
      : stage === 'writeup'
        ? entry.stages.writeupAt
        : stage === 'shots'
          ? entry.stages.shotsAt
          : entry.publishedTo?.[target]?.at
  return done ? '  ok' : '   ·'
}
