import type { ParsedArgs } from '../lib/args'

import { log } from '../lib/log'
import { loadManifest, selectEntries } from '../lib/manifest'
import { rel } from '../lib/paths'
import { writeSheet } from '../lib/sheet'

/**
 * Regenerates the manual-entry checklists. `writeup` and `shots` already do this
 * automatically; run it directly after hand-editing the manifest so the field
 * values on the sheet match.
 */
export async function sheet(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)

  let written = 0
  for (const entry of entries) {
    const target = await writeSheet(entry)
    if (target) {
      log.ok(`${entry.slug} → ${rel(target)}`)
      written += 1
    } else {
      log.detail(`${entry.slug}: nothing generated yet — run writeup and shots first`)
    }
  }

  if (written === 0) {
    log.warn('No sheets written.')
    return
  }

  log.info('')
  log.detail(`${written} ready for manual entry at /admin/collections/projects/create`)
}
