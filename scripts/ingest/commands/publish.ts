import fs from 'fs/promises'
import path from 'path'

import type { PublishBackend } from '../lib/backend'
import type { CaseStudySidecar } from '../lib/caseStudy'
import type { CapturedShot } from '../lib/types'

import { hasFlag, type ParsedArgs } from '../lib/args'
import { localBackend, remoteBackend, resolveTarget } from '../lib/backend'
import { log } from '../lib/log'
import { loadManifest, readJson, selectEntries, updateEntry } from '../lib/manifest'
import { caseStudyPath, shotsDir, shotsManifestPath, writeupPath } from '../lib/paths'
import { buildProjectData } from '../lib/projectData'
import { splitWriteup, WRITEUP_SECTION_KEYS } from '../lib/writeupSections'

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
  const dryRun = hasFlag(args, 'dry-run')
  const remote = hasFlag(args, 'remote')
  const visible = hasFlag(args, 'visible')
  const skipTech = hasFlag(args, 'no-tech')

  const ready = entries.filter((entry) => {
    if (!entry.stages.writeupAt) {
      log.detail(`${entry.slug}: no write-up yet — skipping`)
      return false
    }
    return true
  })

  if (ready.length === 0) {
    log.warn('Nothing ready to publish. Run the writeup stage first.')
    return
  }

  if (dryRun) {
    // A remote dry run can afford to tell the truth: resolving a slug is a
    // plain GET, so it reports the real create-vs-update outcome instead of
    // inferring it from the manifest. The local backend is deliberately left
    // unopened — a dry run should not connect to a database at all.
    const lookup = remote ? remoteBackend() : null
    const target = lookup?.target ?? resolveTarget(remote)

    log.banner(`Publish target: ${target}`)
    log.info('Dry run — no database or storage writes')

    for (const entry of ready) {
      const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
      const markdown = await fs.readFile(writeupPath(entry.slug), 'utf8')
      const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))

      let existingId = entry.publishedTo?.[target]?.id ?? null
      if (existingId === null && lookup) {
        existingId = await lookup.findProjectBySlug(entry.slug)
      }

      const action = existingId === null ? 'create' : `update #${existingId}`
      const found = Object.keys(splitWriteup(markdown).sections).length

      // Say which way an empty capture falls, so "0 images" is never read as
      // "the images on the target are about to go".
      const media =
        shots.length > 0
          ? `${shots.length} images`
          : existingId === null
            ? 'no images'
            : 'media left as-is'

      log.ok(
        `${entry.slug}: ${action}, ${markdown.length} chars, ${media}, ${found}/${WRITEUP_SECTION_KEYS.length} sections, case-study=${caseStudy ? 'yes' : 'missing'}`,
      )
    }

    if (lookup) {
      log.detail('"create" means no project on the target shares that slug.')
    }
    return
  }

  const backend: PublishBackend = remote ? remoteBackend() : await localBackend()
  log.banner(`Publish target: ${backend.description}`)

  for (const entry of ready) {
    log.step(`Publishing ${entry.slug}`)

    try {
      const markdown = (await fs.readFile(writeupPath(entry.slug), 'utf8')).trim()
      const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
      const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
      if (!caseStudy) {
        log.warn(`${entry.slug}: case-study.json missing — publishing without case-study fields`)
      }

      // Section fields are a convenience for layout; a write-up that does not
      // follow the house structure still publishes on description_markdown.
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

      // Resolve the destination row before uploading anything, so a project
      // entered by hand is updated rather than colliding on the unique slug.
      let existingId = entry.publishedTo?.[backend.target]?.id ?? null
      if (existingId === null) {
        existingId = await backend.findProjectBySlug(entry.slug)
        if (existingId !== null) {
          log.detail(
            `found existing project #${existingId} with slug "${entry.slug}" — updating it`,
          )
        }
      }

      const mediaIds: number[] = []
      let heroMediaId: number | undefined
      for (const shot of shots) {
        const filePath = path.join(shotsDir(entry.slug), shot.file)
        const data = await fs.readFile(filePath)

        const mediaId = await backend.uploadMedia(shot.alt, {
          name: shot.file,
          data,
          mimetype: 'image/png',
        })
        mediaIds.push(mediaId)
        if (shot.hero) {
          heroMediaId = mediaId
        }
        log.detail(`uploaded ${shot.file} (media #${mediaId})${shot.hero ? ' — hero' : ''}`)
      }

      const data = buildProjectData(entry, markdown, mediaIds, visible, caseStudy, heroMediaId)

      let projectId: number
      if (existingId !== null) {
        projectId = await backend.updateProject(existingId, data)
        log.ok(`updated project #${projectId}`)
      } else {
        projectId = await backend.createProject(data)
        log.ok(`created project #${projectId}`)
      }

      await updateEntry(entry.slug, (record) => {
        record.publishedTo ??= {}
        record.publishedTo[backend.target] = { id: projectId, at: new Date().toISOString() }
      })

      if (!skipTech) {
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
      }
    } catch (error) {
      log.error(`${entry.slug}: ${error instanceof Error ? error.message : String(error)}`)
      process.exitCode = 1
    }
  }

  log.info('')
  if (visible) {
    log.detail('Projects are visible. Check them at /admin/collections/projects')
  } else {
    log.detail('Projects were created hidden — untick "hide" in the admin to publish them.')
  }

  // The Payload/Postgres pool keeps the event loop alive otherwise.
  process.exit(process.exitCode ?? 0)
}
