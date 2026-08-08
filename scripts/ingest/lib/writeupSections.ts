/**
 * The write-up instructions pin every generated description to the same four
 * sections, so the CMS stores each one in its own field and the front end can
 * lay them out independently. `description_markdown` still carries the whole
 * document — these fields are a split of it, not a replacement.
 */

export type WriteupSectionKey =
  'implementation_markdown' | 'intro_markdown' | 'outcome_markdown' | 'tech_stack_markdown'

export const WRITEUP_SECTION_KEYS: WriteupSectionKey[] = [
  'intro_markdown',
  'tech_stack_markdown',
  'implementation_markdown',
  'outcome_markdown',
]

export type WriteupSections = Partial<Record<WriteupSectionKey, string>>

/** Where each field's content comes from in `writeup.md`, for the entry sheet. */
export const WRITEUP_SECTION_SOURCES: Record<WriteupSectionKey, string> = {
  implementation_markdown: '`## Key Implementation Details`',
  intro_markdown: 'everything above the first `##`',
  outcome_markdown: '`## Outcome`',
  tech_stack_markdown: '`## Tech Stack & Architecture`',
}

export interface WriteupSplit {
  /** Section bodies, with the `##` heading line itself stripped. Empty sections are omitted. */
  sections: WriteupSections
  /** `##` headings that map to no field. Their text survives only in `description_markdown`. */
  unmatched: string[]
}

/** Matched loosely so a reworded heading still lands in the right field. */
const SECTION_MATCHERS: { key: WriteupSectionKey; test: (heading: string) => boolean }[] = [
  {
    key: 'tech_stack_markdown',
    test: (heading) => heading.includes('tech stack') || heading.includes('architecture'),
  },
  { key: 'implementation_markdown', test: (heading) => heading.includes('implementation') },
  {
    key: 'outcome_markdown',
    test: (heading) => heading.includes('outcome') || heading.includes('result'),
  },
]

const FENCE = /^[ \t]*(?:```|~~~)/

/** Drops the optional closing `###` run from an ATX heading's text. */
function headingText(value: string): string {
  return value.trim().replace(/#+$/, '').trim()
}

/**
 * Returns the text of a `##` heading, or null for any other line. Deeper
 * headings are not sections — `###` is used *inside* Key Implementation
 * Details, so treating it as a boundary would shred that field.
 */
function parseHeading(line: string): null | string {
  if (!line.startsWith('##')) {
    return null
  }
  const rest = line.slice(2)
  if (!rest.startsWith(' ') && !rest.startsWith('\t')) {
    return null
  }
  const text = headingText(rest)
  return text === '' ? null : text
}

function normalizeHeading(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim()
}

function matchSection(heading: string): null | WriteupSectionKey {
  const normalized = normalizeHeading(heading)
  return SECTION_MATCHERS.find((matcher) => matcher.test(normalized))?.key ?? null
}

/**
 * Everything above the first `##` is the introduction, minus a stray `# Title`
 * line — the write-up is not supposed to carry one, but a model occasionally
 * adds it and it would otherwise render as a duplicate heading.
 */
function cleanIntro(body: string): string {
  return body.replace(/^#[ \t][^\n]*\n?/, '').trim()
}

/**
 * Splits a write-up into its section fields. A document that does not follow
 * the house structure simply yields fewer sections (and reports the headings it
 * could not place) — nothing is lost, since the caller still stores the full
 * markdown.
 */
export function splitWriteup(markdown: string): WriteupSplit {
  const sections: WriteupSections = {}
  const unmatched: string[] = []

  /** `'drop'` collects the body of a heading that belongs to no field. */
  let current: 'drop' | WriteupSectionKey = 'intro_markdown'
  let buffer: string[] = []
  let fenced = false

  const flush = (): void => {
    const joined = buffer.join('\n')
    buffer = []
    if (current === 'drop') {
      return
    }

    const body = current === 'intro_markdown' ? cleanIntro(joined) : joined.trim()
    if (body === '') {
      return
    }
    // A repeated heading appends rather than silently replacing what came before.
    sections[current] = sections[current] ? `${sections[current]}\n\n${body}` : body
  }

  for (const line of markdown.split('\n')) {
    if (FENCE.test(line)) {
      fenced = !fenced
    }

    const heading = fenced ? null : parseHeading(line)
    if (heading === null) {
      buffer.push(line)
      continue
    }

    flush()
    const matched = matchSection(heading)
    if (matched === null) {
      unmatched.push(heading)
    }
    current = matched ?? 'drop'
  }

  flush()
  return { sections, unmatched }
}
