import { extractTechnologiesFromProject } from '@/services/technologyExtraction'
import configPromise from '@payload-config'
import { headers } from 'next/headers'
import { getPayload } from 'payload'

/**
 * API endpoint for extracting technologies from a project description.
 *
 * @param {Request} request - The HTTP request with projectId in the body
 * @returns {Promise<Response>} JSON response with extraction results
 */
export async function POST(request: Request) {
  const payload = await getPayload({ config: configPromise })

  const headersList = await headers()
  const { user } = await payload.auth({ headers: headersList })

  if (!user) {
    console.warn('Unauthorized API request to extract technologies')
    return Response.json({ message: 'Unauthorized' }, { status: 401 })
  }

  try {
    const { projectId } = await request.json()

    if (!projectId) {
      return Response.json({ message: 'Project ID required' }, { status: 400 })
    }

    const result = await extractTechnologiesFromProject(projectId, payload)

    if (!result.success) {
      return Response.json({ errors: result.errors, message: result.message }, { status: 400 })
    }

    return Response.json({
      created: result.created,
      errors: result.errors,
      linked: result.linked,
      message: result.message,
    })
  } catch (error) {
    console.error('API extract technologies error:', error)
    return Response.json(
      {
        message: error instanceof Error ? error.message : 'Extraction failed',
      },
      { status: 500 },
    )
  }
}
