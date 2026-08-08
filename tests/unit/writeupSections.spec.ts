import { describe, expect, it } from 'vitest'

import { splitWriteup } from '../../scripts/ingest/lib/writeupSections'

const writeup = `A fast tax services website built for OTM.

## Tech Stack & Architecture

- <span class="tech" data-tag="astro">Astro</span> with islands hydration

## Key Implementation Details

**Unified PageData Architecture** — a single source of truth for routing.

## Outcome

A fast, accessible platform that handles complex workflows.`

describe('splitWriteup', () => {
  it('splits the house structure into its four fields', () => {
    const { sections, unmatched } = splitWriteup(writeup)

    expect(sections.intro_markdown).toBe('A fast tax services website built for OTM.')
    expect(sections.tech_stack_markdown).toBe(
      '- <span class="tech" data-tag="astro">Astro</span> with islands hydration',
    )
    expect(sections.implementation_markdown).toBe(
      '**Unified PageData Architecture** — a single source of truth for routing.',
    )
    expect(sections.outcome_markdown).toBe(
      'A fast, accessible platform that handles complex workflows.',
    )
    expect(unmatched).toEqual([])
  })

  it('matches headings loosely and drops a stray title line', () => {
    const { sections } = splitWriteup(`# Glyphin

The intro.

## Architecture

Details.

## Results

It shipped.`)

    expect(sections.intro_markdown).toBe('The intro.')
    expect(sections.tech_stack_markdown).toBe('Details.')
    expect(sections.outcome_markdown).toBe('It shipped.')
    expect(sections.implementation_markdown).toBeUndefined()
  })

  it('reports headings it cannot place instead of guessing', () => {
    const { sections, unmatched } = splitWriteup(`Intro.

## Design Process

Sketches and prototypes.

## Outcome

Shipped.`)

    expect(unmatched).toEqual(['Design Process'])
    expect(sections.outcome_markdown).toBe('Shipped.')
    expect(Object.values(sections)).not.toContain('Sketches and prototypes.')
  })

  it('ignores headings inside fenced code blocks', () => {
    const { sections } = splitWriteup(`Intro.

## Tech Stack & Architecture

\`\`\`markdown
## Outcome
not a real heading
\`\`\`

## Outcome

The real one.`)

    expect(sections.tech_stack_markdown).toContain('not a real heading')
    expect(sections.outcome_markdown).toBe('The real one.')
  })

  it('returns only an intro for a write-up with no headings', () => {
    const { sections, unmatched } = splitWriteup('Just a paragraph.')

    expect(sections).toEqual({ intro_markdown: 'Just a paragraph.' })
    expect(unmatched).toEqual([])
  })
})
