import fs from 'fs/promises'

import type { ManifestEntry } from './types'

import { atomicWriteFile } from './artifacts'
import { NOTES_DIR, notesPath } from './paths'

/**
 * Reads `ingest/notes/<slug>.md`, stripping the scaffold's HTML comments and any
 * prompt bullets left unanswered. Returns undefined when nothing of substance
 * remains, so an untouched template never reaches the model as real background.
 */
export async function readNotes(slug: string): Promise<string | undefined> {
  let raw: string
  try {
    raw = await fs.readFile(notesPath(slug), 'utf8')
  } catch {
    return undefined
  }

  const cleaned = raw
    .replace(/<!--[\s\S]*?-->/g, '')
    .split('\n')
    .filter((line) => !isUnansweredPrompt(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim()
    // The scaffold's H1 just repeats the project title the briefing already has.
    .replace(/^#[^\n]*\n+/, '')

  // A lone `# Title` heading is what the scaffold leaves behind once the
  // comments and prompts are gone — not something worth sending.
  const substance = cleaned
    .split('\n')
    .filter((line) => line.trim() !== '' && !line.trim().startsWith('#'))
    .join('\n')
    .trim()

  return substance === '' ? undefined : cleaned
}

/** True for a scaffold prompt the user hasn't replaced with an answer. */
function isUnansweredPrompt(line: string): boolean {
  const trimmed = line.trim().replace(/^[-*]\s*/, '')
  return PROMPTS.includes(trimmed)
}

const PROMPTS = [
  'What was this? Who was it for, and what did they need?',
  'What did you actually build or do? Theme work, plugins, integrations, migrations, custom code?',
  'What was hard about it, and how did you solve it?',
  'Anything measurable — traffic, load times, conversions, scale, timeline?',
  'Anything to leave out, or to be careful about saying publicly?',
]

/**
 * Writes a starter notes file for an entry. Never overwrites an existing one.
 * Returns the path when created, or null when a file was already there.
 */
export async function scaffoldNotes(entry: ManifestEntry): Promise<null | string> {
  const target = notesPath(entry.slug)

  try {
    await fs.access(target)
    return null
  } catch {
    // Not there yet — fall through and create it.
  }

  const lines = [
    `# ${entry.title}`,
    '',
    '<!--',
    'Background the pipeline cannot scrape. Everything here is treated as',
    'authoritative and outranks the site probe and repo scan.',
    '',
    'Prose, bullets, or fragments — all fine. Delete the prompts as you go.',
    'Leave the file untouched and it is ignored entirely.',
    '-->',
    '',
    ...PROMPTS.flatMap((prompt) => [`- ${prompt}`, '']),
  ]

  await fs.mkdir(NOTES_DIR, { recursive: true })
  await atomicWriteFile(target, lines.join('\n'))
  return target
}
