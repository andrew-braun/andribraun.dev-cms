'use server'

import configPromise from '@payload-config'
import { getPayload } from 'payload'
import { headers } from 'next/headers'
import { sendMessage, parseJsonFromResponse, type JsonSchema } from '@/app/lib/ai/claude'
import { TECHNOLOGY_CATEGORIES, type TechnologyCategory } from '@/collections/Technologies'

const CATEGORY_VALUES = TECHNOLOGY_CATEGORIES.map((c) => c.value)

interface ExtractedTechnology {
  name: string
  description: string
  link: string
  category: TechnologyCategory[]
}

interface ExtractResult {
  success: boolean
  message: string
  created: string[]
  linked: number
}

// JSON Schema for extracting technology names
const technologyNamesSchema: JsonSchema = {
  type: 'object',
  properties: {
    technologies: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['technologies'],
  additionalProperties: false,
}

// JSON Schema for technology details - dynamically includes category enum
function getTechnologyDetailsSchema(): JsonSchema {
  return {
    type: 'object',
    properties: {
      technologies: {
        type: 'array',
        items: {
          type: 'object',
          properties: {
            name: { type: 'string' },
            description: { type: 'string' },
            link: { type: 'string' },
            category: {
              type: 'array',
              items: {
                type: 'string',
                enum: CATEGORY_VALUES as unknown as string[],
              },
            },
          },
          required: ['name', 'description', 'link', 'category'],
          additionalProperties: false,
        },
      },
    },
    required: ['technologies'],
    additionalProperties: false,
  }
}

export async function extractTechnologies(projectId: number): Promise<ExtractResult> {
  const payload = await getPayload({ config: configPromise })

  const headersList = await headers()
  const { user } = await payload.auth({ headers: headersList })

  if (!user) {
    return { success: false, message: 'Unauthorized', created: [], linked: 0 }
  }

  try {
    const project = await payload.findByID({
      collection: 'projects',
      id: projectId,
    })

    if (!project) {
      return { success: false, message: 'Project not found', created: [], linked: 0 }
    }

    // Combine both description fields for comprehensive extraction
    const markdownContent = (project.description_markdown as string) || ''
    const richTextContent = project.description ? extractTextFromLexical(project.description) : ''
    const textContent = [markdownContent, richTextContent].filter(Boolean).join('\n\n').trim()

    if (!textContent) {
      return { success: false, message: 'No description content to analyze', created: [], linked: 0 }
    }

    const extractedNames = await extractTechnologyNames(textContent)

    if (extractedNames.length === 0) {
      return {
        success: true,
        message: 'No technologies found in description',
        created: [],
        linked: 0,
      }
    }

    const existingTechnologies = await payload.find({
      collection: 'technologies',
      limit: 1000,
    })

    const existingNamesMap = new Map(
      existingTechnologies.docs.map((t) => [t.name?.toLowerCase(), t.id]),
    )

    const newTechnologyNames = extractedNames.filter(
      (name) => !existingNamesMap.has(name.toLowerCase()),
    )

    const matchedExistingIds = extractedNames
      .filter((name) => existingNamesMap.has(name.toLowerCase()))
      .map((name) => existingNamesMap.get(name.toLowerCase())!)

    let createdTechnologies: { id: number; name: string }[] = []
    if (newTechnologyNames.length > 0) {
      const newTechnologies = await getTechnologyDetails(newTechnologyNames)

      for (const tech of newTechnologies) {
        const created = await payload.create({
          collection: 'technologies',
          data: {
            name: tech.name,
            description: tech.description,
            link: tech.link,
            category: tech.category,
          },
        })
        createdTechnologies.push({ id: created.id, name: created.name || tech.name })
      }
    }

    const allTechnologyIds = [...matchedExistingIds, ...createdTechnologies.map((t) => t.id)]

    const existingTechIds = ((project.metadata?.technologies as any[]) || []).map((t: any) =>
      typeof t === 'number' ? t : t.id,
    )

    const mergedTechIds = [...new Set([...existingTechIds, ...allTechnologyIds])]

    await payload.update({
      collection: 'projects',
      id: projectId,
      data: {
        metadata: {
          technologies: mergedTechIds,
        },
      },
    })

    return {
      success: true,
      message: 'Technologies extracted successfully',
      created: createdTechnologies.map((t) => t.name),
      linked: mergedTechIds.length,
    }
  } catch (error) {
    console.error('Extract technologies error:', error)
    return {
      success: false,
      message: error instanceof Error ? error.message : 'Extraction failed',
      created: [],
      linked: 0,
    }
  }
}

function extractTextFromLexical(richText: any): string {
  if (!richText?.root?.children) return ''

  const extractText = (node: any): string => {
    if (node.text) return node.text
    if (node.children) {
      return node.children.map(extractText).join(' ')
    }
    return ''
  }

  return richText.root.children.map(extractText).join('\n').trim()
}

async function extractTechnologyNames(text: string): Promise<string[]> {
  const response = await sendMessage(
    [
      {
        role: 'user',
        content: `Extract all technology, framework, library, programming language, database, and tool names mentioned in this project description.

Text:
${text}

Return the technology names as commonly known (e.g., "React", "PostgreSQL", "Docker").`,
      },
    ],
    {
      maxTokens: 2048,
      outputSchema: technologyNamesSchema,
    },
  )

  const result = parseJsonFromResponse<{ technologies: string[] }>(response, { technologies: [] })
  return result.technologies
}

async function getTechnologyDetails(names: string[]): Promise<ExtractedTechnology[]> {
  const response = await sendMessage(
    [
      {
        role: 'user',
        content: `For each of these technologies, provide details:

Technologies: ${names.join(', ')}

For each technology, provide:
- name: The official/common name
- description: A brief 1-2 sentence description
- link: The official website URL
- category: Array of applicable categories`,
      },
    ],
    {
      maxTokens: 4096,
      outputSchema: getTechnologyDetailsSchema(),
    },
  )

  const result = parseJsonFromResponse<{ technologies: ExtractedTechnology[] }>(response, {
    technologies: [],
  })

  // Categories are already validated by the schema's enum constraint
  return result.technologies
}