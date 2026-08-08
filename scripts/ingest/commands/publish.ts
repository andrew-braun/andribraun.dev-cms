import { extractTechnologiesFromProject } from '@/services/technologyExtraction'
import configPromise from '@payload-config'
import fs from 'fs/promises'
import path from 'path'
import { getPayload } from 'payload'

import type { CaseStudySidecar } from '../lib/caseStudy'
import type { CapturedShot } from '../lib/types'

import { hasFlag, type ParsedArgs } from '../lib/args'
import { log } from '../lib/log'
import { loadManifest, readJson, selectEntries, updateEntry } from '../lib/manifest'
import { caseStudyPath, shotsDir, shotsManifestPath, writeupPath } from '../lib/paths'
import { buildProjectData } from '../lib/projectData'
import { currentTarget } from '../lib/target'

/**
 * Writes reviewed entries into the CMS: uploads screenshots to the media
 * collection, creates or updates the project, then runs the existing technology
 * extraction service to populate the tech relationships.
 *
 * Projects are created with `display.hide` set unless `--visible` is passed, so
 * a publish never surfaces unreviewed content on the live portfolio.
 */
export async function publish(args: ParsedArgs): Promise<void> {
  const manifest = await loadManifest()
  const entries = selectEntries(manifest, args.positionals)
  const dryRun = hasFlag(args, 'dry-run')
  const visible = hasFlag(args, 'visible')
  const skipTech = hasFlag(args, 'no-tech')

  const target = currentTarget()

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

  log.banner(`Publish target: ${target}`)

  if (dryRun) {
    log.info('Dry run — no database or storage writes')
    for (const entry of ready) {
      const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
      const markdown = await fs.readFile(writeupPath(entry.slug), 'utf8')
      const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
      const existing = entry.publishedTo?.[target]
      const action = existing ? `update #${existing.id}` : 'create'
      log.ok(
        `${entry.slug}: ${action}, ${markdown.length} chars, ${shots.length} images, case-study=${caseStudy ? 'yes' : 'missing'}`,
      )
    }
    return
  }

  const payload = await getPayload({ config: configPromise })

  for (const entry of ready) {
    log.step(`Publishing ${entry.slug}`)

    try {
      const markdown = (await fs.readFile(writeupPath(entry.slug), 'utf8')).trim()
      const shots = (await readJson<CapturedShot[]>(shotsManifestPath(entry.slug))) ?? []
      const caseStudy = await readJson<CaseStudySidecar>(caseStudyPath(entry.slug))
      if (!caseStudy) {
        log.warn(`${entry.slug}: case-study.json missing — publishing without case-study fields`)
      }

      const mediaIds: number[] = []
      for (const shot of shots) {
        const filePath = path.join(shotsDir(entry.slug), shot.file)
        const data = await fs.readFile(filePath)

        const media = await payload.create({
          collection: 'media',
          data: { alt: shot.alt },
          file: {
            name: shot.file,
            data,
            mimetype: 'image/png',
            size: data.byteLength,
          },
        })
        mediaIds.push(media.id)
        log.detail(`uploaded ${shot.file} (media #${media.id})`)
      }

      const data = buildProjectData(entry, markdown, mediaIds, visible, caseStudy)

      const existing = entry.publishedTo?.[target]

      let projectId: number
      if (existing) {
        const updated = await payload.update({
          id: existing.id,
          collection: 'projects',
          data,
        })
        projectId = updated.id
        log.ok(`updated project #${projectId}`)
      } else {
        const created = await payload.create({ collection: 'projects', data })
        projectId = created.id
        log.ok(`created project #${projectId}`)
      }

      await updateEntry(entry.slug, (record) => {
        record.publishedTo ??= {}
        record.publishedTo[target] = { id: projectId, at: new Date().toISOString() }
      })

      if (!skipTech) {
        const result = await extractTechnologiesFromProject(projectId, payload)
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
