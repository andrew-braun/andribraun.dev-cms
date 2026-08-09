import type { PublishBackend } from './backend'

import { IngestError } from './log'

export interface ProjectIdentity {
  id: number
  slug: string
}

export type ProjectResolution = { action: 'create' } | { action: 'update'; id: number }

export async function resolveProject(
  backend: Pick<PublishBackend, 'findProjectById' | 'findProjectBySlug'>,
  slug: string,
  hintedId?: number,
): Promise<ProjectResolution> {
  if (hintedId !== undefined) {
    const hinted = await backend.findProjectById(hintedId)
    if (hinted && hinted.slug !== slug) {
      throw new IngestError(
        `Recorded project #${hintedId} belongs to slug "${hinted.slug}", not "${slug}"`,
      )
    }
    if (hinted) {
      return { id: hinted.id, action: 'update' }
    }
  }
  const bySlug = await backend.findProjectBySlug(slug)
  return bySlug ? { id: bySlug.id, action: 'update' } : { action: 'create' }
}
