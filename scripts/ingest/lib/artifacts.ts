import { createHash, randomUUID } from 'node:crypto'
import fs from 'node:fs/promises'
import path from 'node:path'

import type { CapturedShot, EntryContext, Manifest, ManifestEntry } from './types'

import { validateCaseStudySidecar } from './caseStudy'
import { IngestError } from './log'
import {
  assertNoSymlinkComponents,
  INGEST_DIR,
  MANIFEST_PATH,
  resolveContained,
  WORK_DIR,
} from './paths'
import { validateStoredRepoAssessment } from './repoAssessment'
import { validateCapturedShots, validateManifest } from './validation'

export async function atomicWriteFile(
  target: string,
  data: string | Uint8Array,
  hooks: { beforeRename?: () => Promise<void> | void } = {},
): Promise<void> {
  const relativeToIngest = path.relative(INGEST_DIR, path.resolve(target))
  if (!relativeToIngest.startsWith('..') && !path.isAbsolute(relativeToIngest)) {
    await assertNoSymlinkComponents(INGEST_DIR, target)
  }
  await fs.mkdir(path.dirname(target), { recursive: true })
  const temp = `${target}.${process.pid}.${randomUUID()}.tmp`
  try {
    await fs.writeFile(temp, data)
    await hooks.beforeRename?.()
    await fs.rename(temp, target)
  } finally {
    await fs.rm(temp, { force: true })
  }
}

export async function atomicWriteJson(target: string, data: unknown): Promise<void> {
  await atomicWriteFile(target, `${JSON.stringify(data, null, 2)}\n`)
}

async function pathExists(target: string): Promise<boolean> {
  return await fs
    .stat(target)
    .then(() => true)
    .catch((error: NodeJS.ErrnoException) => {
      if (error.code === 'ENOENT') {
        return false
      }
      throw error
    })
}

export async function replaceArtifactSet({
  build,
  hooks = {},
  targetDir,
  targetManifest,
  validate = validateCapturedShots,
}: {
  build: (staging: { dir: string; manifest: string }) => Promise<CapturedShot[]>
  hooks?: { beforeManifestCommit?: () => Promise<void> | void }
  targetDir: string
  targetManifest: string
  validate?: (shots: CapturedShot[], directory: string) => Promise<void>
}): Promise<void> {
  const nonce = `${process.pid}.${randomUUID()}`
  const stagingDir = `${targetDir}.${nonce}.tmp`
  const stagingManifest = `${targetManifest}.${nonce}.tmp`
  const backupDir = `${targetDir}.${nonce}.bak`
  const backupManifest = `${targetManifest}.${nonce}.bak`
  let backedUpDir = false
  let backedUpManifest = false
  let committed = false
  let swappedDir = false
  let swappedManifest = false

  await fs.mkdir(stagingDir, { recursive: true })
  try {
    const shots = await build({ dir: stagingDir, manifest: stagingManifest })
    await validate(shots, stagingDir)
    await atomicWriteJson(stagingManifest, shots)

    try {
      if (await pathExists(targetDir)) {
        await fs.rename(targetDir, backupDir)
        backedUpDir = true
      }
      if (await pathExists(targetManifest)) {
        await fs.rename(targetManifest, backupManifest)
        backedUpManifest = true
      }
      await fs.rename(stagingDir, targetDir)
      swappedDir = true
      await hooks.beforeManifestCommit?.()
      await fs.rename(stagingManifest, targetManifest)
      swappedManifest = true
      committed = true
    } catch (error) {
      if (swappedDir) {
        await fs.rm(targetDir, { force: true, recursive: true })
      }
      if (swappedManifest) {
        await fs.rm(targetManifest, { force: true })
      }
      if (backedUpDir) {
        await fs.rename(backupDir, targetDir)
      }
      if (backedUpManifest) {
        await fs.rename(backupManifest, targetManifest)
      }
      throw error
    }

    await fs.rm(backupDir, { force: true, recursive: true })
    await fs.rm(backupManifest, { force: true })
  } finally {
    await fs.rm(stagingDir, { force: true, recursive: true })
    await fs.rm(stagingManifest, { force: true })
    if (committed) {
      await fs.rm(backupDir, { force: true, recursive: true })
      await fs.rm(backupManifest, { force: true })
    }
  }
}

function canonical(value: unknown): string {
  if (value === undefined) {
    return '{"$undefined":true}'
  }
  if (value === null || typeof value !== 'object') {
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) {
    return `[${value.map(canonical).join(',')}]`
  }
  return `{${Object.entries(value as Record<string, unknown>)
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, item]) => `${JSON.stringify(key)}:${canonical(item)}`)
    .join(',')}}`
}

function digest(value: unknown): string {
  return createHash('sha256').update(canonical(value)).digest('hex')
}

export function fingerprintsFor(
  entry: ManifestEntry,
  notes: string | undefined,
): {
  analysis: string
  assessment: string
  caseStudy: string
  shots: string
  writeup: string
} {
  return {
    analysis: digest({
      githubLink: entry.githubLink,
      liveUrl: entry.liveUrl,
      repo: entry.repo,
    }),
    assessment: digest({
      analysisArtifact: entry.stages.analysisArtifact,
      contractVersion: 1,
    }),
    caseStudy: digest({
      assessmentInput: entry.stages.assessmentInput,
      contractVersion: 1,
      writeupInput: entry.stages.writeupInput,
    }),
    shots: digest({
      hero: entry.hero,
      liveUrl: entry.liveUrl,
      maxShots: entry.maxShots,
      screenshots: entry.screenshots,
      title: entry.title,
    }),
    writeup: digest({
      analysisInput: entry.stages.analysisInput,
      notes: notes ?? null,
      title: entry.title,
    }),
  }
}

export function invalidateDerivedArtifacts(
  stage: 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup',
): Array<'assessment' | 'caseStudy' | 'writeup'> {
  if (stage === 'analysis') {
    return ['assessment', 'writeup', 'caseStudy']
  }
  if (stage === 'assessment' || stage === 'writeup') {
    return ['caseStudy']
  }
  if (stage === 'shots') {
    return []
  }
  return []
}

export interface ArtifactRoots {
  manifestPath: string
  workDir: string
}

const DEFAULT_ROOTS: ArtifactRoots = { manifestPath: MANIFEST_PATH, workDir: WORK_DIR }

type GeneratedStage = 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup'

function stagePaths(slug: string, roots: ArtifactRoots): Record<GeneratedStage, string[]> {
  const dir = resolveContained(roots.workDir, slug)
  return {
    analysis: [resolveContained(dir, 'context.json'), resolveContained(dir, 'context.md')],
    assessment: [resolveContained(dir, 'repo-assessment.json')],
    caseStudy: [resolveContained(dir, 'case-study.json')],
    shots: [resolveContained(dir, 'shots'), resolveContained(dir, 'shots.json')],
    writeup: [resolveContained(dir, 'writeup.md')],
  }
}

async function hasValidArtifact(
  stage: 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup',
  paths: string[],
): Promise<boolean> {
  const required = stage === 'shots' ? paths[1] : paths[0]
  try {
    const stat = await fs.stat(required)
    if (!stat.isFile() || stat.size === 0) {
      return false
    }
    if (required.endsWith('.json')) {
      JSON.parse(await fs.readFile(required, 'utf8'))
    }
    return true
  } catch {
    return false
  }
}

async function removeStage(
  stage: GeneratedStage,
  paths: Record<GeneratedStage, string[]>,
): Promise<void> {
  await Promise.all(paths[stage].map((target) => fs.rm(target, { force: true, recursive: true })))
}

function clearStage(
  entry: ManifestEntry,
  stage: 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup',
): void {
  if (stage === 'analysis') {
    delete entry.stages.analysisArtifact
    delete entry.stages.analyzedAt
    delete entry.stages.analysisInput
  } else if (stage === 'assessment') {
    delete entry.stages.assessedAt
    delete entry.stages.assessmentInput
  } else if (stage === 'caseStudy') {
    delete entry.stages.caseStudyAt
    delete entry.stages.caseStudyInput
  } else if (stage === 'shots') {
    delete entry.stages.shotsAt
    delete entry.stages.shotsInput
  } else {
    delete entry.stages.writeupAt
    delete entry.stages.writeupInput
  }
}

async function invalidate(
  entry: ManifestEntry,
  stage: 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup',
  paths: Record<GeneratedStage, string[]>,
): Promise<void> {
  clearStage(entry, stage)
  await removeStage(stage, paths)
  for (const downstream of invalidateDerivedArtifacts(stage)) {
    clearStage(entry, downstream)
    await removeStage(downstream, paths)
  }
}

async function loadEntry(
  slug: string,
  roots: ArtifactRoots,
): Promise<{ entry: ManifestEntry; manifest: Manifest }> {
  let manifest: Manifest
  try {
    manifest = validateManifest(JSON.parse(await fs.readFile(roots.manifestPath, 'utf8')))
  } catch (error) {
    throw new IngestError(
      `Could not reconcile ${slug}: ${error instanceof Error ? error.message : String(error)}`,
    )
  }
  const entry = manifest.entries.find((candidate) => candidate.slug === slug)
  if (!entry) {
    throw new IngestError(`No manifest entry with slug "${slug}"`)
  }
  return { entry, manifest }
}

async function persistManifest(manifest: Manifest, target: string): Promise<void> {
  manifest.updatedAt = new Date().toISOString()
  manifest.entries.sort((left, right) => left.slug.localeCompare(right.slug))
  await atomicWriteJson(target, manifest)
}

export async function reconcileEntryArtifacts(
  slug: string,
  notes: string | undefined,
  roots: ArtifactRoots = DEFAULT_ROOTS,
): Promise<ManifestEntry> {
  const { entry, manifest } = await loadEntry(slug, roots)

  const paths = stagePaths(slug, roots)
  const current = fingerprintsFor(entry, notes)
  const stages = [
    ['analysis', 'analyzedAt', 'analysisInput'],
    ['assessment', 'assessedAt', 'assessmentInput'],
    ['shots', 'shotsAt', 'shotsInput'],
    ['writeup', 'writeupAt', 'writeupInput'],
    ['caseStudy', 'caseStudyAt', 'caseStudyInput'],
  ] as const

  if (entry.stages.analyzedAt && !entry.stages.analysisArtifact) {
    const rawContext = JSON.parse(await fs.readFile(paths.analysis[0], 'utf8')) as Record<
      string,
      unknown
    >
    const { gatheredAt: _gatheredAt, ...stableContext } = rawContext
    entry.stages.analysisArtifact = digest(stableContext)
  }

  for (const [stage, timestampKey, fingerprintKey] of stages) {
    const timestamp = entry.stages[timestampKey]
    const stored = entry.stages[fingerprintKey]
    if (!timestamp) {
      if (stored) {
        delete entry.stages[fingerprintKey]
      }
      continue
    }
    let valid = await hasValidArtifact(stage, paths[stage])
    if (valid && stage === 'assessment') {
      try {
        const context = JSON.parse(await fs.readFile(paths.analysis[0], 'utf8')) as EntryContext
        const assessment = JSON.parse(await fs.readFile(paths.assessment[0], 'utf8')) as unknown
        validateStoredRepoAssessment(assessment, context, entry.stages.analysisArtifact ?? '')
      } catch {
        valid = false
      }
    }
    if (valid && stage === 'caseStudy') {
      try {
        validateCaseStudySidecar(
          JSON.parse(await fs.readFile(paths.caseStudy[0], 'utf8')) as unknown,
        )
      } catch {
        valid = false
      }
    }
    if (!valid) {
      await invalidate(entry, stage, paths)
      continue
    }
    if (!stored) {
      entry.stages[fingerprintKey] = current[stage]
      continue
    }
    if (stored !== current[stage]) {
      await invalidate(entry, stage, paths)
    }
  }

  await persistManifest(manifest, roots.manifestPath)
  return entry
}

export async function recordStageCompletion(
  slug: string,
  stage: 'analysis' | 'assessment' | 'caseStudy' | 'shots' | 'writeup',
  completedAt: string,
  notes: string | undefined,
  roots: ArtifactRoots = DEFAULT_ROOTS,
): Promise<ManifestEntry> {
  const { entry, manifest } = await loadEntry(slug, roots)
  const paths = stagePaths(slug, roots)

  for (const downstream of invalidateDerivedArtifacts(stage)) {
    clearStage(entry, downstream)
    await removeStage(downstream, paths)
  }

  const current = fingerprintsFor(entry, notes)
  if (stage === 'analysis') {
    const rawContext = JSON.parse(await fs.readFile(paths.analysis[0], 'utf8')) as Record<
      string,
      unknown
    >
    const { gatheredAt: _gatheredAt, ...stableContext } = rawContext
    entry.stages.analysisArtifact = digest(stableContext)
    entry.stages.analyzedAt = completedAt
    entry.stages.analysisInput = current.analysis
  } else if (stage === 'assessment') {
    entry.stages.assessedAt = completedAt
    entry.stages.assessmentInput = fingerprintsFor(entry, notes).assessment
  } else if (stage === 'caseStudy') {
    entry.stages.caseStudyAt = completedAt
    entry.stages.caseStudyInput = fingerprintsFor(entry, notes).caseStudy
  } else if (stage === 'shots') {
    entry.stages.shotsAt = completedAt
    entry.stages.shotsInput = current.shots
  } else {
    entry.stages.writeupAt = completedAt
    entry.stages.writeupInput = current.writeup
  }

  await persistManifest(manifest, roots.manifestPath)
  return entry
}
