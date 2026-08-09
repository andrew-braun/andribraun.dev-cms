import fs from 'node:fs/promises'
import path from 'path'

import { IngestError } from './log'

export function resolveContained(root: string, ...segments: string[]): string {
  const absoluteRoot = path.resolve(root)
  const candidate = path.resolve(absoluteRoot, ...segments)
  const relative = path.relative(absoluteRoot, candidate)
  if (relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative))) {
    return candidate
  }
  throw new IngestError(`Resolved path escapes ${absoluteRoot}: ${segments.join('/')}`)
}

export async function assertNoSymlinkComponents(root: string, target: string): Promise<void> {
  const absoluteRoot = path.resolve(root)
  const candidate = resolveContained(absoluteRoot, target)
  const relative = path.relative(absoluteRoot, candidate)
  let current = absoluteRoot
  for (const segment of relative.split(path.sep).filter(Boolean)) {
    current = path.join(current, segment)
    try {
      if ((await fs.lstat(current)).isSymbolicLink()) {
        throw new IngestError(`Refusing path with symlink component: ${current}`)
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
        return
      }
      throw error
    }
  }
}

/** Repo root, derived from this file's location (`<root>/scripts/ingest/lib`). */
export const ROOT = path.resolve(import.meta.dirname, '../../..')

export const INGEST_DIR = resolveContained(ROOT, 'ingest')
export const MANIFEST_PATH = resolveContained(INGEST_DIR, 'manifest.json')
export const WORK_DIR = resolveContained(INGEST_DIR, 'work')

/**
 * Hand-written background notes, one file per entry. These live outside
 * `work/` because they are the only input you author yourself — everything in
 * `work/` is regenerable and gitignored, and notes should be neither.
 */
export const NOTES_DIR = resolveContained(INGEST_DIR, 'notes')

/** Instructions the writeup stage feeds to Claude as its system prompt. */
export const WRITEUP_INSTRUCTIONS_PATH = resolveContained(
  ROOT,
  'ai/project.summary-instructions.md',
)

/** Instructions for the case-study sidecar JSON generated alongside the write-up. */
export const CASE_STUDY_INSTRUCTIONS_PATH = resolveContained(
  ROOT,
  'ai/project.case-study-instructions.md',
)

export function entryDir(slug: string): string {
  return resolveContained(WORK_DIR, slug)
}

export function notesPath(slug: string): string {
  return resolveContained(NOTES_DIR, `${slug}.md`)
}

export function contextPath(slug: string): string {
  return resolveContained(entryDir(slug), 'context.json')
}

export function writeupPath(slug: string): string {
  return resolveContained(entryDir(slug), 'writeup.md')
}

export function caseStudyPath(slug: string): string {
  return resolveContained(entryDir(slug), 'case-study.json')
}

export function shotsDir(slug: string): string {
  return resolveContained(entryDir(slug), 'shots')
}

export function shotsManifestPath(slug: string): string {
  return resolveContained(entryDir(slug), 'shots.json')
}

/** Turns an absolute path into a repo-relative one for readable logging. */
export function rel(target: string): string {
  return path.relative(ROOT, target)
}
