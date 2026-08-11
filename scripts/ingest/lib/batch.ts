import { IngestError, log } from './log'

export async function runBatch<T extends { slug: string }>(
  entries: T[],
  worker: (entry: T) => Promise<void>,
): Promise<void> {
  const failures: Array<{ message: string; slug: string }> = []
  for (const entry of entries) {
    try {
      await worker(entry)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      failures.push({ slug: entry.slug, message })
      log.error(`${entry.slug}: ${message}`)
      if (
        error &&
        typeof error === 'object' &&
        'fatal' in error &&
        (error as { fatal?: unknown }).fatal === true
      ) {
        throw error instanceof Error ? error : new IngestError(message)
      }
    }
  }
  if (failures.length > 0) {
    throw new IngestError(
      `${failures.length} of ${entries.length} entries failed: ${failures.map(({ slug }) => slug).join(', ')}`,
    )
  }
}
