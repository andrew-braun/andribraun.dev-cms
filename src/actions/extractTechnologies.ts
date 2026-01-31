'use server'

import { type ExtractResult, extractTechnologiesFromProject } from '@/services/technologyExtraction'
import configPromise from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

/**
 * Server action to extract technologies from a project description.
 * Handles authentication and delegates to the shared service.
 *
 * @param {number} projectId - The ID of the project to extract technologies for
 * @returns {Promise<ExtractResult>} Result with success status, created/linked counts, and any errors
 */
export async function extractTechnologies(projectId: number): Promise<ExtractResult> {
  const payload = await getPayload({ config: configPromise })

  const headersList = await headers()
  const { user } = await payload.auth({ headers: headersList })

  if (!user) {
    console.warn(`Unauthorized technology extraction attempt for project ${projectId}`)
    return { created: [], linked: 0, message: 'Unauthorized', success: false }
  }

  return extractTechnologiesFromProject(projectId, payload)
}
