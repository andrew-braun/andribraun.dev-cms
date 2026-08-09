/**
 * The two ways `publish` can reach a Payload instance.
 *
 * `local` opens a Postgres connection through the Local API and is the fastest
 * path to a database on this machine. `remote` goes over HTTP against a running
 * instance's REST API with an API key, which is the only way to reach
 * production — its database isn't exposed, and its media live in R2 behind the
 * instance's own storage adapter.
 *
 * Both are driven through one interface so `publish` has a single code path.
 */

import type { ProjectCreateData, ProjectUpdateData } from './projectData'
import type { ProjectIdentity } from './projectResolution'
import type { RemoteClient, UploadFile } from './remote'

import { createRemoteClient, RemoteHTTPError } from './remote'
import { currentTarget, remoteTarget } from './target'

export interface TechExtractionResult {
  created: string[]
  errors?: string[]
  linked: number
  message: string
  success: boolean
}

export interface PublishBackend {
  close(): Promise<void>
  createProject(data: ProjectCreateData): Promise<number>
  /** Human-readable destination, printed before anything is written. */
  readonly description: string
  extractTechnologies(projectId: number): Promise<TechExtractionResult>
  /**
   * Looks up an existing project by its unique slug. Lets a publish adopt a
   * project that was entered by hand, rather than failing on the unique
   * constraint or creating a duplicate.
   */
  findProjectById(id: number): Promise<null | ProjectIdentity>
  findProjectBySlug(slug: string): Promise<null | ProjectIdentity>
  /** Manifest key the resulting project ID is recorded under. */
  readonly target: string
  updateProject(id: number, data: ProjectUpdateData): Promise<number>
  uploadMedia(alt: string, file: UploadFile): Promise<number>
}

/**
 * Publishes through the Local API to whatever `DATABASE_URI` points at.
 *
 * Payload and the technology extraction service are imported lazily so a remote
 * publish never loads the config or opens a database connection it won't use.
 */
export async function localBackend(): Promise<PublishBackend> {
  const [{ getPayload }, config, { extractTechnologiesFromProject }] = await Promise.all([
    import('payload'),
    import('@payload-config'),
    import('@/services/technologyExtraction'),
  ])

  const payload = await getPayload({ config: config.default })
  const target = currentTarget()

  return {
    async close() {
      await payload.destroy()
    },
    async createProject(data) {
      const created = await payload.create({ collection: 'projects', data })
      return created.id
    },
    description: `local database ${target}`,
    async extractTechnologies(projectId) {
      return await extractTechnologiesFromProject(projectId, payload)
    },
    async findProjectById(id) {
      try {
        const project = await payload.findByID({ id, collection: 'projects', depth: 0 })
        return typeof project.slug === 'string' ? { id: project.id, slug: project.slug } : null
      } catch (error) {
        if ((error as { status?: number }).status === 404) {
          return null
        }
        throw error
      }
    },
    async findProjectBySlug(slug) {
      const result = await payload.find({
        collection: 'projects',
        depth: 0,
        limit: 1,
        where: { slug: { equals: slug } },
      })
      const project = result.docs[0]
      return project && typeof project.slug === 'string'
        ? { id: project.id, slug: project.slug }
        : null
    },
    target,
    async updateProject(id, data) {
      const updated = await payload.update({ id, collection: 'projects', data })
      return updated.id
    },
    async uploadMedia(alt, file) {
      const media = await payload.create({
        collection: 'media',
        data: { alt },
        file: {
          name: file.name,
          data: Buffer.from(file.data),
          mimetype: file.mimetype,
          size: file.data.byteLength,
        },
      })
      return media.id
    },
  }
}

/** Publishes over the REST API of a running instance, e.g. production. */
export function remoteBackend(client: RemoteClient = createRemoteClient()): PublishBackend {
  const target = remoteTarget(client.host)

  return {
    async close() {},
    async createProject(data) {
      const created = await client.create('projects', data)
      return created.id
    },
    description: `remote instance ${client.baseUrl}`,
    async extractTechnologies(projectId) {
      try {
        const result = await client.post<Omit<TechExtractionResult, 'success'>>(
          'extract-technologies',
          { projectId },
        )
        return { ...result, created: result.created ?? [], success: true }
      } catch (error) {
        // The endpoint answers 400 when extraction itself fails, which the
        // client raises. A failed extraction shouldn't fail the publish.
        return {
          created: [],
          linked: 0,
          message: error instanceof Error ? error.message : String(error),
          success: false,
        }
      }
    },
    async findProjectById(id) {
      try {
        const project = await client.findByID('projects', id, { depth: 0 })
        return typeof project.slug === 'string' ? { id: project.id, slug: project.slug } : null
      } catch (error) {
        if (error instanceof RemoteHTTPError && error.status === 404) {
          return null
        }
        throw error
      }
    },
    async findProjectBySlug(slug) {
      const result = await client.find('projects', {
        depth: 0,
        limit: 1,
        where: { slug: { equals: slug } },
      })
      const project = result.docs[0]
      return project && typeof project.slug === 'string'
        ? { id: project.id, slug: project.slug }
        : null
    },
    target,
    async updateProject(id, data) {
      const updated = await client.update('projects', id, data)
      return updated.id
    },
    async uploadMedia(alt, file) {
      const media = await client.upload('media', file, { alt })
      return media.id
    },
  }
}

/**
 * Resolves the manifest target key without building a backend, so `--dry-run`
 * can report its destination without connecting to anything.
 */
export function resolveTarget(remote: boolean): string {
  return remote ? remoteTarget(createRemoteClient().host) : currentTarget()
}
