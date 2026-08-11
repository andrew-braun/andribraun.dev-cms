import {
  type JsonSchema,
  parseJsonFromResponse,
  parseStructuredResponse,
  parseTextResponse,
  sendMessage,
} from '@/app/lib/ai/claude'
import fs from 'fs/promises'

import type { EntryContext } from './types'

import {
  caseStudyOutputSchema,
  type CaseStudySidecar,
  validateGeneratedCaseStudy,
} from './caseStudy'
import { IngestError } from './log'
import {
  CASE_STUDY_INSTRUCTIONS_PATH,
  REPO_ASSESSMENT_INSTRUCTIONS_PATH,
  WRITEUP_INSTRUCTIONS_PATH,
} from './paths'
import {
  renderRepoAssessment,
  type RepoAssessment,
  repoAssessmentOutputSchema,
  validateRepoAssessment,
} from './repoAssessment'

const MODEL = 'claude-opus-5'
const CASE_STUDY_MODEL = 'claude-sonnet-4-5'

/** Caps the rendered context so a large repo can't blow past the model budget. */
const MAX_CONTEXT_CHARS = 180_000

/**
 * Renders a gathered context bundle as the markdown briefing handed to Claude.
 * Kept human-readable so `context.md` doubles as a review artifact.
 */
export function renderContext(context: EntryContext): string {
  const parts: string[] = [`# Project: ${context.title}`, '']

  // Notes come first and are framed as authoritative: they're first-hand, while
  // everything below is inference from scraped HTML and repo files.
  if (context.notes) {
    parts.push(
      "## Developer's notes",
      '',
      'Written by the developer who built this project. Treat as authoritative:',
      'where it conflicts with the scraped evidence below, this wins. It may name',
      'work that leaves no trace in the served HTML — build these details into the',
      'write-up rather than restricting yourself to what the probe found.',
      '',
      context.notes,
      '',
    )
  }

  if (context.site) {
    const site = context.site
    parts.push('## Deployed site', '')
    parts.push(`- URL: ${site.url}`)
    if (site.title) {
      parts.push(`- Page title: ${site.title}`)
    }
    if (site.description) {
      parts.push(`- Meta description: ${site.description}`)
    }
    if (site.signals.length > 0) {
      parts.push(
        `- Detected in the served HTML (hints only, verify against the repo): ${site.signals.join(', ')}`,
      )
    }
    if (site.navLinks.length > 0) {
      parts.push(`- Navigation links: ${site.navLinks.slice(0, 15).join(', ')}`)
    }
    if (!site.ok) {
      parts.push(`- NOTE: the site could not be fetched (${site.reason}).`)
    }
    parts.push('')
  }

  if (context.repo) {
    const repo = context.repo
    parts.push('## Repository', '')
    parts.push(`- ${repo.repo} (default branch: ${repo.defaultBranch})`)
    if (repo.description) {
      parts.push(`- Description: ${repo.description}`)
    }
    if (repo.homepage) {
      parts.push(`- Homepage: ${repo.homepage}`)
    }
    if (repo.pushedAt) {
      parts.push(`- Last pushed: ${repo.pushedAt}`)
    }
    if (repo.topics.length > 0) {
      parts.push(`- Topics: ${repo.topics.join(', ')}`)
    }

    const languages = Object.entries(repo.languages).sort((a, b) => b[1] - a[1])
    if (languages.length > 0) {
      const total = languages.reduce((sum, [, bytes]) => sum + bytes, 0)
      const formatted = languages
        .map(([name, bytes]) => `${name} ${Math.round((bytes / total) * 100)}%`)
        .join(', ')
      parts.push(`- Languages by bytes: ${formatted}`)
    }
    parts.push('')

    if (repo.tree.length > 0) {
      parts.push('### File tree', '', '```', ...repo.tree, '```', '')
    }

    for (const [path, contents] of Object.entries(repo.files)) {
      const fence = path.endsWith('.md') ? '````' : '```'
      parts.push(`### ${path}`, '', fence, contents, fence, '')
    }
  }

  const rendered = parts.join('\n')
  return rendered.length > MAX_CONTEXT_CHARS
    ? `${rendered.slice(0, MAX_CONTEXT_CHARS)}\n\n[context truncated]`
    : rendered
}

/**
 * Builds the assessment-only evidence packet. Unlike the narrative briefing,
 * it deliberately omits the repository tree: paths without file contents are
 * not evidence and must never look citeable to the assessment model.
 */
export function renderAssessmentContext(context: EntryContext): string {
  if (!context.repo) {
    throw new IngestError(`${context.slug}: repository context is unavailable`)
  }
  const repo = context.repo
  const paths = Object.keys(repo.files).sort()
  const parts = [
    `# Repository assessment: ${context.title}`,
    '',
    `Repository: ${repo.repo}`,
    `Default branch: ${repo.defaultBranch}`,
    repo.description ? `Description: ${repo.description}` : '',
    repo.topics.length ? `Topics: ${repo.topics.join(', ')}` : '',
    `Allowed evidence paths: ${paths.join(', ')}`,
    '',
  ].filter(Boolean)

  for (const sourcePath of paths) {
    const fence = sourcePath.endsWith('.md') ? '````' : '```'
    parts.push(`### ${sourcePath}`, '', fence, repo.files[sourcePath], fence, '')
  }
  const rendered = parts.join('\n')
  return rendered.length > MAX_CONTEXT_CHARS
    ? `${rendered.slice(0, MAX_CONTEXT_CHARS)}\n\n[assessment evidence truncated]`
    : rendered
}

/**
 * Produces the `description_markdown` body for a project, following the
 * repo's own write-up instructions verbatim as the system prompt.
 */
export async function generateWriteup(context: EntryContext): Promise<string> {
  const instructions = await fs.readFile(WRITEUP_INSTRUCTIONS_PATH, 'utf8')
  const briefing = renderContext(context)

  const response = await sendMessage(
    [
      {
        content: `Write the portfolio write-up for the project below, following your instructions exactly.

Ground every claim in the evidence provided. Do not invent technologies, metrics, or features that the repository and site do not show. If the evidence is thin in a section, write less rather than padding it.

${briefing}`,
        role: 'user',
      },
    ],
    {
      effort: 'high',
      maxTokens: 8000,
      model: MODEL,
      system: instructions,
    },
  )

  const text = parseTextResponse(response).trim()

  // The instructions forbid code fences, but strip a stray wrapper if one slips in.
  return text
    .replace(/^```(?:markdown|md)?\s*\n/, '')
    .replace(/\n```\s*$/, '')
    .trim()
}

export async function generateRepoAssessment(
  context: EntryContext,
  analysisFingerprint: string,
): Promise<RepoAssessment> {
  if (!context.repo) {
    throw new IngestError(`${context.slug}: repository context is unavailable`)
  }
  const instructions = await fs.readFile(REPO_ASSESSMENT_INSTRUCTIONS_PATH, 'utf8')
  const response = await sendMessage(
    [
      {
        content: `Assess the repository evidence below. Every finding must cite one or more exact paths from the Allowed evidence paths line. Omit unsupported claims and record uncertainty under unknowns.\n\n${renderAssessmentContext(context)}`,
        role: 'user',
      },
    ],
    {
      effort: 'medium',
      maxTokens: 5000,
      model: MODEL,
      outputSchema: repoAssessmentOutputSchema,
      system: instructions,
    },
  )
  return validateRepoAssessment(parseStructuredResponse<unknown>(response), context, {
    slug: context.slug,
    analysisFingerprint,
    generatedAt: new Date().toISOString(),
  })
}

/**
 * Produces structured case-study fields as a sidecar JSON payload. Failures
 * return an empty stub with every field flagged for review so the writeup
 * stage can still succeed.
 */
export interface CaseStudyInput {
  assessment: RepoAssessment
  context: EntryContext
  notes?: string
  writeup: string
}

export function renderCaseStudyBriefing(input: CaseStudyInput): string {
  const { context } = input
  const lines = [`# Project: ${context.title}`, `Slug: ${context.slug}`]
  if (input.notes) {
    lines.push(`\n## Developer notes\n${input.notes}`)
  }
  if (context.site) {
    lines.push(
      '\n## Site metadata',
      `URL: ${context.site.url}`,
      context.site.title ? `Title: ${context.site.title}` : '',
      context.site.description ? `Description: ${context.site.description}` : '',
      context.site.signals.length ? `Signals: ${context.site.signals.join(', ')}` : '',
    )
  }
  lines.push(
    `\n## Repository assessment\n${renderRepoAssessment(input.assessment)}`,
    `\n## Completed portfolio writeup\n${input.writeup}`,
  )
  return lines.filter(Boolean).join('\n')
}

export async function generateCaseStudy(input: CaseStudyInput): Promise<CaseStudySidecar> {
  const instructions = await fs.readFile(CASE_STUDY_INSTRUCTIONS_PATH, 'utf8')
  const response = await sendMessage(
    [
      {
        content: `Produce the case-study sidecar JSON for the project below.

Ground every claim in the evidence. If a field is uncertain, omit it and list it in needsReview.

${renderCaseStudyBriefing(input)}`,
        role: 'user',
      },
    ],
    {
      maxTokens: 2500,
      model: CASE_STUDY_MODEL,
      outputSchema: caseStudyOutputSchema,
      system: instructions,
    },
  )
  const parsed = parseStructuredResponse<unknown>(response)
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    !Array.isArray((parsed as { needsReview?: unknown }).needsReview)
  ) {
    throw new IngestError('Claude returned an invalid case-study object')
  }
  return validateGeneratedCaseStudy(parsed)
}

const altTextSchema: JsonSchema = {
  type: 'object',
  additionalProperties: false,
  properties: {
    alt: { type: 'string' },
  },
  required: ['alt'],
}

/**
 * Describes a screenshot for the media library's `alt` field, matching the
 * detailed style already used by the published projects.
 */
export async function generateAltText(
  imagePath: string,
  projectTitle: string,
  label: string,
): Promise<string> {
  try {
    const data = await fs.readFile(imagePath)

    const response = await sendMessage(
      [
        {
          content: [
            {
              type: 'image',
              source: { type: 'base64', data: data.toString('base64'), media_type: 'image/png' },
            },
            {
              type: 'text',
              text: `Write alt text for this screenshot of the "${projectTitle}" project (screen: ${label}).

Requirements:
- One sentence, 15-35 words, no trailing period issues, plain prose.
- Describe the specific interface shown: the page or screen, its main visual elements, and the notable controls or content visible.
- Start with the project or screen name where it reads naturally, e.g. "WhereNext.ai homepage hero section with...".
- Do not begin with "Screenshot of" or "Image of". Do not mention that it is a screenshot.`,
            },
          ],
          role: 'user',
        },
      ],
      {
        effort: 'low',
        maxTokens: 1000,
        model: MODEL,
        outputSchema: altTextSchema,
      },
    )

    const result = parseJsonFromResponse<{ alt: string }>(response, { alt: '' })
    const alt = result.alt?.trim()
    if (alt) {
      return alt
    }
  } catch {
    // Never block a capture on alt text; the placeholder is obvious in review.
  }
  return `${projectTitle} — ${label}`
}
