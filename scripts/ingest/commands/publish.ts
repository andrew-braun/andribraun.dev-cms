import fs from 'fs/promises'

import type { PublishBackend } from '../lib/backend'
import type { CaseStudySidecar } from '../lib/caseStudy'
import type { ProjectResolution } from '../lib/projectResolution'
import type { CapturedShot, ManifestEntry } from '../lib/types'

import { flagBoolean, type ParsedArgs } from '../lib/args'
import { reconcileEntryArtifacts } from '../lib/artifacts'
import { localBackend, remoteBackend } from '../lib/backend'
import { runBatch } from '../lib/batch'
import { validateCaseStudySidecar } from '../lib/caseStudy'
import { IngestError, log } from '../lib/log'
import { loadManifest, readJson, selectEntries, updateEntry } from '../lib/manifest'
import { readNotes } from '../lib/notes'
import {
  caseStudyPath,
  resolveContained,
  shotsDir,
  shotsManifestPath,
  writeupPath,
} from '../lib/paths'
import { buildProjectCreateData, buildProjectUpdateData } from '../lib/projectData'
import { resolveProject } from '../lib/projectResolution'
import { validateCapturedShots } from '../lib/validation'
import { splitWriteup, WRITEUP_SECTION_KEYS } from '../lib/writeupSections'

interface LoadedShot extends CapturedShot {
  data: Buffer
}

interface PublishEntryDependencies {
  loadAndValidateArtifacts(entry: ManifestEntry): Promise<{
    caseStudy: CaseStudySidecar | null
    markdown: string
    shots: LoadedShot[]
  }>
  recordPublished(
    entry: ManifestEntry,
    backend: PublishBackend,
    id: number,
    at: string,
  ): Promise<unknown>
  resolve(backend: PublishBackend, slug: string, hintedId?: number): Promise<ProjectResolution>
}

const defaultPublishDependencies: PublishEntryDependencies = {
  async loadAndValidateArtifacts(entry) {
    const markdown = (await fs.readFile(writeupPath(entry.slug), 'utf8')).trim()
    const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
    const caseStudyRaw = await readJson<unknown>(caseStudyPath(entry.slug))
    if (!caseStudyRaw) {
      throw new IngestError(`${entry.slug}: case-study.json is missing — re-run writeup`)
    }
    const caseStudy = validateCaseStudySidecar(caseStudyRaw)
    if (shots.length > 0) {
      await validateCapturedShots(shots, shotsDir(entry.slug))
    }
    const loaded: LoadedShot[] = await Promise.all(
      shots.map(async (shot) => ({
        ...shot,
        data: await fs.readFile(resolveContained(shotsDir(entry.slug), shot.file)),
      })),
    )
    return { caseStudy, markdown, shots: loaded }
  },
  async recordPublished(entry, backend, id, at) {
    await updateEntry(entry.slug, (record) => {
      record.publishedTo ??= {}
      record.publishedTo[backend.target] = { id, at }
    })
  },
  resolve: resolveProject,
}

export function publicationReadinessIssue(
  entry: ManifestEntry,
): 'case study' | 'repository assessment' | 'write-up' | undefined {
  if (!entry.stages.assessedAt) {
    return 'repository assessment'
  }
  if (!entry.stages.writeupAt) {
    return 'write-up'
  }
  if (!entry.stages.caseStudyAt) {
    return 'case study'
  }
  return undefined
}

export async function publishEntry(
  entry: ManifestEntry,
  options: { backend: PublishBackend; now?: () => Date; skipTech?: boolean; visibility?: boolean },
  dependencies: PublishEntryDependencies = defaultPublishDependencies,
): Promise<number> {
  const { backend } = options
  const { caseStudy, markdown, shots } = await dependencies.loadAndValidateArtifacts(entry)
  if (!caseStudy) {
    log.warn(`${entry.slug}: case-study.json missing — publishing without case-study fields`)
  }
  const split = splitWriteup(markdown)
  const missing = WRITEUP_SECTION_KEYS.filter((key) => !split.sections[key])
  if (missing.length > 0) {
    log.warn(
      `${entry.slug}: no ${missing.join(', ')} — description_markdown still holds the full write-up`,
    )
  }
  for (const heading of split.unmatched) {
    log.detail(`section "${heading}" maps to no field — it stays in description_markdown only`)
  }
  const resolution = await dependencies.resolve(
    backend,
    entry.slug,
    entry.publishedTo?.[backend.target]?.id,
  )

  const mediaIds: number[] = []
  let heroMediaId: number | undefined
  for (const shot of shots) {
    const mediaId = await backend.uploadMedia(shot.alt, {
      name: shot.file,
      data: shot.data,
      mimetype: 'image/png',
    })
    mediaIds.push(mediaId)
    if (shot.hero) {
      heroMediaId = mediaId
    }
    log.detail(`uploaded ${shot.file} (media #${mediaId})${shot.hero ? ' — hero' : ''}`)
  }

  const input = {
    caseStudy,
    entry,
    markdown,
    media:
      mediaIds.length > 0
        ? { heroId: heroMediaId, ids: mediaIds }
        : entry.screenshots === null
          ? null
          : undefined,
    visibility: options.visibility,
  }
  const projectId =
    resolution.action === 'update'
      ? await backend.updateProject(resolution.id, buildProjectUpdateData(input))
      : await backend.createProject(buildProjectCreateData(input))
  log.ok(`${resolution.action === 'update' ? 'updated' : 'created'} project #${projectId}`)

  await dependencies.recordPublished(
    entry,
    backend,
    projectId,
    (options.now ?? (() => new Date()))().toISOString(),
  )

  if (!options.skipTech) {
    try {
      const result = await backend.extractTechnologies(projectId)
      if (result.success) {
        log.ok(
          `technologies: ${result.linked} linked${result.created.length > 0 ? `, ${result.created.length} new (${result.created.join(', ')})` : ''}`,
        )
      } else {
        log.warn(`technology extraction failed: ${result.message}`)
      }
      for (const issue of result.errors ?? []) {
        log.warn(issue)
      }
    } catch (error) {
      log.warn(
        `technology extraction failed: ${error instanceof Error ? error.message : String(error)}`,
      )
    }
  }
  return projectId
}

/**
 * Writes reviewed entries into the CMS: uploads screenshots to the media
 * collection, creates or updates the project, then runs the existing technology
 * extraction service to populate the tech relationships.
 *
 * `--remote` sends everything over the REST API to the instance
 * `PAYLOAD_REMOTE_URL` names, which is how production is reached; without it,
 * the Local API writes to whatever `DATABASE_URI` points at.
 *
 * Projects are created with `display.hide` set unless `--visible` is passed, so
 * a publish never surfaces unreviewed content on the live portfolio.
 */
export async function publish(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const dryRun = flagBoolean(args, 'dry-run') ?? false
  const remote = flagBoolean(args, 'remote') ?? false
  const visibility = flagBoolean(args, 'visible')
  const skipTech = flagBoolean(args, 'no-tech') ?? false

  const ready: ManifestEntry[] = []
  for (const selected of entries) {
    const entry = await reconcileEntryArtifacts(selected.slug, await readNotes(selected.slug))
    const issue = publicationReadinessIssue(entry)
    if (issue) {
      log.detail(`${entry.slug}: no current ${issue} — skipping`)
      continue
    }
    if (!(await readJson<CaseStudySidecar>(caseStudyPath(entry.slug)))) {
      log.detail(`${entry.slug}: no valid case study yet — skipping`)
      continue
    }
    ready.push(entry)
  }

  if (ready.length === 0) {
    log.warn('Nothing ready to publish. Run the writeup stage first.')
    return
  }

  if (dryRun) {
    const lookup = remote ? remoteBackend() : await localBackend()
    const target = lookup.target

    log.banner(`Publish target: ${target}`)
    log.info('Dry run — no database or storage writes')

    try {
      for (const entry of ready) {
        const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
        if (shots.length > 0) {
          await validateCapturedShots(shots, shotsDir(entry.slug))
        }
        const markdown = await fs.readFile(writeupPath(entry.slug), 'utf8')
        const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
        const resolution = await resolveProject(lookup, entry.slug, entry.publishedTo?.[target]?.id)

        const action = resolution.action === 'create' ? 'create' : `update #${resolution.id}`
        const found = Object.keys(splitWriteup(markdown).sections).length

        // Say which way an empty capture falls, so "0 images" is never read as
        // "the images on the target are about to go".
        const media =
          shots.length > 0
            ? `${shots.length} images`
            : resolution.action === 'create'
              ? 'no images'
              : 'media left as-is'

        log.ok(
          `${entry.slug}: ${action}, ${markdown.length} chars, ${media}, ${found}/${WRITEUP_SECTION_KEYS.length} sections, case-study=${caseStudy ? 'yes' : 'missing'}`,
        )
      }
      log.detail('"create" means no project on the target shares that slug.')
    } finally {
      await lookup.close()
    }
    return
  }

  const backend: PublishBackend = remote ? remoteBackend() : await localBackend()
  log.banner(`Publish target: ${backend.description}`)

  try {
    await runBatch(ready, async (entry) => {
      log.step(`Publishing ${entry.slug}`)
      await publishEntry(entry, { backend, skipTech, visibility })
    })
  } finally {
    await backend.close()
  }

  log.info('')
  if (visibility === true) {
    log.detail('Projects are visible. Check them at /admin/collections/projects')
  } else if (visibility === false) {
    log.detail('Projects were created hidden — untick "hide" in the admin to publish them.')
  } else {
    log.detail('New projects were created hidden; existing project visibility was preserved.')
  }
}
