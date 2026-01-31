import type { Payload } from 'payload'

import { type JsonSchema, parseJsonFromResponse, sendMessage } from '@/app/lib/ai/claude'
import { TECHNOLOGY_CATEGORIES, type TechnologyCategory } from '@/collections/Technologies'
import configPromise from '@payload-config'
import { getPayload } from 'payload'

const CATEGORY_VALUES = TECHNOLOGY_CATEGORIES.map((c) => c.value)

interface ExtractedTechnology {
  category: TechnologyCategory[]
  description: string
  link: string
  name: string
}

export interface ExtractResult {
  created: string[]
  errors?: string[]
  linked: number
  message: string
  success: boolean
}

// JSON Schema for extracting technology names
const technologyNamesSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    technologies: {
      type: 'array',
      items: { type: 'string' },
    },
  },
  required: ['technologies'],
}

/**
 * Generates the JSON Schema for technology details with dynamic category enum values.
 *
 * @returns {JsonSchema} JSON Schema object for validating technology details
 */
function getTechnologyDetailsSchema(): JsonSchema {
  return {
    type: 'object',
    additionalProperties: false,
    properties: {
      technologies: {
        type: 'array',
        items: {
          type: 'object',
          additionalProperties: false,
          properties: {
            name: { type: 'string' },
            category: {
              type: 'array',
              items: {
                type: 'string',
                enum: CATEGORY_VALUES as unknown as string[],
              },
            },
            description: { type: 'string' },
            link: { type: 'string' },
          },
          required: ['name', 'description', 'link', 'category'],
        },
      },
    },
    required: ['technologies'],
  }
}

/**
 * Extracts plain text content from a Lexical rich text editor structure.
 *
 * @param {any} richText - The Lexical rich text object with root.children structure
 * @returns {string} Extracted plain text content
 */
function extractTextFromLexical(richText: any): string {
  if (!richText?.root?.children) {
    return ''
  }

  const extractText = (node: any): string => {
    if (node.text) {
      return node.text
    }
    if (node.children) {
      return node.children.map(extractText).join(' ')
    }
    return ''
  }

  return richText.root.children.map(extractText).join('\n').trim()
}

/**
 * Uses Claude AI to extract technology names from project description text.
 *
 * @param {string} text - The project description text to analyze
 * @returns {Promise<string[]>} Array of extracted technology names
 */
async function extractTechnologyNames(text: string): Promise<string[]> {
  const response = await sendMessage(
    [
      {
        content: `Extract all technology, framework, library, programming language, database, and tool names mentioned in this project description.

The goal is to identify technologies used in the project so they can be:
1. Added to a global technology database (if new)
2. Linked to this project for categorization and filtering
3. Displayed on the project page to show the tech stack

Text:
${text}

Return the technology names as commonly known (e.g., "React", "PostgreSQL", "Docker").`,
        role: 'user',
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

/**
 * Validates a single technology object to ensure required fields are present and valid.
 *
 * @param {ExtractedTechnology} tech - The technology object to validate
 * @returns {string | null} Error message if validation fails, null if valid
 */
function validateTechnology(tech: ExtractedTechnology): null | string {
  if (!tech.name || tech.name.trim().length === 0) {
    return 'Technology name is required'
  }

  if (!tech.description || tech.description.trim().length < 10) {
    return `Technology "${tech.name}" has insufficient description (min 10 chars)`
  }

  if (!tech.link || tech.link.trim().length === 0) {
    return `Technology "${tech.name}" is missing a link`
  }

  // Basic URL validation
  try {
    new URL(tech.link)
  } catch {
    return `Technology "${tech.name}" has invalid URL: ${tech.link}`
  }

  if (!tech.category || tech.category.length === 0) {
    return `Technology "${tech.name}" has no category assigned`
  }

  return null
}

/**
 * Uses Claude AI to get detailed information about technologies.
 *
 * @param {string[]} names - Array of technology names to get details for
 * @returns {Promise<{ valid: ExtractedTechnology[], errors: string[] }>} Valid technologies and validation errors
 */
async function getTechnologyDetails(
  names: string[],
): Promise<{ errors: string[]; valid: ExtractedTechnology[] }> {
  const availableCategories = TECHNOLOGY_CATEGORIES.map((c) => `${c.value} (${c.label})`).join(', ')

  const response = await sendMessage(
    [
      {
        content: `For each of these technologies, provide complete and accurate details.

Technologies: ${names.join(', ')}

For each technology, you MUST provide:
- name: The official/common name (e.g., "React", "PostgreSQL")
- description: A comprehensive 1-2 sentence description explaining what the technology is and its primary use case
- link: The official website URL (must be a valid, complete URL starting with https://)
- category: Array of one or more applicable categories from: ${availableCategories}

These details will be saved to a database and displayed publicly, so ensure accuracy and completeness.`,
        role: 'user',
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

  // Validate each technology and separate valid from invalid
  const valid: ExtractedTechnology[] = []
  const errors: string[] = []

  for (const tech of result.technologies) {
    const error = validateTechnology(tech)
    if (error) {
      errors.push(error)
      console.error(`Technology validation failed: ${error}`, tech)
    } else {
      valid.push(tech)
    }
  }

  return { errors, valid }
}

/**
 * Extracts technologies from a project description and creates/links them to the project.
 *
 * This function:
 * 1. Retrieves the project and its descriptions
 * 2. Uses AI to extract technology names from the text
 * 3. Uses AI to get detailed information for new technologies
 * 4. Validates the extracted data
 * 5. Creates new technology entries in the database
 * 6. Links all technologies (new and existing) to the project
 *
 * @param {number} projectId - The ID of the project to extract technologies for
 * @param {Payload} payload - Optional Payload instance (will be created if not provided)
 * @returns {Promise<ExtractResult>} Result object with success status, message, and created/linked counts
 */
export async function extractTechnologiesFromProject(
  projectId: number,
  payload?: Payload,
): Promise<ExtractResult> {
  const payloadInstance = payload || (await getPayload({ config: configPromise }))

  try {
    const project = await payloadInstance.findByID({
      id: projectId,
      collection: 'projects',
    })

    if (!project) {
      console.error(`Technology extraction failed: Project ${projectId} not found`)
      return { created: [], linked: 0, message: 'Project not found', success: false }
    }

    // Combine both description fields for comprehensive extraction
    const markdownContent = (project.description_markdown as string) || ''
    const richTextContent = project.description ? extractTextFromLexical(project.description) : ''
    const textContent = [markdownContent, richTextContent].filter(Boolean).join('\n\n').trim()

    if (!textContent) {
      console.warn(`Technology extraction skipped: Project ${projectId} has no description content`)
      return {
        created: [],
        linked: 0,
        message: 'No description content to analyze',
        success: false,
      }
    }

    console.log(`Extracting technologies for project ${projectId}`)
    const extractedNames = await extractTechnologyNames(textContent)

    if (extractedNames.length === 0) {
      console.info(`Technology extraction completed: No technologies found in project ${projectId}`)
      return {
        created: [],
        linked: 0,
        message: 'No technologies found in description',
        success: true,
      }
    }

    console.log(`Found ${extractedNames.length} technologies: ${extractedNames.join(', ')}`)

    // Query all existing technologies without limit
    const existingTechnologies = await payloadInstance.find({
      collection: 'technologies',
      limit: 0, // No limit - fetch all
    })

    const existingNamesMap = new Map(
      existingTechnologies.docs.map((tech) => [tech.name?.toLowerCase() || '', tech.id]),
    )

    const newTechnologyNames = extractedNames.filter(
      (name) => !existingNamesMap.has(name.toLowerCase()),
    )

    const matchedExistingIds = extractedNames
      .filter((name) => existingNamesMap.has(name.toLowerCase()))
      .map((name) => {
        const id = existingNamesMap.get(name.toLowerCase())
        if (id === undefined) {
          console.error(`Technology ID unexpectedly undefined for: ${name}`)
        }
        return id
      })
      .filter((id): id is number => id !== undefined)

    const createdTechnologies: { id: number; name: string }[] = []
    const validationErrors: string[] = []

    if (newTechnologyNames.length > 0) {
      console.log(`Fetching details for ${newTechnologyNames.length} new technologies`)
      const { errors, valid: newTechnologies } = await getTechnologyDetails(newTechnologyNames)

      if (errors.length > 0) {
        validationErrors.push(...errors)
        console.warn(`Technology validation errors: ${errors.join('; ')}`)
      }

      for (const tech of newTechnologies) {
        try {
          const created = await payloadInstance.create({
            collection: 'technologies',
            data: {
              name: tech.name,
              category: tech.category,
              description: tech.description,
              link: tech.link,
            },
          })
          createdTechnologies.push({ id: created.id, name: created.name || tech.name })
          console.log(`Created technology: ${tech.name} (ID: ${created.id})`)
        } catch (error) {
          const errorMsg = `Failed to create technology "${tech.name}": ${error instanceof Error ? error.message : 'Unknown error'}`
          validationErrors.push(errorMsg)
          console.error(errorMsg, error)
        }
      }
    }

    const allTechnologyIds = [...matchedExistingIds, ...createdTechnologies.map((tech) => tech.id)]

    // Safely extract existing technology IDs with type checking
    const metadataTechnologies = project.metadata?.technologies
    const existingTechIds: number[] = []

    if (Array.isArray(metadataTechnologies)) {
      for (const tech of metadataTechnologies) {
        if (typeof tech === 'number') {
          existingTechIds.push(tech)
        } else if (
          tech &&
          typeof tech === 'object' &&
          'id' in tech &&
          typeof tech.id === 'number'
        ) {
          existingTechIds.push(tech.id)
        }
      }
    }

    const mergedTechIds = [...new Set([...allTechnologyIds, ...existingTechIds])]

    await payloadInstance.update({
      id: projectId,
      collection: 'projects',
      data: {
        metadata: {
          technologies: mergedTechIds,
        },
      },
    })

    console.log(
      `Technology extraction completed for project ${projectId}: ${createdTechnologies.length} created, ${mergedTechIds.length} linked`,
    )

    return {
      created: createdTechnologies.map((tech) => tech.name),
      errors: validationErrors.length > 0 ? validationErrors : undefined,
      linked: mergedTechIds.length,
      message: 'Technologies extracted successfully',
      success: true,
    }
  } catch (error) {
    console.error(`Technology extraction failed for project ${projectId}:`, error)
    return {
      created: [],
      linked: 0,
      message: error instanceof Error ? error.message : 'Extraction failed',
      success: false,
    }
  }
}
