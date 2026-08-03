import type { ParsedArgs } from '../lib/args'

import { log } from '../lib/log'
import { loadManifest, selectEntries } from '../lib/manifest'
import { readNotes, scaffoldNotes } from '../lib/notes'
import { notesPath, rel } from '../lib/paths'

/**
 * Creates starter notes files for the selected entries. Existing files are left
 * alone — this only ever adds. Most useful for sites with no repo, where the
 * probe alone gives the write-up stage very little to work with.
 */
export async function notes(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)

  if (entries.length === 0) {
    log.warn('No active entries. Name slugs explicitly, or unskip entries in the manifest.')
    return
  }

  let created = 0
  let written = 0

  for (const entry of entries) {
    const path = await scaffoldNotes(entry)

    if (path) {
      created += 1
      log.ok(`${entry.slug} → ${rel(path)}`)
      continue
    }

    const existing = await readNotes(entry.slug)
    if (existing) {
      written += 1
      log.detail(`${entry.slug}: ${rel(notesPath(entry.slug))} (${existing.length} chars)`)
    } else {
      log.detail(`${entry.slug}: ${rel(notesPath(entry.slug))} (still just the template)`)
    }
  }

  log.info('')
  log.info(`${created} created, ${written} already filled in.`)
  log.detail('Fill them in, then run: pnpm ingest writeup --force <slug>')
}
