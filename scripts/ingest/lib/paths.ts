import path from 'path'

/** Repo root, derived from this file's location (`<root>/scripts/ingest/lib`). */
export const ROOT = path.resolve(import.meta.dirname, '../../..')

export const INGEST_DIR = path.join(ROOT, 'ingest')
export const MANIFEST_PATH = path.join(INGEST_DIR, 'manifest.json')
export const WORK_DIR = path.join(INGEST_DIR, 'work')

/** Instructions the writeup stage feeds to Claude as its system prompt. */
export const WRITEUP_INSTRUCTIONS_PATH = path.join(ROOT, 'ai/project.summary-instructions.md')

export function entryDir(slug: string): string {
  return path.join(WORK_DIR, slug)
}

export function contextPath(slug: string): string {
  return path.join(entryDir(slug), 'context.json')
}

export function writeupPath(slug: string): string {
  return path.join(entryDir(slug), 'writeup.md')
}

export function shotsDir(slug: string): string {
  return path.join(entryDir(slug), 'shots')
}

export function shotsManifestPath(slug: string): string {
  return path.join(entryDir(slug), 'shots.json')
}

/** Turns an absolute path into a repo-relative one for readable logging. */
export function rel(target: string): string {
  return path.relative(ROOT, target)
}
