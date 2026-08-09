import fs from 'fs/promises'

import type { Manifest, ManifestEntry } from './types'

import { atomicWriteJson } from './artifacts'
import { IngestError } from './log'
import { INGEST_DIR, MANIFEST_PATH } from './paths'
import { validateManifest } from './validation'

const EMPTY: Manifest = { entries: [], updatedAt: new Date(0).toISOString(), version: 1 }

export async function loadManifest(): Promise<Manifest> {
  try {
    const raw = await fs.readFile(MANIFEST_PATH, 'utf8')
    let document: unknown
    try {
      document = JSON.parse(raw)
    } catch (error) {
      throw new IngestError(
        `manifest.json is not valid JSON: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
    const parsed = validateManifest(document)
    for (const entry of parsed.entries) {
      entry.stages ??= {}

      // Older manifests recorded a single `payloadId` with no record of which
      // database it came from. That ID is unsafe to reuse against a different
      // instance, so drop it and let the next publish create a fresh record.
      const legacy = entry as { payloadId?: number } & ManifestEntry
      if (legacy.payloadId !== undefined) {
        delete legacy.payloadId
        delete (entry.stages as { publishedAt?: string }).publishedAt
      }
    }
    return parsed
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return { ...EMPTY, entries: [] }
    }
    throw error
  }
}

export async function saveManifest(manifest: Manifest): Promise<void> {
  manifest.updatedAt = new Date().toISOString()
  manifest.entries.sort((a, b) => a.slug.localeCompare(b.slug))
  await fs.mkdir(INGEST_DIR, { recursive: true })
  await atomicWriteJson(MANIFEST_PATH, manifest)
}

/**
 * Applies a mutation to one entry and persists the manifest. Re-reads from disk
 * first so concurrent stage runs don't clobber each other's stage timestamps.
 */
export async function updateEntry(
  slug: string,
  mutate: (entry: ManifestEntry) => void,
): Promise<void> {
  const manifest = await loadManifest()
  const entry = manifest.entries.find((candidate) => candidate.slug === slug)
  if (!entry) {
    throw new IngestError(`No manifest entry with slug "${slug}"`)
  }
  mutate(entry)
  await saveManifest(manifest)
}

/**
 * Selects the entries a stage should operate on.
 *
 * @param slugs - Explicit slugs from the command line. Empty means "all".
 *   Entries named explicitly bypass the `skip` flag.
 */
export function selectEntries(manifest: Manifest, slugs: string[]): ManifestEntry[] {
  if (slugs.length > 0) {
    return slugs.map((slug) => {
      const entry = manifest.entries.find((candidate) => candidate.slug === slug)
      if (!entry) {
        throw new IngestError(`No manifest entry with slug "${slug}"`)
      }
      return entry
    })
  }
  return manifest.entries.filter((entry) => !entry.skip)
}

/** Lowercase, hyphenated, filesystem-safe identifier derived from a name. */
export function slugify(input: string): string {
  return (
    input
      .normalize('NFKD')
      .replace(/[\u0300-\u036f]/g, '')
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 60) || 'project'
  )
}

/** Ensures a slug is unique within the manifest by appending `-2`, `-3`, ... */
export function uniqueSlug(base: string, taken: Set<string>): string {
  if (!taken.has(base)) {
    return base
  }
  let counter = 2
  while (taken.has(`${base}-${counter}`)) {
    counter += 1
  }
  return `${base}-${counter}`
}

/** Strips characters that are unsafe in a media filename. */
export function safeFilename(input: string): string {
  return input
    .replace(/[/\\?%*:|"<>]/g, '-')
    .replace(/\s+/g, ' ')
    .trim()
}

export async function readJson<T>(target: string): Promise<null | T> {
  try {
    return JSON.parse(await fs.readFile(target, 'utf8')) as T
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }
    throw error
  }
}

export async function writeJson(target: string, data: unknown): Promise<void> {
  await atomicWriteJson(target, data)
}
